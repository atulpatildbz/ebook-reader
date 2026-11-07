// The browser's own speech voices: the fallback where Kokoro can't run. Word positions come from
// the browser's boundary events, which some voices never send.
import type { Events, Player, Sentence } from "./kokoroPlayer";

// Sentences handed to the browser ahead of the one being spoken, so it goes straight from one to
// the next instead of pausing while each is passed over (Android's voices take a moment to start).
const QUEUE = 3;

export class BrowserPlayer implements Player {
  private run = 0;
  private sentences: Sentence[] = [];
  private current = 0;
  private queued = 0; // next sentence to hand over
  private voiceURI = "";
  private rate = 1;
  private paused = false;
  /** Language of the text, for picking a voice when none is chosen. */
  lang = "en";

  constructor(public events: Events) {}

  play(sentences: Sentence[], from: number, voiceURI: string, rate: number) {
    this.stop();
    this.sentences = sentences;
    this.voiceURI = voiceURI;
    this.rate = rate;
    this.startAt(from);
  }

  private startAt(i: number) {
    this.current = i;
    this.queued = i;
    if (i >= this.sentences.length) return this.finish(this.run);
    this.topUp(this.run);
  }

  private finish(run: number) {
    if (run !== this.run) return;
    this.events.onState("idle");
    this.events.onEnd?.();
  }

  private topUp(run: number) {
    while (this.queued < this.sentences.length && this.queued <= this.current + QUEUE) this.say(this.queued++, run);
  }

  private say(i: number, run: number) {
    const text = this.sentences[i].text;
    const starts = [...text.matchAll(/\S+/g)].map((m) => m.index!);
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice =
      voices.find((v) => v.voiceURI === this.voiceURI) ??
      voices.find((v) => v.default && v.lang.startsWith(this.lang)) ??
      voices.find((v) => v.lang.startsWith(this.lang)) ??
      null;
    // Most voices top out around 2× however high this is set.
    u.rate = this.rate;
    u.onstart = () => {
      if (run !== this.run) return;
      this.current = i;
      this.events.onState("playing");
      this.events.onPosition(i, -1);
      this.topUp(run);
    };
    u.onboundary = (e) => {
      if (run !== this.run || e.name !== "word") return;
      let w = 0;
      while (w + 1 < starts.length && starts[w + 1] <= e.charIndex) w++;
      this.events.onPosition(i, w);
    };
    if (i === this.sentences.length - 1) u.onend = () => this.finish(run);
    u.onerror = (e) => run === this.run && e.error !== "interrupted" && e.error !== "canceled" && this.events.onError(e.error);
    speechSynthesis.speak(u);
  }

  setRate(rate: number) {
    this.rate = rate;
    if (this.sentences.length && !this.paused) {
      this.run++;
      speechSynthesis.cancel();
      this.startAt(this.current);
    }
  }

  pause() {
    this.paused = true;
    speechSynthesis.pause();
    this.events.onState("paused");
  }

  resume() {
    this.paused = false;
    speechSynthesis.resume();
    this.events.onState("playing");
  }

  stop() {
    this.run++;
    this.paused = false;
    speechSynthesis.cancel();
  }

  dispose() {
    this.stop();
  }
}
