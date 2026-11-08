// Where the reader is in the book, kept in step across devices. Each move the reader makes is saved
// in this browser at once and pushed to Convex 1.5 s after the page settles, and when the tab is
// hidden or closed. Moves the reader didn't make, like a resize reflowing the text, are not saved.
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { FoliateView, RelocateDetail, Target } from "../lib/foliate";
import { deviceId, deviceName } from "./device";
import { toXPointer, xpointerToCFI } from "./xpointer";

/** The synced position. From an e-reader it has no CFI (`""`), only a KOReader XPointer. */
export type Remote = NonNullable<FunctionReturnType<typeof api.progress.get>>;
export type SavePosition = (p: FunctionArgs<typeof api.progress.save>) => Promise<unknown>;

/** This browser's copy of the last position, so a page turn made offline is never lost. */
type Local = { cfi: string; xpointer?: string; fraction: number; chapter?: string; updatedAt: number; pushed: boolean };

const key = (bookId: string) => `ribbon:pos:${bookId}`;

function readLocal(bookId: string): Local | null {
  try {
    const raw = localStorage.getItem(key(bookId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(bookId: string, p: Local) {
  try {
    localStorage.setItem(key(bookId), JSON.stringify(p));
  } catch {
    /* storage full or disabled */
  }
}

/** Where a synced position is in this book: its CFI, else the e-reader's XPointer, else the percentage. */
async function placeOf(view: FoliateView, r: Remote): Promise<Target> {
  if (r.cfi) return r.cfi;
  return (r.xpointer && !view.isFixedLayout && (await xpointerToCFI(view, r.xpointer))) || { fraction: r.fraction };
}

/** The position as e-readers name it (reflowable books only). */
function xpointerOf(view: FoliateView, d: RelocateDetail) {
  if (view.isFixedLayout || !d.range || d.section === undefined) return undefined;
  try {
    return toXPointer(d.section.current, d.range) ?? undefined;
  } catch {
    return undefined;
  }
}

/** A page move within this long of the reader touching, keying or scrolling is theirs. */
const OWN_MOVE_MS = 4000;
/** After "Go there", page moves this long are the other device's position settling in. */
const FOLLOW_MS = 2000;

export class Position {
  private last: Local | null = null;
  private pushedCfi: string | null = null;
  private actedAt = 0;
  private narratedAt = 0;
  // While following another device's position, the pages shown are that device's reading, not
  // this one's: they are not saved back (which would prompt the other device).
  private following: { until: number; updatedAt: number } | null = null;
  private shown: string | null = null; // CFI of the page on screen, from the last relocate
  private timer: number | undefined;

  constructor(
    private bookId: Id<"books">,
    /** Replaced on each render, so the latest is always used. */
    public save: SavePosition,
  ) {}

  /** The reader touched, keyed, scrolled or picked somewhere to go: the next move is theirs. */
  userActed() {
    this.actedAt = Date.now();
    this.following = null;
  }

  userActedWithin(ms: number) {
    return Date.now() - this.actedAt < ms;
  }

  /** Narration is turning the page: that counts as reading on. */
  narrationTurned() {
    this.narratedAt = Date.now();
  }

  get cfi() {
    return this.last?.cfi || null;
  }

  /** Where to open the book: the newest of this device's position and the synced one. */
  async start(view: FoliateView, remote: Remote | null | undefined): Promise<{ target: Target | null; from?: string }> {
    const local = readLocal(this.bookId);
    if (remote && (!local || remote.updatedAt > local.updatedAt)) {
      const target = await placeOf(view, remote);
      const cfi = typeof target === "string" ? target : "";
      this.last = { cfi, xpointer: remote.xpointer ?? undefined, fraction: remote.fraction, chapter: remote.chapter ?? undefined, updatedAt: remote.updatedAt, pushed: true };
      this.pushedCfi = cfi;
      writeLocal(this.bookId, this.last);
      return { target, from: remote.device !== deviceId ? remote.deviceName : undefined };
    }
    if (!local) return { target: null };
    this.last = local;
    if (!local.pushed) this.push(); // read offline last time
    else this.pushedCfi = local.cfi;
    return { target: local.cfi };
  }

  /** A page was shown. Returns whether it became the reader's new position. */
  relocated(view: FoliateView, d: RelocateDetail): boolean {
    // The paginator also reports the page it is already on (a tap ends in a "snap" back to it), and
    // each device names the same page by a slightly different CFI, so only a change from the last
    // page shown here counts as moving.
    const moved = this.shown !== null && d.cfi !== this.shown;
    this.shown = d.cfi;
    if (!d.cfi || d.cfi === this.last?.cfi) return false;
    const chapter = d.tocItem?.label?.trim();
    const f = this.following;
    if (f && Date.now() < f.until) {
      this.last = { cfi: d.cfi, fraction: d.fraction, chapter, updatedAt: f.updatedAt, pushed: true };
      this.pushedCfi = d.cfi;
      writeLocal(this.bookId, this.last);
      return false;
    }
    this.following = null;
    if (this.last && (!moved || Date.now() - Math.max(this.actedAt, this.narratedAt) > OWN_MOVE_MS)) return false;
    this.last = { cfi: d.cfi, xpointer: xpointerOf(view, d), fraction: d.fraction, chapter, updatedAt: Date.now(), pushed: false };
    writeLocal(this.bookId, this.last);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(this.push, 1500);
    return true;
  }

  /** Whether a synced position from another device is ahead of this one and elsewhere. */
  isNews(view: FoliateView, remote: Remote) {
    if (remote.device === deviceId) return false;
    if (this.last && remote.updatedAt <= this.last.updatedAt) return false;
    return remote.cfi !== view.lastLocation?.cfi;
  }

  /** Go to another device's position, without saving it back as this device's reading. */
  async follow(view: FoliateView, remote: Remote) {
    this.actedAt = 0;
    this.following = { until: Date.now() + FOLLOW_MS, updatedAt: remote.updatedAt };
    await view.goTo(await placeOf(view, remote));
  }

  push = () => {
    window.clearTimeout(this.timer);
    const p = this.last;
    if (!p || p.pushed || p.cfi === this.pushedCfi) return;
    this.pushedCfi = p.cfi;
    this.save({ bookId: this.bookId, cfi: p.cfi, xpointer: p.xpointer, fraction: p.fraction, chapter: p.chapter, device: deviceId, deviceName, updatedAt: p.updatedAt })
      .then(() => {
        if (this.last === p) {
          this.last = { ...p, pushed: true };
          writeLocal(this.bookId, this.last);
        }
      })
      .catch((e) => {
        console.warn("Position not synced yet", e);
        this.pushedCfi = null;
      });
  };

  /** Push when the tab is hidden or closed, and when done with the book. Returns the cleanup. */
  pushOnLeave() {
    const hidden = () => document.visibilityState === "hidden" && this.push();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", this.push);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", this.push);
      this.push();
    };
  }
}
