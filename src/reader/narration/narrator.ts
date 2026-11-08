// Reads the open book aloud: from the top of the page on screen, a section at a time, with the
// sentence and word being spoken highlighted in the page, pages turning to follow, and on into
// the next section at the end of one.
import type { FoliateView } from "../../lib/foliate";
import { isMostlyLinks, sectionText, type SectionText } from "./bookText";
import { wordSpan } from "./sentences";
import { KokoroPlayer } from "./kokoroPlayer";
import { BrowserPlayer } from "./browserPlayer";
import type { Player, Stats } from "./player";
import { DEVICE_VOICE } from "./voices";

export type NarrationStatus = "idle" | "loading" | "playing" | "paused";
export type NarrationState = {
  status: NarrationStatus;
  engine: "kokoro" | "device" | null;
  /** How many times faster than real time this device makes Kokoro speech (recent sentences). */
  speed: number | null;
  /** Speech made ahead of what's playing, in seconds at normal pace (Kokoro only). */
  ahead: { seconds: number; complete: boolean } | null;
  /** Speech left in the section from the sentence being read, in seconds at normal pace. */
  left: number | null;
  /** Times playback has waited for the next sentence since narration started. */
  stalls: number;
  /** The voice model download, while it's under way. */
  download: { loaded: number; total: number } | null;
  error: string | null;
};

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

const SENTENCE = "ribbon-narration-sentence";
const WORD = "ribbon-narration-word";
/** After the reader turns pages themselves, leave them there this long before following again. */
const HANDS_OFF_MS = 8000;

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export class Narrator {
  private player: Player | null = null;
  private section: { index: number; text: SectionText } | null = null;
  private sentence = -1;
  private word: Range | null = null; // the word being read, highlighted
  private voice = "";
  private rate = 1;
  private startedVoice = ""; // the voice the current playback was started with
  private state: NarrationState = { status: "idle", engine: null, speed: null, ahead: null, left: null, stalls: 0, download: null, error: null };
  // Characters per second of speech at normal pace: measured from Kokoro once it has spoken,
  // until then a typical narration pace.
  private cps = 14.5;
  private stallBase = 0; // the player's stall count when this narration started
  private lastStalls = 0;
  private turning = false; // a page turn or section change of our own is under way
  private userMovedAt = 0;
  private movedWhilePaused = false;
  private color: string;
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
      ribbon: string;
      onChange: (s: NarrationState) => void;
      /** Called before narration turns the page, so the move counts as reading. */
      onTurn: () => void;
      /** Whether the reader has just touched, scrolled or keyed (so a move is theirs, not a reflow). */
      userActive: () => boolean;
    },
  ) {
    this.color = opts.ribbon;
    view.addEventListener("relocate", this.onRelocate);
  }

  private get renderer() {
    return this.view.renderer;
  }

  private set(s: Partial<NarrationState>) {
    this.state = { ...this.state, ...s };
    this.opts.onChange(this.state);
  }

  private onRelocate = (e: Event) => {
    // Our own turns, and relayouts nobody asked for (a resize, the player making room), aren't the
    // reader moving away.
    if (this.turning || this.state.status === "idle" || !this.opts.userActive()) return;
    const d = (e as CustomEvent<{ section?: { current: number } }>).detail;
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
        if (st.charsPerSecond) this.cps = st.charsPerSecond;
        if (st.ahead) this.set({ ahead: st.ahead });
        if (st.download && st.loadMs === undefined) this.set({ download: st.download });
        this.lastStalls = st.stalls.count;
        if (st.speed) this.set({ speed: st.speed.recent, stalls: st.stalls.count - this.stallBase });
      },
      onError: (m: string) => this.fail(m),
      onEnd: () => void this.nextSection(),
    };
    const english = /^en\b/i.test(this.opts.lang);
    if (this.voice === DEVICE_VOICE || !english || !(await hasGPU())) {
      if (!(this.player instanceof BrowserPlayer)) {
        this.player?.stop();
        this.player = new BrowserPlayer(events, this.opts.lang.split("-")[0] || "en");
      }
      this.set({ engine: "device", ahead: null });
    } else {
      if (!(this.player instanceof KokoroPlayer)) {
        this.player?.stop();
        shared.ribbonKokoro ??= new KokoroPlayer("webgpu", events);
        this.player = shared.ribbonKokoro;
      }
      this.player.events = events;
      this.set({ engine: "kokoro" });
    }
    return this.player;
  }

  /**
   * Carry on if paused, unless the reader has since moved to a page without that sentence; else
   * start reading at the top of the page on screen.
   */
  async play(voice: string, rate: number) {
    this.begin(voice, rate);
    const contents = this.renderer.getContents()[0];
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
    const contents = this.renderer.getContents().find((c) => c.doc === doc);
    if (!contents) return;
    this.useSection(contents);
    const text = this.section!.text;
    const pieces = text.pieces;
    if (!pieces.length) return;
    let i = 0;
    for (; i < pieces.length; i++) {
      const r = text.range(i);
      try {
        if (range.comparePoint(r.endContainer, r.endOffset) >= 0) break;
      } catch {
        i = 0;
        break;
      }
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
        this.paintStyle(contents.doc);
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
    this.paintStyle(text.doc);
    this.mediaSession();
    const player = await this.engine();
    if (run !== this.run) return;
    this.handedOver = true;
    void player.play(text.pieces, from, this.voice === DEVICE_VOICE ? "" : this.voice, this.rate);
  }

  /** The first piece of `text` (the section being read by default) that starts on the page on screen. */
  private firstOnScreen(text = this.section?.text): number {
    const visible = this.view.lastLocation?.range;
    if (!visible || !text) return 0;
    for (let i = 0; i < text.pieces.length; i++) {
      const r = text.range(i);
      try {
        if (visible.comparePoint(r.startContainer, r.startOffset) >= 0) return i;
      } catch {
        return 0;
      }
    }
    return text.pieces.length;
  }

  /**
   * Keep what's being read on screen through a change in the page's size (the player taking or
   * giving back room): the page is laid out again around the word being read, or if nothing on
   * screen is being read, the first sentence on screen. Call just before the change.
   */
  async holdPlace(): Promise<void> {
    const contents = this.renderer.getContents()[0];
    const visible = this.view.lastLocation?.range;
    if (!contents || !visible) return;
    const onScreen = (r: Range) => {
      try {
        return visible.comparePoint(r.startContainer, r.startOffset) === 0;
      } catch {
        return false;
      }
    };
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
      await this.renderer.scrollToAnchor(point);
    } finally {
      this.turning = false;
    }
  }

  /** Whether any of piece `i` is on the page on screen. */
  private visible(i: number): boolean {
    const visible = this.view.lastLocation?.range;
    if (!visible || !this.section) return false;
    try {
      const r = this.section.text.range(i);
      return visible.comparePoint(r.startContainer, r.startOffset) <= 0 && visible.comparePoint(r.endContainer, r.endOffset) >= 0;
    } catch {
      return false;
    }
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
    const contents = this.renderer.getContents()[0];
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
    try {
      if (visible && visible.comparePoint(range.startContainer, range.startOffset) === 0) return;
    } catch {
      return;
    }
    this.turning = true;
    this.opts.onTurn();
    try {
      await this.renderer.scrollToAnchor(range);
    } finally {
      this.turning = false;
    }
  }

  private highlight(doc: Document, sentence: Range | null, word: Range | null) {
    const win = doc.defaultView as (Window & typeof globalThis) | null;
    const reg = win?.CSS?.highlights;
    if (!win || !reg || typeof win.Highlight !== "function") return;
    if (sentence) reg.set(SENTENCE, new win.Highlight(sentence));
    else reg.delete(SENTENCE);
    if (word) reg.set(WORD, new win.Highlight(word));
    else reg.delete(WORD);
  }

  private clearHighlight() {
    if (this.section) this.highlight(this.section.text.doc, null, null);
  }

  private paintStyle(doc: Document) {
    let el = doc.getElementById("ribbon-narration") as HTMLStyleElement | null;
    if (!el) {
      el = doc.createElement("style");
      el.id = "ribbon-narration";
      (doc.head ?? doc.documentElement).append(el);
    }
    el.textContent = `::highlight(${SENTENCE}) { background-color: ${rgba(this.color, 0.13)}; }
::highlight(${WORD}) { background-color: ${rgba(this.color, 0.32)}; }`;
  }

  setColor(ribbon: string) {
    this.color = ribbon;
    if (this.section) this.paintStyle(this.section.text.doc);
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
    const here = this.renderer.getContents().find((c) => c.index === this.section!.index);
    if (!here) {
      // The reader has gone to another chapter (while paused): carry on from there.
      const contents = this.renderer.getContents()[0];
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
