// Reads the open book aloud: from the top of the page on screen, a section at a time, with the
// sentence and word being spoken highlighted in the page, pages turning to follow, and on into
// the next section at the end of one.
import type { FoliateView, RelocateDetail } from "../../lib/foliate";
import { NARRATION_HIGHLIGHTS } from "../html";
import { isMostlyLinks, sectionText, type SectionText } from "./bookText";
import { wordSpan } from "./sentences";
import { KokoroPlayer } from "./kokoroPlayer";
import { BrowserPlayer } from "./browserPlayer";
import type { Player, Stats } from "./player";
import { AUTO_VOICE, BEST_VOICE, DEVICE_VOICE, LIGHT_VOICE, engineOf } from "./voices";
import { prefetchModel } from "./supertonicFiles";
import { readStored, writeStored } from "../../lib/storage";

type NarrationStatus = "idle" | "loading" | "playing" | "paused";
export type NarrationState = {
  status: NarrationStatus;
  engine: "kokoro" | "device" | null;
  /** Why the device's voice is reading instead of the Kokoro voice chosen. */
  fallback: "language" | "no-gpu" | null;
  /** Automatic is reading in the light voice: this device makes the best one too slowly. */
  light: boolean;
  /** How many times faster than real time this device makes Kokoro speech (recent sentences). */
  speed: number | null;
  /** Speech made ahead of what's playing, in seconds at normal pace (Kokoro only). */
  ahead: { seconds: number; complete: boolean } | null;
  /** Speech left in the section from the sentence being read, in seconds at normal pace. */
  left: number | null;
  /** Times playback has waited for the next sentence since narration started. */
  stalls: number;
  /** Ran out (or is known to be slower than this speed): waiting until well ahead to carry on. */
  rebuffering: boolean;
  /** The voice model download, while it's under way. */
  download: { loaded: number; total: number } | null;
  error: string | null;
};

export const IDLE: NarrationState = { status: "idle", engine: null, fallback: null, light: false, speed: null, ahead: null, left: null, stalls: 0, rebuffering: false, download: null, error: null };

type Contents = { index: number; doc: Document };

// One Kokoro model per page load, shared by every book opened. It's kept on the page rather than
// in this module because in development an edit loads this module afresh: the copy before it is
// shut down here, or each edit would leave another model loaded (a couple of gigabytes).
const shared = globalThis as { ribbonKokoro?: KokoroPlayer | null };
shared.ribbonKokoro?.dispose();
shared.ribbonKokoro = null;
let gpu: Promise<boolean> | null = null;
const hasGPU = () =>
  (gpu ??= (async () => {
    try {
      const n = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
      return !!(await n.gpu?.requestAdapter());
    } catch {
      return false;
    }
  })());

// How fast this device makes speech in the best voice (seconds of speech at normal pace per
// second), from the last time it was used: what Automatic goes by. Kept on the device; it's
// measured over the last couple of minutes, so it's the speed once the device has warmed up.
const BEST_SPEED_KEY = "ribbon:narration-best-speed";
// The speech made before a speed counts as measured (the first sentences are slow, the GPU warming up).
const MEASURED_SECONDS = 60;
// Automatic uses the best voice only with this much to spare over the listening speed.
const HEADROOM = 1.1;

/** After the reader turns pages themselves, leave them there this long before following again. */
const HANDS_OFF_MS = 8000;

/**
 * Where the start (or end) of `r` is relative to `area`: before (-1), inside (0) or after (1).
 * Null when `r` is from a layout of the page since replaced (another document).
 */
function place(area: Range, r: Range, edge: "start" | "end" = "start"): number | null {
  try {
    return edge === "start" ? area.comparePoint(r.startContainer, r.startOffset) : area.comparePoint(r.endContainer, r.endOffset);
  } catch {
    return null;
  }
}

export class Narrator {
  private player: Player | null = null;
  private section: { index: number; text: SectionText } | null = null;
  private sentence = -1;
  private word: Range | null = null; // the word being read, highlighted
  private voice = "";
  private rate = 1;
  private startedVoice = ""; // the voice the current playback was started with
  private speaking = ""; // the voice actually reading: the one chosen, or Automatic's pick
  private state = IDLE;
  // Characters per second of speech at normal pace: measured from Kokoro once it has spoken,
  // until then a typical narration pace.
  private cps = 14.5;
  private stallBase = 0; // the player's stall count when this narration started
  private lastStalls = 0;
  private turning = false; // a page turn or section change of our own is under way
  private userMovedAt = 0;
  private movedWhilePaused = false;
  // Goes up whenever what should happen next changes (pause, close, a new start). Whatever was
  // waiting on something slow gives up if it finds this has moved on.
  private run = 0;
  private handedOver = false; // the player has been given the section being read

  constructor(
    private view: FoliateView,
    private opts: {
      title: string;
      /** The book's language; Kokoro reads English, others use the device's voice. */
      lang: string;
      author: string;
      onChange: (s: NarrationState) => void;
      /** Called before narration turns the page, so the move counts as reading. */
      onTurn: () => void;
      /** Whether the reader has just touched, scrolled or keyed (so a move is theirs, not a reflow). */
      userActive: () => boolean;
    },
  ) {
    view.addEventListener("relocate", this.onRelocate);
  }

  private set(s: Partial<NarrationState>) {
    this.state = { ...this.state, ...s };
    this.opts.onChange(this.state);
  }

  private onRelocate = (e: Event) => {
    // Our own turns, and relayouts nobody asked for (a resize, the player making room), aren't the
    // reader moving away.
    if (this.turning || this.state.status === "idle" || !this.opts.userActive()) return;
    const d = (e as CustomEvent<RelocateDetail>).detail;
    this.userMovedAt = Date.now();
    // Moved to another section: what's being read is no longer on screen anywhere nearby.
    if ((this.state.status === "playing" || this.state.status === "loading") && this.section && d.section && d.section.current !== this.section.index) this.pause();
    if (this.state.status === "paused") this.movedWhilePaused = true;
  };

  private async engine(): Promise<Player> {
    const events = {
      onPosition: (s: number, w: number) => this.onPosition(s, w),
      onState: (s: NarrationStatus) => {
        if (s === "idle") return; // the end of a section, or a stop; handled where it happens
        this.set({ status: s, download: s === "loading" ? this.state.download : null });
      },
      onStats: (st: Stats) => {
        this.measured(st);
        if (st.charsPerSecond) this.cps = st.charsPerSecond;
        if (st.ahead) this.set({ ahead: st.ahead });
        if (st.download && st.loadMs === undefined) this.set({ download: st.download });
        this.lastStalls = st.stalls.count;
        if (st.rebuffering !== undefined) this.set({ rebuffering: st.rebuffering });
        if (st.speed) this.set({ speed: st.speed.recent, stalls: st.stalls.count - this.stallBase });
      },
      onError: (m: string) => this.fail(m),
      onEnd: () => void this.nextSection(),
    };
    const fallback = this.voice === DEVICE_VOICE ? null : !/^en\b/i.test(this.opts.lang) ? "language" : !(await hasGPU()) ? "no-gpu" : null;
    if (this.voice === DEVICE_VOICE || fallback) {
      if (!(this.player instanceof BrowserPlayer)) {
        this.player?.stop();
        this.player = new BrowserPlayer(events, this.opts.lang.split("-")[0] || "en");
      }
      this.set({ engine: "device", fallback, ahead: null, rebuffering: false });
    } else {
      if (!(this.player instanceof KokoroPlayer)) {
        this.player?.stop();
        shared.ribbonKokoro ??= new KokoroPlayer("webgpu", events);
        this.player = shared.ribbonKokoro;
      }
      this.player.events = events;
      this.set({ engine: "kokoro", fallback: null });
    }
    return this.player;
  }

  /**
   * Carry on if paused, unless the reader has since moved to a page without that sentence; else
   * start reading at the top of the page on screen.
   */
  async play(voice: string, rate: number) {
    this.begin(voice, rate);
    const contents = this.view.renderer.getContents()[0];
    if (!contents) return;
    const same = this.useSection(contents);
    if (same && this.state.status === "paused" && this.player && this.handedOver && this.sentence >= 0 && (!this.movedWhilePaused || this.visible(this.sentence))) {
      if (this.voice === this.startedVoice) this.player.resume();
      else void this.start(this.sentence);
      return;
    }
    await this.start(this.firstOnScreen());
  }

  /** Read from the sentence where `range` (text the reader selected) begins. */
  async playFrom(range: Range, voice: string, rate: number) {
    this.begin(voice, rate);
    const doc = range.startContainer.ownerDocument;
    const contents = this.view.renderer.getContents().find((c) => c.doc === doc);
    if (!contents) return;
    this.useSection(contents);
    const text = this.section!.text;
    const pieces = text.pieces;
    if (!pieces.length) return;
    let i = 0;
    for (; i < pieces.length; i++) {
      const at = place(range, text.range(i), "end");
      if (at === null) i = 0;
      if (at === null || at >= 0) break;
    }
    this.userMovedAt = 0;
    await this.start(Math.min(i, pieces.length - 1));
  }

  private begin(voice: string, rate: number) {
    this.voice = voice;
    this.rate = rate;
    this.stallBase = this.lastStalls;
    this.set({ error: null, stalls: 0 });
  }

  /**
   * Make the section on screen the one being read. Returns whether it already was (if the reader
   * left it and came back, its page has been laid out anew: the text is found again in that).
   */
  private useSection(contents: Contents): boolean {
    if (this.section?.index === contents.index) {
      if (this.section.text.doc !== contents.doc) {
        this.section = { index: contents.index, text: sectionText(contents.doc, this.opts.lang) };
      }
      return true;
    }
    this.section = { index: contents.index, text: sectionText(contents.doc, this.opts.lang) };
    return false;
  }

  private async start(from: number): Promise<void> {
    const text = this.section?.text;
    if (!text) return;
    if (from >= text.pieces.length) return this.nextSection();
    const run = ++this.run;
    this.handedOver = false;
    this.set({ status: "loading", ahead: null, left: this.leftFrom(from), error: null });
    this.sentence = from;
    this.startedVoice = this.voice;
    this.speaking = this.pick();
    this.set({ light: this.voice === AUTO_VOICE && this.speaking === LIGHT_VOICE });
    this.mediaSession();
    const player = await this.engine();
    if (run !== this.run) return;
    this.handedOver = true;
    void player.play(text.pieces, from, player instanceof KokoroPlayer ? this.speaking : "", this.rate);
  }

  /** The voice to read in: the one chosen, or for Automatic the best this device keeps up with. */
  private pick(): string {
    if (this.voice !== AUTO_VOICE) return this.voice;
    const speed = readStored<number>(BEST_SPEED_KEY);
    return typeof speed === "number" && speed < this.rate * HEADROOM ? LIGHT_VOICE : BEST_VOICE;
  }

  /**
   * Note how fast the best voice is made here. If Automatic is reading in it and the device is too
   * slow for this speed, fetch the light voice now, and move to it when the best one runs out
   * (instead of stopping to get ahead).
   */
  private measured(st: Stats) {
    if (!st.speed || st.speed.seconds < MEASURED_SECONDS || engineOf(this.speaking) !== "kokoro" || !(this.player instanceof KokoroPlayer)) return;
    writeStored(BEST_SPEED_KEY, st.speed.recent);
    if (this.voice !== AUTO_VOICE || st.speed.recent >= this.rate * HEADROOM) return;
    void prefetchModel();
    if (st.rebuffering) {
      const run = this.run;
      // Once the player has finished reporting: it's in the middle of handling running out.
      setTimeout(() => {
        if (run !== this.run || this.voice !== AUTO_VOICE || this.speaking === LIGHT_VOICE || this.state.status !== "loading" || !this.state.rebuffering) return;
        this.userMovedAt = 0;
        void this.start(Math.max(0, this.sentence));
      });
    }
  }

  /** The first piece of `text` (the section being read by default) that starts on the page on screen. */
  private firstOnScreen(text = this.section?.text): number {
    const visible = this.view.lastLocation?.range;
    if (!visible || !text) return 0;
    for (let i = 0; i < text.pieces.length; i++) {
      const at = place(visible, text.range(i));
      if (at === null) return 0;
      if (at >= 0) return i;
    }
    return text.pieces.length;
  }

  /**
   * Keep what's being read on screen through a change in the page's size (the player taking or
   * giving back room): the page is laid out again around the word being read, or if nothing on
   * screen is being read, the first sentence on screen. Call just before the change.
   */
  async holdPlace(): Promise<void> {
    const contents = this.view.renderer.getContents()[0];
    const visible = this.view.lastLocation?.range;
    if (!contents || !visible) return;
    const onScreen = (r: Range) => place(visible, r) === 0;
    let at: Range | null = null;
    if (this.section?.text.doc === contents.doc && this.sentence >= 0) {
      if (this.word && onScreen(this.word)) at = this.word;
      else if (this.visible(this.sentence)) at = this.section.text.range(this.sentence);
    }
    if (!at) {
      const text = this.section?.text.doc === contents.doc ? this.section.text : sectionText(contents.doc, this.opts.lang);
      const i = this.firstOnScreen(text);
      if (i < text.pieces.length) at = text.range(i);
    }
    if (!at || !onScreen(at)) return;
    const point = at.cloneRange();
    point.collapse(true);
    // It's on this page already, so nothing moves; the page just remembers it.
    this.turning = true;
    try {
      await this.view.renderer.scrollToAnchor(point);
    } finally {
      this.turning = false;
    }
  }

  /** Whether any of piece `i` is on the page on screen. */
  private visible(i: number): boolean {
    const visible = this.view.lastLocation?.range;
    if (!visible || !this.section || i >= this.section.text.pieces.length) return false;
    const r = this.section.text.range(i);
    const start = place(visible, r);
    const end = place(visible, r, "end");
    return start !== null && end !== null && start <= 0 && end >= 0;
  }

  private async nextSection(): Promise<void> {
    const { sections } = this.view.book;
    let i = (this.section?.index ?? -1) + 1;
    while (i < sections.length && (sections[i].linear === "no" || !sections[i].createDocument)) i++;
    this.clearHighlight();
    const run = ++this.run;
    this.handedOver = false;
    if (i >= sections.length) {
      this.releaseMediaSession();
      this.set({ status: "idle" });
      return;
    }
    this.turning = true;
    this.opts.onTurn();
    try {
      await this.view.goTo(i);
    } finally {
      this.turning = false;
    }
    if (run !== this.run) return; // paused or closed while the chapter was opening
    const contents = this.view.renderer.getContents()[0];
    if (!contents || contents.index !== i) return this.set({ status: "idle" });
    this.section = { index: i, text: sectionText(contents.doc, this.opts.lang) };
    if (isMostlyLinks(contents.doc)) return this.nextSection();
    await this.start(0);
  }

  /** Seconds of speech at normal pace from piece `from` to the end of the section. */
  private leftFrom(from: number): number | null {
    const pieces = this.section?.text.pieces;
    if (!pieces) return null;
    let chars = 0;
    for (let i = from; i < pieces.length; i++) chars += pieces[i].text.length;
    return chars / this.cps;
  }

  private onPosition(sentence: number, word: number) {
    const text = this.section?.text;
    if (!text || sentence >= text.pieces.length) return;
    if (sentence !== this.sentence || this.state.left === null) this.set({ left: this.leftFrom(sentence) });
    this.sentence = sentence;
    const piece = text.pieces[sentence];
    const sentenceRange = text.range(sentence);
    let wordRange: Range | null = null;
    if (word >= 0) {
      const span = wordSpan(piece.text, word);
      // A dash or "..." on its own isn't a word: leave the last one lit.
      if (!span) return;
      wordRange = text.range(sentence, span[0], span[1]);
    }
    this.word = wordRange;
    this.highlight(text.doc, sentenceRange, wordRange);
    void this.follow(wordRange ?? sentenceRange);
  }

  /** Turn to the page with `range` on it, unless the reader has just moved away themselves. */
  private async follow(range: Range) {
    if (this.turning || Date.now() - this.userMovedAt < HANDS_OFF_MS) return;
    const visible = this.view.lastLocation?.range;
    if (visible) {
      const at = place(visible, range);
      if (at === null || at === 0) return;
    }
    this.turning = true;
    this.opts.onTurn();
    try {
      await this.view.renderer.scrollToAnchor(range);
    } finally {
      this.turning = false;
    }
  }

  private highlight(doc: Document, sentence: Range | null, word: Range | null) {
    const win = doc.defaultView as (Window & typeof globalThis) | null;
    const reg = win?.CSS?.highlights;
    if (!win || !reg || typeof win.Highlight !== "function") return;
    const { sentence: SENTENCE, word: WORD } = NARRATION_HIGHLIGHTS;
    if (sentence) reg.set(SENTENCE, new win.Highlight(sentence));
    else reg.delete(SENTENCE);
    if (word) reg.set(WORD, new win.Highlight(word));
    else reg.delete(WORD);
  }

  private clearHighlight() {
    if (this.section) this.highlight(this.section.text.doc, null, null);
  }

  pause() {
    this.run++;
    this.movedWhilePaused = false;
    // Between chapters, or still starting, the player has nothing to pause yet.
    if (this.handedOver && this.player) this.player.pause();
    else this.set({ status: "paused" });
  }

  /** Back or forward by sentences, within the section. */
  skip(delta: number) {
    if (!this.section || this.sentence < 0) return;
    this.userMovedAt = 0;
    const here = this.view.renderer.getContents().find((c) => c.index === this.section!.index);
    if (!here) {
      // The reader has gone to another chapter (while paused): carry on from there.
      const contents = this.view.renderer.getContents()[0];
      if (!contents) return;
      this.useSection(contents);
      void this.start(this.firstOnScreen());
      return;
    }
    this.useSection(here);
    const n = this.section.text.pieces.length;
    void this.start(Math.max(0, Math.min(n - 1, this.sentence + delta)));
  }

  setRate(rate: number) {
    this.rate = rate;
    this.stallBase = this.lastStalls;
    this.set({ stalls: 0 });
    this.player?.setRate(rate);
  }

  setVoice(voice: string) {
    if (voice === this.voice) return;
    this.voice = voice;
    if (this.state.status === "playing" || this.state.status === "loading") {
      this.userMovedAt = 0;
      void this.start(Math.max(0, this.sentence));
    }
  }

  stop() {
    this.halt();
    this.releaseMediaSession();
    this.set({ status: "idle", download: null, ahead: null, left: null });
  }

  /** Narration can't carry on: stop, and say why. Play tries again. */
  private fail(message: string) {
    this.halt();
    this.set({ status: "idle", download: null, ahead: null, error: message });
  }

  private halt() {
    this.run++;
    this.handedOver = false;
    this.player?.stop();
    this.clearHighlight();
    this.sentence = -1;
    this.word = null;
  }

  destroy() {
    this.stop();
    this.view.removeEventListener("relocate", this.onRelocate);
  }

  private releaseMediaSession() {
    if (!("mediaSession" in navigator)) return;
    for (const a of ["play", "pause", "previoustrack", "nexttrack", "stop"] as const) navigator.mediaSession.setActionHandler(a, null);
    navigator.mediaSession.metadata = null;
  }

  /** Lock-screen and headphone controls. */
  private mediaSession() {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title: this.opts.title, artist: this.opts.author });
    ms.setActionHandler("play", () => void this.play(this.voice, this.rate));
    ms.setActionHandler("pause", () => this.pause());
    ms.setActionHandler("previoustrack", () => this.skip(-1));
    ms.setActionHandler("nexttrack", () => this.skip(1));
    ms.setActionHandler("stop", () => this.stop());
  }
}
