// Plays a list of sentences with Kokoro: synthesizes minutes ahead of the one being heard (also
// while paused), plays them one after another, and reports which sentence and word are spoken.
//
// Speech is synthesized at the voice's natural pace, or a little faster for fast listening, and
// sped up the rest of the way (keeping the pitch) as each sentence is queued. Sentences are queued
// back to back on one Web Audio clock, so the sound never stops between them: an <audio> element
// per sentence leaves a gap of up to a second on Android while its output starts up. Where the
// device can't synthesize as fast as the chosen speed, playback stops now and then to get well
// ahead, rather than after every sentence.
import type { WordTiming } from "./align";
import type { Device, Dtype, FromWorker, ToWorker } from "./kokoro.worker";
import type { Events, Player, Sentence, Stats } from "./player";
import { stretch } from "./stretch";

// How far ahead to synthesize, in seconds of speech at normal pace (about 14 MB as 16-bit audio).
const AHEAD_SECONDS = 300;
// Made speech kept for reuse, in seconds of audio (about 23 MB): what's ahead, and what was just
// heard, so pausing, going back a sentence or starting again nearby doesn't make it all again.
const KEEP_SECONDS = 480;
const KEEP_BEHIND = 20; // sentences already heard that are kept
// Sentences with the worker at once: one being made and one waiting, so it never sits idle.
const IN_FLIGHT = 2;
// Sentences queued for playback, counting the one playing: enough that the next is always queued
// even when the page is in the background and slow to hear that one has finished.
const QUEUED = 3;
// After running out, wait until this much listening time is ready before carrying on.
export const REBUFFER_SECONDS = 20;
const PARAGRAPH_PAUSE = 0.35;
// A sentence the model can't make is skipped; this many in a row means the model itself has failed.
const MAX_FAILED_SENTENCES = 3;

/**
 * How fast the voice itself speaks for a listening speed; playback makes up the rest. Up to 1.25×
 * the voice still sounds natural, and it gives the same listening for a quarter less synthesis.
 */
const voicePace = (rate: number) => (rate >= 1.5 ? 1.25 : 1);

/** A synthesized sentence: 16-bit audio, its length, the pace it was spoken at, and word timings. */
type Ready = { pcm: Int16Array; sampleRate: number; seconds: number; pace: number; words: WordTiming[] };

/** A sentence queued on the audio clock, from `from` seconds into it, sped up by `factor`. */
type Slot = { index: number; src: AudioBufferSourceNode; at: number; end: number; from: number; factor: number; words: WordTiming[] };

/** Silent 16-bit mono WAV. */
function silence(seconds: number, rate = 8000): string {
  const n = Math.round(seconds * rate);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

export class KokoroPlayer implements Player {
  private worker!: Worker;
  private ready: Promise<void> | null = null;
  private onReady = () => {};
  private ctx: AudioContext | null = null;
  // Silence looping on an <audio> element while narrating: it's what gets the lock-screen and
  // headphone controls (Web Audio alone doesn't), and keeps the page counted as playing media.
  private media = new Audio();
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
  private current = -1; // sentence being heard (or last heard)
  private slots: Slot[] = []; // queued on the audio clock, in order; the first may be playing
  private waitingSince: number | null = null; // playback is waiting on synthesis
  private rebuffering = false; // ran out mid-way: waiting to get well ahead
  private paused = false;
  private waking = false; // the audio is being started, so it may still report being stopped
  private failedInARow = 0;
  private frame = 0;
  private shownWord = -1;

  constructor(
    private device: Device,
    public events: Events,
    private dtype?: Dtype,
  ) {
    this.spawn();
    this.media.src = silence(10);
    this.media.loop = true;
    this.media.onpause = () => this.media.paused && this.interrupted();
  }

  private spawn() {
    this.worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.worker.onerror = (e) => this.broken(e.message || "The voice could not start");
  }

  /** The model can't be used: stop, start again from nothing next time, and say why. */
  private broken(message: string) {
    this.stop();
    this.worker.terminate();
    this.spawn();
    this.requests.clear();
    this.failedInARow = 0;
    this.ready = null;
    this.events.onError(message);
    this.onReady(); // lets a play() still waiting on the load finish (it finds it was stopped)
  }

  /** Something else took the sound away (a call, another app): show paused, not playing in silence. */
  private interrupted() {
    if (this.paused || this.waking || (!this.slots.length && this.waitingSince === null)) return;
    this.pause();
  }

  /** Start the sound, from a tap or a media key. */
  private wake() {
    const ctx = this.ctx;
    if (ctx) {
      this.waking = true;
      void ctx.resume().finally(() => (this.waking = false));
    }
    void this.media.play().catch(() => {});
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
      const req = msg.id === undefined ? undefined : this.requests.get(msg.id);
      if (!req || ++this.failedInARow >= MAX_FAILED_SENTENCES) return this.broken(msg.message);
      // One bad sentence shouldn't end the chapter: a moment's silence stands in for it.
      console.warn("Skipping a sentence the voice could not make", msg.message);
      this.requests.delete(msg.id!);
      const sampleRate = 24000;
      this.keep(req.key, { pcm: new Int16Array(sampleRate / 20), sampleRate, seconds: 0.05, pace: 1, words: [] });
      this.madeOne();
    } else if (msg.type === "skipped") {
      this.requests.delete(msg.id);
      this.request();
    } else {
      const req = this.requests.get(msg.id);
      this.requests.delete(msg.id);
      this.failedInARow = 0;
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
      const pcm = new Int16Array(msg.samples.length);
      for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-1, Math.min(1, msg.samples[i])) * 0x7fff;
      this.keep(req.key, { pcm, sampleRate: msg.sampleRate, seconds, pace, words: msg.words });
      this.madeOne();
    }
  }

  /** A sentence has just been made. */
  private madeOne() {
    this.reportAhead();
    this.request();
    // Queue it straight away if it's next: waiting until the sentence playing ends would leave
    // a gap while it's queued.
    if (this.waitingSince !== null) this.tryResume();
    else if (this.slots.length) this.schedule();
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
    // Inside the tap that started narration, so the browser lets sound play.
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "playback" });
      this.ctx.onstatechange = () => this.ctx?.state !== "running" && this.interrupted();
    }
    this.wake();
    this.sentences = sentences;
    this.voice = voice;
    this.rate = rate;
    this.current = from - 1;
    this.waitingSince = performance.now();
    this.events.onState("loading");
    await this.load();
    if (run !== this.run) return;
    // Known to be slower than this speed (from earlier listening): get ahead before starting.
    this.rebuffering = (this.stats.speed?.recent ?? Infinity) < rate;
    this.request();
    this.reportAhead();
    this.tick();
    this.tryResume();
  }

  /** Change speed at once: the sentence playing is queued again from where it's got to. */
  setRate(rate: number) {
    this.rate = rate;
    const ctx = this.ctx;
    const first = this.slots[0];
    if (!ctx || !first) return;
    const t = ctx.currentTime;
    const from = t >= first.at ? first.from + (t - first.at) * first.factor : 0;
    const r = this.madeFor(first.index);
    this.clearSlots();
    if (!r) return;
    this.slots.push(this.slot(first.index, r, t + 0.02, from));
    this.schedule();
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
      const waited = (performance.now() - this.waitingSince) / 1000;
      this.setStats({ stalls: { ...this.stats.stalls, seconds: this.stats.stalls.seconds + waited } });
    }
    this.waitingSince = null;
    this.rebuffering = false;
    this.schedule();
    this.events.onState("playing");
  }

  /** Queue the sentences after those queued, back to back, as far as they're made. */
  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.slots.length < QUEUED) {
      const last = this.slots.at(-1);
      const index = last ? last.index + 1 : this.current + 1;
      const r = this.madeFor(index);
      if (!r) return;
      const gap = index > 0 && this.sentences[index].paragraphStart ? PARAGRAPH_PAUSE / this.rate : 0;
      this.slots.push(this.slot(index, r, Math.max(ctx.currentTime + 0.05, (last?.end ?? 0) + gap), 0));
    }
  }

  /** Sentence `index`, from `from` seconds in, sped up to the listening speed and queued at `at`. */
  private slot(index: number, r: Ready, at: number, from: number): Slot {
    const ctx = this.ctx!;
    const factor = this.rate / r.pace;
    const skip = Math.min(r.pcm.length, Math.floor(from * r.sampleRate));
    const x = new Float32Array(r.pcm.length - skip);
    for (let i = 0; i < x.length; i++) x[i] = r.pcm[skip + i] / 0x8000;
    const y = stretch(x, factor, r.sampleRate);
    const buf = ctx.createBuffer(1, Math.max(1, y.length), r.sampleRate);
    buf.copyToChannel(y, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const slot: Slot = { index, src, at, end: at + buf.duration, from, factor, words: r.words };
    src.onended = () => this.ended(slot);
    src.start(at);
    return slot;
  }

  private clearSlots() {
    for (const s of this.slots) {
      s.src.onended = null;
      try {
        s.src.stop();
      } catch {
        // never started
      }
      s.src.disconnect();
    }
    this.slots = [];
  }

  /** A sentence finished: queue more, or wait for synthesis if there's nothing, or end. */
  private ended(slot: Slot) {
    const i = this.slots.indexOf(slot);
    if (i < 0) return;
    this.slots.splice(i, 1);
    slot.src.disconnect();
    this.update();
    if (this.slots.length) return this.schedule();
    this.current = slot.index;
    if (slot.index + 1 >= this.sentences.length) {
      this.stop();
      this.events.onState("idle");
      this.events.onEnd?.();
      return;
    }
    this.schedule();
    if (this.slots.length) return;
    // Ran out: wait until well ahead again.
    this.waitingSince = performance.now();
    this.rebuffering = true;
    this.setStats({ stalls: { ...this.stats.stalls, count: this.stats.stalls.count + 1 } });
    this.events.onState("loading");
  }

  /** Report the sentence and word being heard, by the audio clock. */
  private update() {
    const ctx = this.ctx;
    const s = this.slots[0];
    if (!ctx || !s) return;
    // The clock runs a little ahead of what's heard.
    const t = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    if (t < s.at) return;
    if (s.index !== this.current) {
      this.current = s.index;
      this.shownWord = -1;
      this.events.onPosition(s.index, -1);
      this.reportAhead();
      this.request();
      this.schedule();
    }
    const at = s.from + (t - s.at) * s.factor; // seconds into the sentence as synthesized
    let word = -1;
    for (let i = 0; i < s.words.length && s.words[i].start <= at; i++) word = i;
    if (word !== this.shownWord) {
      this.shownWord = word;
      this.events.onPosition(s.index, word);
    }
  }

  private tick = () => {
    // Scheduled first, so a slip in highlighting one word can't stop it for good.
    this.frame = requestAnimationFrame(this.tick);
    this.update();
  };

  pause() {
    this.paused = true;
    void this.ctx?.suspend();
    this.media.pause();
    this.events.onState("paused");
  }

  resume() {
    this.paused = false;
    this.wake();
    if (this.waitingSince !== null) {
      this.events.onState("loading");
      this.tryResume();
      return;
    }
    this.events.onState("playing");
  }

  /** Stop playing. Speech already made, and the sentence being made, are kept for next time. */
  stop() {
    this.run++;
    this.send({ type: "cancel", below: this.nextId });
    cancelAnimationFrame(this.frame);
    this.clearSlots();
    this.media.pause();
    this.waitingSince = null;
    this.rebuffering = false;
    this.paused = false;
    this.current = -1;
  }

  dispose() {
    this.stop();
    this.worker.terminate();
    void this.ctx?.close();
  }
}
