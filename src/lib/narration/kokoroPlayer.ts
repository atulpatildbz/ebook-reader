// Plays a list of sentences with Kokoro: keeps a few sentences synthesized ahead of the one being
// heard, plays them one after another, and reports which sentence and word are being spoken.
//
// Speech is always synthesized at the voice's natural pace (where it sounds best) and sped up on
// playback by the browser, which keeps the pitch. So the speed can change instantly mid-sentence,
// and fast listening only needs synthesis to run faster than the chosen speed.
import type { WordTiming } from "./align";
import type { Device, Dtype, FromWorker, ToWorker } from "./kokoro.worker";

export type Stats = {
  device?: Device;
  dtype?: string;
  loadMs?: number;
  download?: { loaded: number; total: number };
  /** Seconds of audio per second of synthesis: the latest sentence, all of them, and the last few. */
  speed?: { last: number; avg: number; recent: number };
  /** Times playback had to wait for synthesis, and the total wait. */
  stalls: { count: number; seconds: number };
};

export type Events = {
  onPosition(sentence: number, word: number): void;
  onState(state: "loading" | "playing" | "paused" | "idle"): void;
  onStats(stats: Stats): void;
  onError(message: string): void;
  /** The last sentence finished (not called when stopped). */
  onEnd?(): void;
};

export type Sentence = { text: string; paragraphStart: boolean };

/** What the reader needs from a voice engine. */
export interface Player {
  events: Events;
  play(sentences: Sentence[], from: number, voice: string, rate: number): void | Promise<void>;
  setRate(rate: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
  dispose(): void;
  /** Word timings of the sentence playing, in its own characters (Kokoro only). */
  readonly words?: WordTiming[];
}

const AHEAD = 4;
const PARAGRAPH_PAUSE = 0.35;

type Ready = { samples: Float32Array; sampleRate: number; words: WordTiming[] };

/** 16-bit mono WAV, which every browser's <audio> plays. */
function wav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

// A tiny silent clip, played inside the tap that starts narration so the browser (iOS Safari in
// particular) lets this audio element keep playing later on its own.
const SILENCE = URL.createObjectURL(wav(new Float32Array(240), 24000));

export class KokoroPlayer implements Player {
  private worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
  private ready: Promise<void> | null = null;
  private onReady = () => {};
  readonly audio = new Audio();
  private stats: Stats = { stalls: { count: 0, seconds: 0 } };
  private totals = { audio: 0, gen: 0 };
  private recent: { audio: number; gen: number }[] = [];

  // One play() run; results from an earlier run are dropped.
  private run = 0;
  private nextId = 0;
  private requests = new Map<number, { run: number; index: number }>();
  private results = new Map<number, Ready>();
  private sentences: Sentence[] = [];
  private voice = "af_heart";
  private rate = 1;
  private requested = 0; // next sentence to ask for
  private current = -1; // sentence in the audio element
  words: WordTiming[] = [];
  private url: string | null = null;
  private waitingSince: number | null = null; // playback is waiting on synthesis
  private paused = false;
  private gapTimer = 0;
  private frame = 0;
  private shownWord = -1;

  constructor(
    private device: Device,
    public events: Events,
    private dtype?: Dtype,
  ) {
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.audio.preservesPitch = true;
    this.audio.onended = () => this.advance();
  }

  private send(msg: ToWorker) {
    this.worker.postMessage(msg);
  }

  private load() {
    this.ready ??= new Promise<void>((resolve) => {
      this.onReady = resolve;
      this.send({ type: "load", device: this.device, dtype: this.dtype });
    });
    return this.ready;
  }

  private receive(msg: FromWorker) {
    if (msg.type === "progress") this.setStats({ download: { loaded: msg.loaded, total: msg.total } });
    else if (msg.type === "ready") {
      this.setStats({ device: msg.device, dtype: msg.dtype, loadMs: msg.ms });
      this.onReady();
    } else if (msg.type === "error") {
      this.events.onError(msg.message);
      if (msg.id === undefined) this.events.onState("idle");
    } else {
      const req = this.requests.get(msg.id);
      this.requests.delete(msg.id);
      const seconds = msg.samples.length / msg.sampleRate;
      this.totals.audio += seconds;
      this.totals.gen += msg.genMs / 1000;
      this.recent = [...this.recent.slice(-5), { audio: seconds, gen: msg.genMs / 1000 }];
      const sum = (k: "audio" | "gen") => this.recent.reduce((a, r) => a + r[k], 0);
      this.setStats({ speed: { last: seconds / (msg.genMs / 1000), avg: this.totals.audio / this.totals.gen, recent: sum("audio") / sum("gen") } });
      if (!req || req.run !== this.run) return;
      this.results.set(req.index, msg);
      if (this.waitingSince !== null && req.index === this.current + 1) this.advance();
      this.request();
    }
  }

  private setStats(s: Partial<Stats>) {
    this.stats = { ...this.stats, ...s };
    this.events.onStats(this.stats);
  }

  async play(sentences: Sentence[], from: number, voice: string, rate: number) {
    this.stop();
    const run = this.run;
    this.audio.src = SILENCE;
    void this.audio.play().catch(() => {});
    this.sentences = sentences;
    this.voice = voice;
    this.rate = rate;
    this.requested = from;
    this.current = from - 1;
    this.events.onState("loading");
    await this.load();
    if (run !== this.run) return;
    this.request();
    this.waitingSince = performance.now();
    this.tick();
  }

  setRate(rate: number) {
    this.rate = rate;
    this.audio.playbackRate = rate;
  }

  /** Keep up to AHEAD sentences synthesized or in progress beyond the one playing. */
  private request() {
    const playing = Math.max(this.current, 0);
    while (this.requested < this.sentences.length && this.requested <= playing + AHEAD) {
      const id = this.nextId++;
      this.requests.set(id, { run: this.run, index: this.requested });
      this.send({ type: "speak", id, text: this.sentences[this.requested].text, voice: this.voice, speed: 1 });
      this.requested++;
    }
  }

  /** Move to the next sentence: play it if it's ready, else wait for it. */
  private advance() {
    const next = this.current + 1;
    if (next >= this.sentences.length) {
      this.stop();
      this.events.onState("idle");
      this.events.onEnd?.();
      return;
    }
    const r = this.results.get(next);
    if (!r) {
      this.waitingSince ??= performance.now();
      return;
    }
    if (this.waitingSince !== null && this.current >= 0) {
      const waited = (performance.now() - this.waitingSince) / 1000;
      this.setStats({ stalls: { count: this.stats.stalls.count + 1, seconds: this.stats.stalls.seconds + waited } });
    }
    this.waitingSince = null;
    this.results.delete(next);
    this.current = next;
    this.words = r.words;
    this.shownWord = -1;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(wav(r.samples, r.sampleRate));
    this.audio.src = this.url;
    this.audio.playbackRate = this.rate;
    this.events.onPosition(next, -1);
    this.request();
    const gap = next > 0 && this.sentences[next].paragraphStart ? (PARAGRAPH_PAUSE * 1000) / this.rate : 0;
    const start = () => {
      if (this.paused) return;
      void this.audio.play().catch((e) => this.events.onError(String(e)));
      this.events.onState("playing");
    };
    clearTimeout(this.gapTimer);
    if (gap) this.gapTimer = window.setTimeout(start, gap);
    else start();
  }

  private tick = () => {
    if (this.current >= 0 && this.waitingSince === null) {
      const t = this.audio.currentTime;
      let word = -1;
      for (let i = 0; i < this.words.length && this.words[i].start <= t; i++) word = i;
      if (word !== this.shownWord) {
        this.shownWord = word;
        this.events.onPosition(this.current, word);
      }
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  pause() {
    this.paused = true;
    clearTimeout(this.gapTimer);
    this.audio.pause();
    this.events.onState("paused");
  }

  resume() {
    this.paused = false;
    if (this.waitingSince !== null) this.advance();
    else void this.audio.play();
    this.events.onState("playing");
  }

  stop() {
    this.run++;
    this.send({ type: "cancel", below: this.nextId });
    cancelAnimationFrame(this.frame);
    clearTimeout(this.gapTimer);
    this.audio.pause();
    this.results.clear();
    this.requests.clear();
    this.waitingSince = null;
    this.paused = false;
    this.current = -1;
  }

  dispose() {
    this.stop();
    this.worker.terminate();
    if (this.url) URL.revokeObjectURL(this.url);
  }
}
