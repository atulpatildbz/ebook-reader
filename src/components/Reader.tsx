import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { download, getCached, getLocalProgress, putCached, setLocalProgress, type LocalProgress } from "../lib/bookCache";
import { loadFoliate, type FoliateView, type RelocateDetail, type TocItem } from "../lib/foliate";
import { applyToView } from "../lib/bookStyles";
import { deviceId, deviceName } from "../lib/device";
import { openLibrary } from "../lib/route";
import { setSettings, useSettings, useTheme } from "../lib/settings";
import { normalizeQuery, searchBook } from "../lib/search";
import { Back, Close, Contents, Moon, Next, Prev, RibbonMark, Search, Sun, Type } from "./icons";
import { ContentsPanel, SearchPanel, SettingsPanel, type SearchState } from "./ReaderPanels";

export type Remote = { cfi: string; fraction: number; chapter: string | null; device: string; deviceName: string; updatedAt: number };
export type ReaderBook = { title: string; author: string; fileName: string; sha256: string; fileUrl: string | null };
export type SavePosition = (p: {
  bookId: Id<"books">;
  cfi: string;
  fraction: number;
  chapter?: string;
  device: string;
  deviceName: string;
  updatedAt: number;
}) => Promise<unknown>;

const pct = (f: number) => `${Math.round(f * 100)}%`;
function timeLeft(min?: number) {
  if (min === undefined || !isFinite(min)) return "";
  if (min < 1) return "Less than a minute left in chapter";
  if (min < 60) return `${Math.round(min)} min left in chapter`;
  const h = Math.floor(min / 60);
  return `${h} h ${Math.round(min % 60)} min left in chapter`;
}

/** The reader, wired to Convex: the book's file URL, the live synced position, and saving it. */
export function SyncedReader({ bookId }: { bookId: string }) {
  const id = bookId as Id<"books">;
  const book = useQuery(api.books.get, { bookId: id });
  const remote = useQuery(api.progress.get, { bookId: id });
  const save = useMutation(api.progress.save);
  return <Reader bookId={id} book={book} remote={remote} save={save} />;
}

/** `book`/`remote`: undefined while loading, null when there is none. */
export function Reader({ bookId, book, remote, save }: { bookId: Id<"books">; book: ReaderBook | null | undefined; remote: Remote | null | undefined; save: SavePosition }) {
  const settings = useSettings();
  const theme = useTheme();

  const [file, setFile] = useState<File | null>(null);
  const [downloaded, setDownloaded] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [view, setView] = useState<FoliateView | null>(null);
  const [loc, setLoc] = useState<RelocateDetail | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [chrome, setChrome] = useState(false);
  const [panel, setPanel] = useState<"contents" | "settings" | "search" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offer, setOffer] = useState<Remote | null>(null);
  const [search, setSearch] = useState<SearchState>({ query: "", hits: [], progress: 0, running: false });
  const [active, setActive] = useState<number | null>(null); // the match on screen

  const host = useRef<HTMLDivElement>(null);
  const remoteRef = useRef(remote);
  remoteRef.current = remote;
  const last = useRef<LocalProgress | null>(null);
  const pushedCfi = useRef<string | null>(null);
  const interactedAt = useRef(0);
  // While following another device's position ("Go there"), the pages shown are that device's
  // reading, not this one's: they are not saved back (which would prompt the other device).
  const following = useRef<{ until: number; updatedAt: number } | null>(null);
  const pushTimer = useRef<number | undefined>(undefined);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  // Callbacks the open book holds on to read the latest props through refs, so a re-render
  // never reopens the book.
  const saveRef = useRef(save);
  saveRef.current = save;
  const searchAbort = useRef<AbortController | null>(null);
  const returnTo = useRef<string | null>(null); // where the reader was before jumping to a match
  const mark = useRef<{ value: string; index: number } | null>(null); // the highlighted match

  // 1. Get the file: from this browser's cache, else download it once.
  const fileUrl = book?.fileUrl;
  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    (async () => {
      let blob = await getCached(book.sha256);
      if (!blob) {
        if (!fileUrl) throw new Error("The file for this book is missing.");
        setDownloaded(0);
        blob = await download(fileUrl, setDownloaded);
        void putCached(book.sha256, blob);
      }
      if (!cancelled) setFile(new File([blob], book.fileName, { type: blob.type }));
    })().catch((e) => !cancelled && setFailure(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // The file never changes for a book; a refreshed download URL is not a reason to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.sha256]);

  useEffect(() => {
    if (book) document.title = book.title;
  }, [book]);

  // 2. Saving the position: locally at once, to Convex shortly after the page settles.
  const push = useCallback(() => {
    window.clearTimeout(pushTimer.current);
    const p = last.current;
    if (!p || p.pushed || p.cfi === pushedCfi.current) return;
    pushedCfi.current = p.cfi;
    saveRef.current({ bookId, cfi: p.cfi, fraction: p.fraction, chapter: p.chapter, device: deviceId, deviceName, updatedAt: p.updatedAt })
      .then(() => {
        if (last.current === p) {
          last.current = { ...p, pushed: true };
          setLocalProgress(bookId, last.current);
        }
      })
      .catch((e) => {
        console.warn("Position not synced yet", e);
        pushedCfi.current = null;
      });
  }, [bookId]);

  useEffect(() => {
    const flush = () => document.visibilityState === "hidden" && push();
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", push);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", push);
      push();
    };
  }, [push]);

  const navigate = useCallback((dir: "left" | "right" | "next" | "prev") => {
    interactedAt.current = Date.now();
    const v = host.current?.querySelector("foliate-view") as FoliateView | null;
    if (!v) return;
    setChrome(false);
    void (dir === "left" ? v.goLeft() : dir === "right" ? v.goRight() : dir === "next" ? v.next() : v.prev());
  }, []);

  const tap = useCallback(
    (x: number) => {
      const w = window.innerWidth;
      if (x < w * 0.28) navigate("left");
      else if (x > w * 0.72) navigate("right");
      else setChrome((c) => !c);
    },
    [navigate],
  );

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "Escape") {
        setPanel(null);
        setChrome(false);
        return;
      }
      if (((e.metaKey || e.ctrlKey) && k === "f" && !e.altKey) || (k === "/" && !(e.target instanceof HTMLInputElement))) {
        e.preventDefault();
        setPanel("search");
        return;
      }
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (k === "ArrowLeft" || k === "h") navigate("left");
      else if (k === "ArrowRight" || k === "l") navigate("right");
      else if (k === "PageDown" || (k === " " && !e.shiftKey) || k === "j") navigate("next");
      else if (k === "PageUp" || (k === " " && e.shiftKey) || k === "k") navigate("prev");
      else return;
      e.preventDefault();
    },
    [navigate],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  // 3. Open the book once the file and the synced position are known.
  const ready = file !== null && remote !== undefined;
  useEffect(() => {
    if (!ready || !file || !host.current) return;
    let cancelled = false;
    let v: FoliateView | null = null;
    let shown: string | null = null; // CFI of the page on screen, from the last relocate
    (async () => {
      await loadFoliate();
      const { Overlayer } = (await import(/* @vite-ignore */ `${import.meta.env.BASE_URL}foliate-js/overlayer.js`)) as {
        Overlayer: { highlight: unknown };
      };
      if (cancelled) return;
      v = document.createElement("foliate-view") as FoliateView;
      v.style.cssText = "display:block;width:100%;height:100%";
      host.current!.append(v);
      v.addEventListener("relocate", (e) => {
        const d = (e as CustomEvent<RelocateDetail>).detail;
        setLoc(d);
        // The paginator also reports the page it is already on (a tap ends in a "snap" back to
        // it), and each device names the same page by a slightly different CFI, so only a change
        // from the last page shown here counts as moving.
        const moved = shown !== null && d.cfi !== shown;
        shown = d.cfi;
        if (!d.cfi || d.cfi === last.current?.cfi) return;
        const f = following.current;
        if (f && Date.now() < f.until) {
          last.current = { cfi: d.cfi, fraction: d.fraction, chapter: d.tocItem?.label?.trim(), updatedAt: f.updatedAt, pushed: true };
          pushedCfi.current = d.cfi;
          setLocalProgress(bookId, last.current);
          return;
        }
        following.current = null;
        // Only a move the reader made (not a resize reflowing the page) becomes the new position.
        if (last.current && (!moved || Date.now() - interactedAt.current > 4000)) return;
        last.current = { cfi: d.cfi, fraction: d.fraction, chapter: d.tocItem?.label?.trim(), updatedAt: Date.now(), pushed: false };
        setLocalProgress(bookId, last.current);
        setOffer(null);
        window.clearTimeout(pushTimer.current);
        pushTimer.current = window.setTimeout(push, 1500);
      });
      v.addEventListener("load", (e) => {
        const doc = (e as CustomEvent<{ doc: Document }>).detail.doc;
        doc.addEventListener("keydown", onKey);
        const mark = () => (interactedAt.current = Date.now());
        doc.addEventListener("pointerdown", mark, { passive: true });
        doc.addEventListener("touchstart", mark, { passive: true });
        doc.addEventListener("wheel", mark, { passive: true });
        doc.addEventListener("click", (ev) => {
          if (ev.defaultPrevented || (ev.target as Element).closest?.("a") || doc.getSelection()?.toString()) return;
          const frame = doc.defaultView?.frameElement as HTMLElement | null;
          if (!frame) return;
          const rect = frame.getBoundingClientRect();
          const scale = frame.offsetWidth ? rect.width / frame.offsetWidth : 1;
          const x = rect.left + ev.clientX * scale;
          // Handled here: also stops Chrome on Android from treating the tap as "Touch to search".
          ev.preventDefault();
          // On touch screens lifting the finger makes the paginator snap back to the current
          // page on the next frame; turning the page before that would be undone by it.
          requestAnimationFrame(() => requestAnimationFrame(() => tap(x)));
        });
      });
      // The found match, highlighted in the ribbon colour; redrawn whenever its chapter is laid out again.
      v.addEventListener("draw-annotation", (e) => {
        const { draw } = (e as CustomEvent<{ draw: (f: unknown, o: object) => void }>).detail;
        draw(Overlayer.highlight, { color: themeRef.current.ribbon });
      });
      v.addEventListener("create-overlay", (e) => {
        const m = mark.current;
        if (m && (e as CustomEvent<{ index: number }>).detail.index === m.index) void v!.addAnnotation({ value: m.value });
      });
      v.addEventListener("external-link", (e) => {
        e.preventDefault();
        const a = (e as CustomEvent<{ a: HTMLAnchorElement }>).detail.a;
        window.open(a.href, "_blank", "noopener,noreferrer");
      });

      await v.open(file);
      if (cancelled) return;
      applyToView(v, settingsRef.current, themeRef.current);
      setToc(v.book.toc ?? []);

      // Start at the newest position: this device's own, or the synced one from another device.
      const local = getLocalProgress(bookId);
      const r = remoteRef.current;
      let start: string | null = null;
      if (r && (!local || r.updatedAt > local.updatedAt)) {
        start = r.cfi;
        last.current = { cfi: r.cfi, fraction: r.fraction, chapter: r.chapter ?? undefined, updatedAt: r.updatedAt, pushed: true };
        pushedCfi.current = r.cfi;
        setLocalProgress(bookId, last.current);
        if (r.device !== deviceId) setNotice(`Picked up where you left off on ${r.deviceName}`);
      } else if (local) {
        start = local.cfi;
        last.current = local;
        if (!local.pushed) push(); // read offline last time
        else pushedCfi.current = local.cfi;
      }
      await v.init({ lastLocation: start, showTextStart: !start });
      if (!cancelled) setView(v);
    })().catch((e) => {
      console.error(e);
      if (!cancelled) setFailure("This book could not be opened. The file may be damaged or DRM-protected.");
    });
    return () => {
      cancelled = true;
      if (v) {
        v.close();
        v.book?.destroy?.();
        v.remove();
      }
      setView(null);
    };
  }, [ready, file, bookId, push, onKey, tap]);

  // Settings and theme changes apply live.
  useEffect(() => {
    if (view) applyToView(view, settings, theme);
  }, [view, settings, theme]);

  // 4. Another device read on while this one is open: offer to jump there.
  useEffect(() => {
    if (!remote || !view || remote.device === deviceId) return;
    if (last.current && remote.updatedAt <= last.current.updatedAt) return;
    if (remote.cfi === view.lastLocation?.cfi) return;
    setOffer(remote);
  }, [remote, view]);

  const jump = async (r: Remote) => {
    if (!view) return;
    interactedAt.current = 0;
    following.current = { until: Date.now() + 2000, updatedAt: r.updatedAt };
    setOffer(null);
    await view.goTo(r.cfi);
  };

  // Finding text: search the whole book, jump to a match, and come back if it was the wrong one.
  const runSearch = useCallback(
    (query: string) => {
      searchAbort.current?.abort();
      const ctrl = new AbortController();
      searchAbort.current = ctrl;
      setActive(null);
      const enough = normalizeQuery(query).length >= 2;
      setSearch({ query, hits: [], progress: 0, running: enough });
      if (!view || !enough) return;
      searchBook(view, query, {
        signal: ctrl.signal,
        onHits: (hits) => !ctrl.signal.aborted && setSearch((s) => ({ ...s, hits: [...s.hits, ...hits] })),
        onProgress: (progress) => !ctrl.signal.aborted && setSearch((s) => ({ ...s, progress })),
      })
        .catch((e) => console.error("Search failed", e))
        .finally(() => !ctrl.signal.aborted && setSearch((s) => ({ ...s, running: false, progress: 1 })));
    },
    [view],
  );

  const unmark = () => {
    if (mark.current && view) void view.deleteAnnotation({ value: mark.current.value });
    mark.current = null;
  };

  const showHit = async (i: number) => {
    const hit = search.hits[i];
    if (!view || !hit) return;
    returnTo.current ??= last.current?.cfi ?? view.lastLocation?.cfi ?? null;
    setActive(i);
    // Jumping to a match is the reader moving on: it becomes the synced position.
    interactedAt.current = Date.now();
    following.current = null;
    unmark();
    mark.current = { value: hit.cfi, index: hit.section };
    await view.goTo(hit.cfi);
    if (mark.current?.value === hit.cfi) await view.addAnnotation({ value: hit.cfi });
  };

  const step = (d: 1 | -1) => {
    const n = search.hits.length;
    if (active !== null && n) void showHit((active + d + n) % n);
  };

  const endSearch = () => {
    unmark();
    setActive(null);
    returnTo.current = null;
  };

  const goBack = async () => {
    const back = returnTo.current;
    endSearch();
    if (back && view) {
      interactedAt.current = Date.now();
      await view.goTo(back);
    }
  };

  useEffect(() => () => searchAbort.current?.abort(), []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(t);
  }, [notice]);

  if (book === null) {
    return (
      <Centered>
        <p className="font-serif text-2xl">This book isn’t in your library</p>
        <button onClick={() => (location.hash = "#/")} className="mt-6 rounded-full border border-[var(--line)] px-5 py-2.5">
          Go to library
        </button>
      </Centered>
    );
  }

  const fixed = view?.isFixedLayout ?? false;
  const chapter = loc?.tocItem?.label?.trim();
  const pageInfo = fixed && loc?.section ? `Page ${loc.section.current + 1} of ${loc.section.total}` : timeLeft(loc?.time?.section);
  const showChrome = chrome || panel !== null;
  const canSearch = !!view?.book.sections.some((s) => (s as { createDocument?: unknown }).createDocument);

  return (
    <div className="fixed inset-0 overflow-clip bg-[var(--bg)] select-none" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* The book. Taps in the page margins (outside the text frames) land here. */}
      <div
        ref={host}
        className="absolute inset-0"
        style={{ top: "env(safe-area-inset-top)", bottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.target === e.currentTarget.firstElementChild && tap(e.clientX)}
        onPointerDown={() => (interactedAt.current = Date.now())}
        onWheel={() => (interactedAt.current = Date.now())}
      />

      {settings.dim > 0 && <div className="pointer-events-none absolute inset-0 z-10 bg-black" style={{ opacity: settings.dim }} />}

      {!view && !failure && (
        <Centered>
          <RibbonMark className="h-10 w-8 animate-pulse text-[var(--ribbon)]" />
          <p className="mt-5 text-[var(--muted)]">{downloaded !== null && !file ? `Downloading, ${pct(downloaded)}` : "Opening…"}</p>
        </Centered>
      )}
      {failure && (
        <Centered>
          <p className="max-w-sm font-serif text-xl leading-snug">{failure}</p>
          <button onClick={openLibrary} className="mt-6 rounded-full border border-[var(--line)] px-5 py-2.5">
            Back to library
          </button>
        </Centered>
      )}

      {/* Quiet running head and foot, always there while reading. */}
      {view && (
        <>
          <div
            className={`pointer-events-none absolute inset-x-0 z-20 truncate px-16 text-center text-xs text-[var(--muted)] transition-opacity ${showChrome ? "opacity-0" : "opacity-100"}`}
            style={{ top: "calc(env(safe-area-inset-top) + 18px)" }}
          >
            {fixed ? "" : chapter}
          </div>
          <div
            className={`pointer-events-none absolute inset-x-0 z-20 flex justify-between px-6 text-xs text-[var(--muted)] tabular-nums transition-opacity sm:px-10 ${showChrome ? "opacity-0" : "opacity-100"}`}
            style={{ bottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
          >
            <span>{loc ? pct(loc.fraction) : ""}</span>
            <span>{pageInfo}</span>
          </div>
        </>
      )}

      {/* Toolbars, shown with a tap in the middle of the page. */}
      <header
        className={`absolute inset-x-0 top-0 z-30 border-b border-[var(--line)] bg-[var(--surface)] transition-transform duration-200 ${showChrome ? "translate-y-0" : "-translate-y-full"}`}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-1 px-2">
          <IconButton label="Library" onClick={openLibrary}>
            <Back />
          </IconButton>
          <div className="min-w-0 flex-1 px-2">
            <p className="truncate font-serif font-medium">{book?.title}</p>
            {book?.author && <p className="truncate text-xs text-[var(--muted)]">{book.author}</p>}
          </div>
          {canSearch && (
            <IconButton label="Find in book" onClick={() => setPanel(panel === "search" ? null : "search")} active={panel === "search"}>
              <Search />
            </IconButton>
          )}
          {toc.length > 0 && (
            <IconButton label="Contents" onClick={() => setPanel(panel === "contents" ? null : "contents")} active={panel === "contents"}>
              <Contents />
            </IconButton>
          )}
          <IconButton label={theme.dark ? "Day theme" : "Night theme"} onClick={() => setSettings({ mode: theme.dark ? "day" : "night" })}>
            {theme.dark ? <Sun /> : <Moon />}
          </IconButton>
          <IconButton label="Text and theme" onClick={() => setPanel(panel === "settings" ? null : "settings")} active={panel === "settings"}>
            <Type />
          </IconButton>
        </div>
      </header>

      <footer
        className={`absolute inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[var(--surface)] transition-transform duration-200 ${showChrome && panel !== "settings" ? "translate-y-0" : "translate-y-full"}`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto max-w-3xl px-5 pt-3 pb-4">
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="min-w-0 truncate">{chapter ?? book?.title}</span>
            <span className="shrink-0 text-[var(--muted)] tabular-nums">{loc ? pct(loc.fraction) : ""}</span>
          </div>
          <ProgressSlider view={view} fraction={loc?.fraction ?? 0} onSeek={() => (interactedAt.current = Date.now())} />
          <p className="text-xs text-[var(--muted)]">{pageInfo}</p>
        </div>
      </footer>

      {panel === "contents" && view && (
        <ContentsPanel
          toc={toc}
          current={loc?.tocItem?.href}
          onClose={() => setPanel(null)}
          onPick={(href) => {
            interactedAt.current = Date.now();
            void view.goTo(href);
            setPanel(null);
            setChrome(false);
          }}
        />
      )}
      {panel === "settings" && <SettingsPanel fixed={fixed} onClose={() => setPanel(null)} />}
      {panel === "search" && view && (
        <SearchPanel
          state={search}
          active={active}
          onSearch={runSearch}
          onClose={() => setPanel(null)}
          onPick={(i) => {
            void showHit(i);
            setPanel(null);
            setChrome(false);
          }}
        />
      )}

      {/* The match on screen: step through the others, or go back to where reading was. */}
      {active !== null && panel !== "search" && (
        <div className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-4" style={{ top: "calc(env(safe-area-inset-top) + 12px)" }}>
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] py-1 pr-1 pl-2 text-sm shadow-lg">
            <button onClick={() => setPanel("search")} className="rounded-full px-2 py-1.5 tabular-nums" title="Show all matches">
              {active + 1} of {search.hits.length}
            </button>
            <IconButton label="Previous match" onClick={() => step(-1)}>
              <Prev />
            </IconButton>
            <IconButton label="Next match" onClick={() => step(1)}>
              <Next />
            </IconButton>
            {returnTo.current && (
              <button onClick={() => void goBack()} className="rounded-full px-3 py-1.5 text-[var(--muted)] hover:text-[var(--fg)]">
                Go back
              </button>
            )}
            <IconButton label="Done" onClick={endSearch}>
              <Close />
            </IconButton>
          </div>
        </div>
      )}

      {/* Sync messages. */}
      <div className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-4" style={{ bottom: "calc(env(safe-area-inset-bottom) + 56px)" }}>
        {offer ? (
          <div role="status" className="pointer-events-auto flex max-w-md flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 shadow-lg">
            <p className="min-w-0 flex-1 text-sm leading-snug">
              On {offer.deviceName} you’re at {pct(offer.fraction)}
              {offer.chapter ? `, in ${offer.chapter}` : ""}.
            </p>
            <div className="flex gap-2 text-sm">
              <button onClick={() => void jump(offer)} className="rounded-full bg-[var(--ribbon)] px-4 py-1.5 font-medium text-[var(--on-ribbon)]">
                Go there
              </button>
              <button onClick={() => setOffer(null)} className="rounded-full px-3 py-1.5 text-[var(--muted)]">
                Stay here
              </button>
            </div>
          </div>
        ) : notice ? (
          <p role="status" className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm shadow-lg">
            {notice}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ProgressSlider({ view, fraction, onSeek }: { view: FoliateView | null; fraction: number; onSeek: () => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const value = drag ?? fraction;
  const ticks = view && !view.isFixedLayout ? view.getSectionFractions().slice(1, -1) : [];
  return (
    <div className="relative my-2">
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--line)]">
        {/* Chapter boundaries, under the filled part. */}
        {ticks.length < 120 &&
          ticks.map((t, i) => <span key={i} className="absolute -top-0.5 h-2 w-px bg-[var(--muted)] opacity-40" style={{ left: `${t * 100}%` }} />)}
        <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--ribbon)]" style={{ width: `${value * 100}%` }} />
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.0005}
        value={value}
        aria-label="Position in book"
        className="relative h-6 w-full cursor-pointer appearance-none bg-transparent opacity-0"
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => {
          if (drag !== null && view) {
            onSeek();
            void view.goToFraction(drag);
          }
          setDrag(null);
        }}
        onKeyUp={() => {
          if (drag !== null && view) {
            onSeek();
            void view.goToFraction(drag);
          }
          setDrag(null);
        }}
      />
    </div>
  );
}

function IconButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${active ? "bg-[var(--line)] text-[var(--fg)]" : "text-[var(--muted)] hover:text-[var(--fg)]"}`}
    >
      {children}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 z-20 flex flex-col items-center justify-center px-6 text-center">{children}</div>;
}
