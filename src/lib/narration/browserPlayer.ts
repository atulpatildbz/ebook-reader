// The browser's own speech voices: the fallback where Kokoro can't run fast enough. Word
// positions come from the browser's boundary events, which some voices never send.
import type { Events, Player, Sentence } from "./kokoroPlayer";

export class BrowserPlayer implements Player {
  private run = 0;
  private sentences: Sentence[] = [];
  private current = 0;
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
    this.say(from, this.run);
  }

  private say(i: number, run: number) {
    if (run !== this.run) return;
    if (i >= this.sentences.length) {
      this.events.onState("idle");
      this.events.onEnd?.();
      return;
    }
    this.current = i;
    const text = this.sentences[i].text;
    const starts = [...text.matchAll(/\S+/g)].map((m) => m.index!);
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => v.voiceURI === this.voiceURI) ?? voices.find((v) => v.default && v.lang.startsWith(this.lang)) ?? voices.find((v) => v.lang.startsWith(this.lang)) ?? null;
    // Most voices top out around 2× however high this is set.
    u.rate = this.rate;
    u.onstart = () => {
      this.events.onState("playing");
      this.events.onPosition(i, -1);
    };
    u.onboundary = (e) => {
      if (e.name !== "word") return;
      let w = 0;
      while (w + 1 < starts.length && starts[w + 1] <= e.charIndex) w++;
      this.events.onPosition(i, w);
    };
    u.onend = () => this.say(i + 1, run);
    u.onerror = (e) => e.error !== "interrupted" && e.error !== "canceled" && this.events.onError(e.error);
    speechSynthesis.speak(u);
  }

  setRate(rate: number) {
    this.rate = rate;
    if (this.sentences.length && !this.paused) {
      this.run++;
      speechSynthesis.cancel();
      this.say(this.current, this.run);
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
