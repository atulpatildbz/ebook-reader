// Plays a list of sentences with Kokoro: synthesizes minutes ahead of the one being heard (also
// while paused), plays them one after another, and reports which sentence and word are spoken.
//
// Speech is synthesized at the voice's natural pace, or a little faster for fast listening, and
// sped up the rest of the way on playback by the browser, which keeps the pitch. So the speed can
// change instantly mid-sentence. Where the device can't synthesize as fast as the chosen speed,
// playback stops now and then to get well ahead, rather than after every sentence.
import type { WordTiming } from "./align";
import type { Device, Dtype, FromWorker, ToWorker } from "./kokoro.worker";
import type { Events, Player, Sentence, Stats } from "./player";

// How far ahead to synthesize, in seconds of speech at normal pace (about 14 MB as 16-bit audio).
const AHEAD_SECONDS = 300;
// Made speech kept for reuse, in seconds of audio (about 23 MB): what's ahead, and what was just
// heard, so pausing, going back a sentence or starting again nearby doesn't make it all again.
const KEEP_SECONDS = 480;
const KEEP_BEHIND = 20; // sentences already heard that are kept
// Sentences with the worker at once: one being made and one waiting, so it never sits idle.
const IN_FLIGHT = 2;
// After running out, wait until this much listening time is ready before carrying on.
export const REBUFFER_SECONDS = 20;
const PARAGRAPH_PAUSE = 0.35;

/**
 * How fast the voice itself speaks for a listening speed; playback makes up the rest. Up to 1.25×
 * the voice still sounds natural, and it gives the same listening for a quarter less synthesis.
 */
const voicePace = (rate: number) => (rate >= 1.5 ? 1.25 : 1);

/** A synthesized sentence: its audio, length, the pace it was spoken at, and word timings. */
type Ready = { blob: Blob; seconds: number; pace: number; words: WordTiming[] };

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
  private audio = new Audio();
  private stats: Stats = { stalls: { count: 0, seconds: 0 } };
  private totals = { audio: 0, gen: 0, chars: 0 };
  private recent: { audio: number; gen: number }[] = [];

  // One play() run; a load finishing for an earlier run is ignored.
  private run = 0;
  private nextId = 0;
  // Sentences with the worker. Whatever comes back is kept, even after a restart.
  private requests = new Map<number, { key: string; pace: number; chars: number }>();
  // Made speech by voice and text, oldest first, so it's found again wherever playback restarts.
  private made = new Map<string, Ready>();
  private madeSeconds = 0;
  private sentences: Sentence[] = [];
  private voice = "";
  private rate = 1;
  private pace = 1; // of the sentence playing
  private current = -1; // sentence in the audio element
  private words: WordTiming[] = [];
  private url: string | null = null;
  private waitingSince: number | null = null; // playback is waiting on synthesis
  private rebuffering = false; // ran out mid-way: waiting to get well ahead
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
      else this.requests.delete(msg.id);
    } else if (msg.type === "skipped") {
      this.requests.delete(msg.id);
      this.request();
    } else {
      const req = this.requests.get(msg.id);
      this.requests.delete(msg.id);
      const seconds = msg.samples.length / msg.sampleRate;
      const pace = req?.pace ?? 1;
      // Speed is measured in speech at normal pace, so it compares directly with listening speed.
      const spoken = seconds * pace;
      const gen = msg.genMs / 1000;
      this.totals.audio += spoken;
      this.totals.gen += gen;
      if (req) this.totals.chars += req.chars;
      if (req && this.totals.chars) this.setStats({ charsPerSecond: this.totals.chars / this.totals.audio });
      // "Recent" speed: over about the last two minutes of speech, so it holds steady from one
      // sentence to the next (short ones carry more fixed overhead) yet follows real changes.
      // The model's first sentence is slow while the GPU warms up: not counted.
      if (this.totals.audio > spoken || this.recent.length) this.recent.push({ audio: spoken, gen });
      while (this.recent.length > 1 && this.recent.reduce((a, r) => a + r.audio, 0) - this.recent[0].audio >= 120) this.recent.shift();
      const sum = (k: "audio" | "gen") => this.recent.reduce((a, r) => a + r[k], 0);
      const recent = this.recent.length ? sum("audio") / sum("gen") : spoken / gen;
      this.setStats({ speed: { last: spoken / gen, avg: this.totals.audio / this.totals.gen, recent } });
      if (!req) return;
      this.keep(req.key, { blob: wav(msg.samples, msg.sampleRate), seconds, pace, words: msg.words });
      this.reportAhead();
      this.request();
      if (this.waitingSince !== null) this.tryResume();
    }
  }

  private key(i: number) {
    return `${this.voice}\n${this.sentences[i].text}`;
  }

  /** Sentence `i` of what's being read, if it's been made in this voice. */
  private madeFor(i: number) {
    return i < this.sentences.length ? this.made.get(this.key(i)) : undefined;
  }

  /** Keep made speech; past the limit, drop the oldest that isn't just behind or ahead of playback. */
  private keep(key: string, r: Ready) {
    const old = this.made.get(key);
    if (old) this.madeSeconds -= old.seconds;
    this.made.delete(key);
    this.made.set(key, r);
    this.madeSeconds += r.seconds;
    if (this.madeSeconds <= KEEP_SECONDS) return;
    const wanted = new Set<string>();
    let ahead = 0;
    for (let i = Math.max(0, this.current - KEEP_BEHIND); i < this.sentences.length && ahead < AHEAD_SECONDS; i++) {
      wanted.add(this.key(i));
      const m = i > this.current ? this.madeFor(i) : undefined;
      if (m) ahead += m.seconds * m.pace;
    }
    for (const [k, m] of this.made) {
      if (this.madeSeconds <= KEEP_SECONDS) break;
      if (wanted.has(k)) continue;
      this.made.delete(k);
      this.madeSeconds -= m.seconds;
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
    this.current = from - 1;
    this.events.onState("loading");
    await this.load();
    if (run !== this.run) return;
    this.waitingSince = performance.now();
    // Known to be slower than this speed (from earlier listening): get ahead before starting.
    this.rebuffering = (this.stats.speed?.recent ?? Infinity) < rate;
    this.request();
    this.reportAhead();
    this.tick();
    this.tryResume();
  }

  setRate(rate: number) {
    this.rate = rate;
    this.audio.playbackRate = rate / this.pace;
  }

  /** Speech made from the next sentence on, without a gap. */
  private reportAhead() {
    let seconds = 0;
    let i = this.current + 1;
    for (let r; (r = this.madeFor(i)); i++) seconds += r.seconds * r.pace;
    this.setStats({ ahead: { seconds, complete: i >= this.sentences.length } });
  }

  /** Keep the worker busy until AHEAD_SECONDS of speech is ready beyond the sentence playing. */
  private request() {
    if (!this.sentences.length || this.requests.size >= IN_FLIGHT) return;
    const pending = new Set([...this.requests.values()].map((r) => r.key));
    let ahead = 0;
    for (let i = this.current + 1; i < this.sentences.length && this.requests.size < IN_FLIGHT && ahead < AHEAD_SECONDS; i++) {
      const made = this.madeFor(i);
      if (made) ahead += made.seconds * made.pace;
      const key = this.key(i);
      if (made || pending.has(key)) continue;
      const id = this.nextId++;
      const pace = voicePace(this.rate);
      const text = this.sentences[i].text;
      this.requests.set(id, { key, pace, chars: text.length });
      pending.add(key);
      this.send({ type: "speak", id, text, voice: this.voice, speed: pace });
    }
  }

  /** Waiting for synthesis: carry on once the next sentence is ready (after running out, once well ahead). */
  private tryResume() {
    if (this.paused || this.waitingSince === null || !this.madeFor(this.current + 1)) return;
    if (this.rebuffering) {
      let listening = 0;
      let i = this.current + 1;
      for (let r; (r = this.madeFor(i)); i++) listening += (r.seconds * r.pace) / this.rate;
      if (listening < REBUFFER_SECONDS && i < this.sentences.length) return;
    }
    this.advance();
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
    const r = this.madeFor(next);
    if (!r) {
      if (this.waitingSince === null) {
        this.waitingSince = performance.now();
        if (this.current >= 0) {
          this.rebuffering = true;
          this.setStats({ stalls: { ...this.stats.stalls, count: this.stats.stalls.count + 1 } });
          this.events.onState("loading");
        }
      }
      return;
    }
    if (this.waitingSince !== null && this.current >= 0) {
      const waited = (performance.now() - this.waitingSince) / 1000;
      this.setStats({ stalls: { ...this.stats.stalls, seconds: this.stats.stalls.seconds + waited } });
    }
    this.waitingSince = null;
    this.rebuffering = false;
    this.current = next;
    this.reportAhead();
    this.words = r.words;
    this.shownWord = -1;
    this.pace = r.pace;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(r.blob);
    this.audio.src = this.url;
    this.audio.playbackRate = this.rate / r.pace;
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
    // Scheduled first, so a slip in highlighting one word can't stop it for good.
    this.frame = requestAnimationFrame(this.tick);
    if (this.current >= 0 && this.waitingSince === null) {
      const t = this.audio.currentTime;
      let word = -1;
      for (let i = 0; i < this.words.length && this.words[i].start <= t; i++) word = i;
      if (word !== this.shownWord) {
        this.shownWord = word;
        this.events.onPosition(this.current, word);
      }
    }
  };

  pause() {
    this.paused = true;
    clearTimeout(this.gapTimer);
    this.audio.pause();
    this.events.onState("paused");
  }

  resume() {
    this.paused = false;
    if (this.waitingSince !== null) {
      this.events.onState("loading");
      this.tryResume();
      return;
    }
    void this.audio.play();
    this.events.onState("playing");
  }

  /** Stop playing. Speech already made, and the sentence being made, are kept for next time. */
  stop() {
    this.run++;
    this.send({ type: "cancel", below: this.nextId });
    cancelAnimationFrame(this.frame);
    clearTimeout(this.gapTimer);
    this.audio.pause();
    this.waitingSince = null;
    this.rebuffering = false;
    this.paused = false;
    this.current = -1;
  }

  dispose() {
    this.stop();
    this.worker.terminate();
    if (this.url) URL.revokeObjectURL(this.url);
  }
}
