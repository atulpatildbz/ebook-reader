// Reads the open book aloud: from the top of the page on screen, a section at a time, with the
// sentence and word being spoken highlighted in the page, pages turning to follow, and on into
// the next section at the end of one.
import type { FoliateView } from "../foliate";
import { isMostlyLinks, sectionText, type SectionText } from "./bookText";
import { KokoroPlayer, type Player, type Stats } from "./kokoroPlayer";
import { BrowserPlayer } from "./browserPlayer";

export type NarrationStatus = "idle" | "loading" | "playing" | "paused";
export type NarrationState = {
  status: NarrationStatus;
  engine: "kokoro" | "device" | null;
  /** The voice model download, while it's under way. */
  download: { loaded: number; total: number } | null;
  error: string | null;
};

/** The voice id that means "this device's own voice" rather than a Kokoro voice. */
export const DEVICE_VOICE = "device";

type Contents = { index: number; doc: Document };
type Renderer = { getContents(): Contents[]; scrollToAnchor(r: Range): Promise<void> };

// One Kokoro model per page load, shared by every book opened.
let kokoro: KokoroPlayer | null = null;
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
  private voice = "af_heart";
  private rate = 1;
  private startedVoice = ""; // the voice the current playback was started with
  private state: NarrationState = { status: "idle", engine: null, download: null, error: null };
  private turning = false; // a page turn or section change of our own is under way
  private userMovedAt = 0;
  private color: string;

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
    },
  ) {
    this.color = opts.ribbon;
    view.addEventListener("relocate", this.onRelocate);
  }

  private get renderer() {
    return this.view.renderer as unknown as Renderer;
  }

  private set(s: Partial<NarrationState>) {
    this.state = { ...this.state, ...s };
    this.opts.onChange(this.state);
  }

  private onRelocate = (e: Event) => {
    if (this.turning || this.state.status === "idle") return;
    const d = (e as CustomEvent<{ section?: { current: number } }>).detail;
    this.userMovedAt = Date.now();
    // Moved to another section: what's being read is no longer on screen anywhere nearby.
    if (this.state.status === "playing" && this.section && d.section && d.section.current !== this.section.index) this.pause();
  };

  private async engine(): Promise<Player> {
    const events = {
      onPosition: (s: number, w: number) => this.onPosition(s, w),
      onState: (s: NarrationStatus) => {
        if (s === "idle") return; // the end of a section, or a stop; handled where it happens
        this.set({ status: s, download: s === "loading" ? this.state.download : null });
      },
      onStats: (st: Stats) => {
        if (st.download && st.loadMs === undefined) this.set({ download: st.download });
      },
      onError: (m: string) => this.set({ error: m }),
      onEnd: () => void this.nextSection(),
    };
    const english = /^en\b/i.test(this.opts.lang);
    if (this.voice === DEVICE_VOICE || !english || !(await hasGPU())) {
      if (!(this.player instanceof BrowserPlayer)) {
        this.player?.stop();
        this.player = new BrowserPlayer(events);
      }
      (this.player as BrowserPlayer).lang = this.opts.lang.split("-")[0] || "en";
      this.set({ engine: "device" });
    } else {
      if (!(this.player instanceof KokoroPlayer)) {
        this.player?.stop();
        kokoro ??= new KokoroPlayer("webgpu", events);
        this.player = kokoro;
      }
      this.player.events = events;
      this.set({ engine: "kokoro" });
    }
    return this.player;
  }

  /** Start reading at the top of the page on screen, or carry on if paused there. */
  async play(voice: string, rate: number) {
    this.voice = voice;
    this.rate = rate;
    this.set({ error: null });
    // Paused with the sentence still on screen: carry on from it.
    if (this.state.status === "paused" && this.player && this.onScreen()) {
      if (this.voice === this.startedVoice) this.player.resume();
      else void this.start(this.sentence);
      return;
    }
    const contents = this.renderer.getContents()[0];
    if (!contents) return;
    this.section = { index: contents.index, text: sectionText(contents.doc, this.opts.lang) };
    await this.start(this.firstOnScreen());
  }

  private async start(from: number): Promise<void> {
    const text = this.section?.text;
    if (!text) return;
    if (from >= text.pieces.length) return this.nextSection();
    this.set({ status: "loading" });
    this.sentence = from;
    this.startedVoice = this.voice;
    this.paintStyle(text.doc);
    this.mediaSession();
    const player = await this.engine();
    void player.play(text.pieces, from, this.voice === DEVICE_VOICE ? "" : this.voice, this.rate);
  }

  /** The first piece that starts on the page on screen. */
  private firstOnScreen(): number {
    const visible = this.view.lastLocation?.range;
    const text = this.section?.text;
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

  private onScreen(): boolean {
    const visible = this.view.lastLocation?.range;
    if (!visible || !this.section || this.sentence < 0) return false;
    try {
      const r = this.section.text.range(this.sentence);
      return visible.comparePoint(r.startContainer, r.startOffset) === 0;
    } catch {
      return false;
    }
  }

  private async nextSection(): Promise<void> {
    const sections = this.view.book.sections as { linear?: string; createDocument?: unknown }[];
    let i = (this.section?.index ?? -1) + 1;
    while (i < sections.length && (sections[i].linear === "no" || !sections[i].createDocument)) i++;
    this.clearHighlight();
    if (i >= sections.length) {
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
    const contents = this.renderer.getContents()[0];
    if (!contents || contents.index !== i) return this.set({ status: "idle" });
    this.section = { index: i, text: sectionText(contents.doc, this.opts.lang) };
    if (isMostlyLinks(contents.doc)) return this.nextSection();
    await this.start(0);
  }

  private onPosition(sentence: number, word: number) {
    const text = this.section?.text;
    if (!text || sentence >= text.pieces.length) return;
    this.sentence = sentence;
    const piece = text.pieces[sentence];
    const sentenceRange = text.range(sentence);
    let wordRange: Range | null = null;
    if (word >= 0) {
      const m = [...piece.text.matchAll(/\S+/g)][word];
      if (m) {
        // Leave quotes and punctuation around the word out of its highlight.
        const core = m[0].match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/u) ?? m;
        const from = m.index! + (core.index ?? 0);
        wordRange = text.range(sentence, from, from + core[0].length);
      }
    }
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
    this.player?.pause();
  }

  /** Back or forward by sentences, within the section. */
  skip(delta: number) {
    if (!this.section || this.sentence < 0) return;
    this.userMovedAt = 0;
    const n = this.section.text.pieces.length;
    void this.start(Math.max(0, Math.min(n - 1, this.sentence + delta)));
  }

  setRate(rate: number) {
    this.rate = rate;
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
    this.player?.stop();
    this.clearHighlight();
    this.sentence = -1;
    this.set({ status: "idle", download: null });
  }

  destroy() {
    this.stop();
    this.view.removeEventListener("relocate", this.onRelocate);
    if ("mediaSession" in navigator) {
      for (const a of ["play", "pause", "previoustrack", "nexttrack", "stop"] as const) navigator.mediaSession.setActionHandler(a, null);
      navigator.mediaSession.metadata = null;
    }
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
