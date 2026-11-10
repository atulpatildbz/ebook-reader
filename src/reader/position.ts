// Where the reader is in the book, kept in step across devices. Each move the reader makes is saved
// in this browser at once and pushed to Convex once the page settles, and when the tab is
// hidden or closed. Moves the reader didn't make, like a resize reflowing the text, are not saved.
// Times are on the server's clock as near as this device can tell, so a device whose clock is
// wrong doesn't lose out to the others (or beat them).
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { FoliateView, RelocateDetail, Target } from "../lib/foliate";
import { readStored, writeStored } from "../lib/storage";
import { deviceId, deviceName } from "./device";
import { toXPointer, xpointerToCFI } from "./xpointer";

/** The synced position. From an e-reader it has no CFI (`""`), only a KOReader XPointer. */
export type Remote = NonNullable<FunctionReturnType<typeof api.progress.get>>;
export type SavePosition = (p: FunctionArgs<typeof api.progress.save>) => Promise<FunctionReturnType<typeof api.progress.save>>;
/** Asks the server for the synced position now; resolves once it has answered. */
export type FreshPosition = () => Promise<Remote | null>;

/** This browser's copy of the last position, so a page turn made offline is never lost. */
type Local = { cfi: string; xpointer?: string; fraction: number; chapter?: string; updatedAt: number; pushed: boolean };

const key = (bookId: string) => `ribbon:pos:${bookId}`;

const readLocal = (bookId: string) => readStored<Local>(key(bookId));
const writeLocal = (bookId: string, p: Local) => writeStored(key(bookId), p);

const CLOCK = "ribbon:clock-offset";

/** How far this device's clock is behind the server's, in ms, as last measured. */
const clockOffset = () => Number(readStored<number>(CLOCK)) || 0;

/** The time now, on the server's clock. */
const now = () => Date.now() + clockOffset();

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
/** Away this long (tab hidden, computer asleep) and what this tab knows may be out of date. */
const AWAY_MS = 60_000;
/** Pages turned this soon after coming back may be turned on an out-of-date view of the book. */
const JUST_BACK_MS = 120_000;
/** Pushed this long after the last page turn. */
const SETTLE_MS = 1500;
/** A round trip longer than this says too little about the server's clock (the request sat queued). */
const CLOCK_ROUND_TRIP_MS = 5000;

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
  // Back after being away, and the server hasn't said yet whether another device read on.
  private unsure: { before: number; since: number } | null = null;
  private asked: object | null = null;
  private bookId: Id<"books">;
  /** Replaced on each render, so the latest is always used. */
  save: SavePosition;
  fresh: FreshPosition | undefined;

  constructor(bookId: Id<"books">, save: SavePosition, fresh?: FreshPosition) {
    this.bookId = bookId;
    this.save = save;
    this.fresh = fresh;
  }

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
    if (!this.last) {
      // The page a book first opens on isn't a place the reader chose: it mustn't count as newer
      // than where they've read to on another device.
      this.last = { cfi: d.cfi, fraction: d.fraction, chapter, updatedAt: 0, pushed: true };
      this.pushedCfi = d.cfi;
      writeLocal(this.bookId, this.last);
      return false;
    }
    if (!moved || Date.now() - Math.max(this.actedAt, this.narratedAt) > OWN_MOVE_MS) return false;
    this.last = { cfi: d.cfi, xpointer: xpointerOf(view, d), fraction: d.fraction, chapter, updatedAt: now(), pushed: false };
    writeLocal(this.bookId, this.last);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(this.push, SETTLE_MS);
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

  /** "Stay here": this device's place is the one that counts, over the other device's. */
  stay() {
    if (!this.last) return;
    this.last = { ...this.last, updatedAt: now(), pushed: false };
    this.pushedCfi = null;
    writeLocal(this.bookId, this.last);
    this.push();
  }

  /**
   * The tab may have been out of touch: ask the server where things stand before saving anything.
   * Pages turned in the meantime were turned without knowing another device had read on, so if one
   * has, they don't overwrite it; the reader is offered the choice instead.
   */
  recheck(view: FoliateView, onNews: (r: Remote) => void) {
    if (!this.fresh) return;
    const unsure = (this.unsure ??= { before: this.last?.updatedAt ?? 0, since: Date.now() });
    const asked = (this.asked = {});
    const done = () => {
      this.unsure = null;
      this.push();
    };
    this.fresh().then(
      (r) => {
        if (asked !== this.asked) return;
        const p = this.last;
        const blind = r && p && r.device !== deviceId && r.updatedAt > unsure.before && p.updatedAt > unsure.before && !p.pushed && Date.now() - unsure.since < JUST_BACK_MS;
        if (blind) {
          this.last = { ...p, updatedAt: unsure.before, pushed: true };
          this.pushedCfi = p.cfi;
          window.clearTimeout(this.timer);
          writeLocal(this.bookId, this.last);
        }
        done();
        if (r && this.isNews(view, r)) onNews(r);
      },
      (e) => {
        console.warn("Could not check the synced position", e);
        if (asked === this.asked) done();
      },
    );
  }

  /** Recheck whenever the tab comes back from being away or offline. Returns the cleanup. */
  recheckAfterAway(view: FoliateView, onNews: (r: Remote) => void) {
    let seen = Date.now();
    const check = () => {
      if (document.visibilityState === "hidden") return;
      const away = Date.now() - seen > AWAY_MS;
      seen = Date.now();
      if (away) this.recheck(view, onNews);
    };
    const online = () => this.recheck(view, onNews);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", online);
    // A computer going to sleep doesn't hide the tab: the clock jumping between ticks shows it.
    const tick = window.setInterval(check, 15_000);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", online);
      window.clearInterval(tick);
    };
  }

  push = () => {
    window.clearTimeout(this.timer);
    const p = this.last;
    if (this.unsure || !p || p.pushed || p.cfi === this.pushedCfi) return;
    this.pushedCfi = p.cfi;
    const sent = Date.now();
    this.save({ bookId: this.bookId, cfi: p.cfi, xpointer: p.xpointer, fraction: p.fraction, chapter: p.chapter, device: deviceId, deviceName, updatedAt: p.updatedAt })
      .then(({ saved, now: serverNow }) => {
        const back = Date.now();
        // Half the round trip ago, the server's clock said `serverNow`.
        const correction = back - sent < CLOCK_ROUND_TRIP_MS ? serverNow - (sent + back) / 2 - clockOffset() : 0;
        const wrongClock = Math.abs(correction) > 1000;
        if (wrongClock) writeStored(CLOCK, Math.round(clockOffset() + correction));
        if (this.last !== p) return;
        if (!saved && wrongClock) {
          // Refused as older only because this device's clock is wrong: try again with the right time.
          this.last = { ...p, updatedAt: p.updatedAt + correction };
          this.pushedCfi = null;
          writeLocal(this.bookId, this.last);
          this.push();
          return;
        }
        this.last = { ...p, pushed: true };
        writeLocal(this.bookId, this.last);
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
