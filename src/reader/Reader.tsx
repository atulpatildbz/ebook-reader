import { useCallback, useEffect, useRef, useState } from "react";
import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { download, getCached, putCached, sha256 } from "../lib/bookCache";
import { loadFoliate, type FoliateView, type RelocateDetail, type TocItem } from "../lib/foliate";
import { duration, pct } from "../lib/format";
import { openLibrary } from "../lib/route";
import { setSettings, useSettings, useTheme } from "../lib/settings";
import { readShelf } from "../lib/shelf";
import { IconButton } from "../ui/controls";
import { Back, Close, Contents, Copy, Headphones, Moon, Next, Prev, RibbonMark, Search, Sun, Type } from "../ui/icons";
import { applyToView, PAGE_MARGIN } from "./bookStyles";
import { ContentsPanel } from "./ContentsPanel";
import { keyTarget, pageKey } from "./keys";
import { CopyPanel } from "./copy/CopyPanel";
import { NarrationBar, narrationStatus } from "./narration/NarrationBar";
import { useNarration } from "./narration/useNarration";
import { Position, type FreshPosition, type Remote, type SavePosition } from "./position";
import { SearchPanel } from "./search/SearchPanel";
import { useBookSearch } from "./search/useBookSearch";
import { SettingsPanel } from "./SettingsPanel";

export type ReaderBook = Pick<NonNullable<FunctionReturnType<typeof api.books.get>>, "title" | "author" | "fileName" | "sha256" | "fileUrl">;

/** How long to wait for the server before opening a book that's already on this device. */
const SERVER_PATIENCE_MS = 1500;

function timeLeft(min?: number) {
  if (min === undefined || !isFinite(min)) return "";
  return min < 1 ? "Less than a minute left in chapter" : `${duration(min * 60)} left in chapter`;
}

/** The reader, wired to Convex: the book's file URL, the live synced position, and saving it. */
export function SyncedReader({ bookId }: { bookId: string }) {
  const id = bookId as Id<"books">;
  const { isAuthenticated } = useConvexAuth();
  const live = useQuery(api.books.get, isAuthenticated ? { bookId: id } : "skip");
  const liveRemote = useQuery(api.progress.get, isAuthenticated ? { bookId: id } : "skip");
  const save = useMutation(api.progress.save);
  const convex = useConvex();
  const fresh = useCallback(() => convex.query(api.progress.get, { bookId: id }), [convex, id]);

  // The server is slow or out of reach: a book already on this device opens without it, at this
  // device's position. If the server has a newer one when it answers, the reader is offered it.
  const [onDevice, setOnDevice] = useState<ReaderBook | null>(null);
  const waiting = live === undefined;
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const b = readShelf()?.books.find((x) => x._id === id);
      if (b && (await getCached(b.sha256)) && !cancelled) setOnDevice({ ...b, fileUrl: null });
    }, SERVER_PATIENCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [waiting, id]);

  return <Reader bookId={id} book={live === undefined ? (onDevice ?? undefined) : live} remote={liveRemote === undefined && onDevice ? null : liveRemote} save={save} fresh={fresh} />;
}

/** `book`/`remote`: undefined while loading, null when there is none. */
export function Reader({
  bookId,
  book,
  remote,
  save,
  fresh,
}: {
  bookId: Id<"books">;
  book: ReaderBook | null | undefined;
  remote: Remote | null | undefined;
  save: SavePosition;
  fresh?: FreshPosition;
}) {
  const settings = useSettings();
  const theme = useTheme();

  const [file, setFile] = useState<File | null>(null);
  const [downloaded, setDownloaded] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [view, setView] = useState<FoliateView | null>(null);
  const [loc, setLoc] = useState<RelocateDetail | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [chrome, setChrome] = useState(false);
  const [panel, setPanel] = useState<"contents" | "settings" | "search" | "copy" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offer, setOffer] = useState<Remote | null>(null);
  // Text selected in the book, for "Read from here". Kept a moment after the selection goes, as a
  // tap on the button can clear it first.
  const [picked, setPicked] = useState<Range | null>(null);
  const pickTimer = useRef(0);

  const host = useRef<HTMLDivElement>(null);
  const [position] = useState(() => new Position(bookId, save, fresh));
  position.save = save;
  position.fresh = fresh;
  // The open book reads the latest of these through refs, so a re-render never reopens it.
  const remoteRef = useRef(remote);
  remoteRef.current = remote;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const tapRef = useRef<(x: number) => void>(() => {});

  const search = useBookSearch(view, { color: theme.ribbon, here: () => position.cfi, onJump: () => position.userActed() });
  const narration = useNarration(view, {
    title: book?.title ?? "",
    author: book?.author ?? "",
    color: theme.ribbon,
    onTurn: () => position.narrationTurned(),
    userActive: () => position.userActedWithin(1500),
  });

  const fileUrl = book?.fileUrl;
  // The copy on this device wouldn't open: get it again rather than be stuck with it.
  const [cacheBad, setCacheBad] = useState(false);
  const fromCache = useRef(false);
  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    (async () => {
      let blob = cacheBad ? undefined : await getCached(book.sha256);
      fromCache.current = !!blob;
      if (!blob) {
        if (!fileUrl) throw new Error("The file for this book is missing.");
        setDownloaded(0);
        blob = await download(fileUrl, setDownloaded);
        // Only a whole copy is worth keeping.
        if ((await sha256(blob)) === book.sha256) void putCached(book.sha256, blob);
      }
      if (!cancelled) setFile(new File([blob], book.fileName, { type: blob.type }));
    })().catch((e) => !cancelled && setFailure(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // The file never changes for a book; a refreshed download URL is not a reason to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.sha256, cacheBad]);

  useEffect(() => {
    if (book) document.title = book.title;
  }, [book]);

  useEffect(() => position.pushOnLeave(), [position]);

  const navigate = useCallback(
    (dir: "left" | "right" | "next" | "prev") => {
      position.userActed();
        const v = host.current?.querySelector("foliate-view") as FoliateView | null;
      if (!v) return;
      setChrome(false);
      void (dir === "left" ? v.goLeft() : dir === "right" ? v.goRight() : dir === "next" ? v.next() : v.prev());
    },
    [position],
  );

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
      const target = keyTarget(e.target);
      if (((e.metaKey || e.ctrlKey) && k === "f" && !e.altKey) || (k === "/" && target !== "field")) {
        e.preventDefault();
        setPanel("search");
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const dir = pageKey(k, e.shiftKey, target, panel !== null);
      if (!dir) return;
      navigate(dir);
      e.preventDefault();
    },
    [navigate, panel],
  );

  onKeyRef.current = onKey;
  tapRef.current = tap;
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const ready = file !== null && remote !== undefined;
  useEffect(() => {
    if (!ready || !file || !host.current) return;
    let cancelled = false;
    let v: FoliateView | null = null;
    (async () => {
      await loadFoliate();
      if (cancelled) return;
      v = document.createElement("foliate-view") as FoliateView;
      v.style.cssText = "display:block;width:100%;height:100%";
      host.current!.append(v);
      v.addEventListener("relocate", (e) => {
        const d = (e as CustomEvent<RelocateDetail>).detail;
        setLoc(d);
        if (position.relocated(v!, d)) setOffer(null);
      });
      v.addEventListener("load", (e) => {
        const doc = (e as CustomEvent<{ doc: Document }>).detail.doc;
        doc.addEventListener("keydown", (ev) => onKeyRef.current(ev));
        const acted = () => position.userActed();
        doc.addEventListener("pointerdown", acted, { passive: true });
        doc.addEventListener("touchstart", acted, { passive: true });
        doc.addEventListener("wheel", acted, { passive: true });
        doc.addEventListener("selectionchange", () => {
          const sel = doc.getSelection();
          window.clearTimeout(pickTimer.current);
          if (sel && sel.rangeCount && sel.toString().trim()) setPicked(sel.getRangeAt(0).cloneRange());
          else pickTimer.current = window.setTimeout(() => setPicked(null), 800);
        });
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
          requestAnimationFrame(() => requestAnimationFrame(() => tapRef.current(x)));
        });
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

      const { target, from } = await position.start(v, remoteRef.current);
      if (cancelled) return;
      if (from) setNotice(`Picked up where you left off on ${from}`);
      await v.init({ lastLocation: target, showTextStart: !target });
      if (!cancelled) setView(v);
    })().catch((e) => {
      console.error(e);
      if (cancelled) return;
      if (fromCache.current && navigator.onLine && fileUrl) {
        setFile(null);
        setCacheBad(true);
        return;
      }
      setFailure("This book could not be opened. The file may be damaged or DRM-protected.");
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
  }, [ready, file, position]);

  // Each application lays the book out again, so only when something that affects it has changed.
  const look = JSON.stringify([{ ...settings, narrationRate: 0, narrationVoice: "", copyPartWords: 0, dim: 0 }, theme]);
  useEffect(() => {
    if (view) applyToView(view, settingsRef.current, themeRef.current);
  }, [view, look]);

  const listen = () => {
    narration.listen();
    setChrome(false);
    setPanel(null);
  };
  // The player sits in the PAGE_MARGIN the paginator leaves below the text. Only if it doesn't fit
  // (very large system text, say) does the book's area end higher, which lays the page out again.
  const bookBottom = Math.max(0, narration.room + 2 - PAGE_MARGIN);

  // Another device read on while this one is open: offer to jump there.
  useEffect(() => {
    if (remote && view && position.isNews(view, remote)) setOffer(remote);
  }, [remote, view, position]);

  useEffect(() => (view ? position.recheckAfterAway(view, setOffer) : undefined), [view, position]);

  const jump = async (r: Remote) => {
    if (!view) return;
    setOffer(null);
    await position.follow(view, r);
  };

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(t);
  }, [notice]);

  if (book === null) {
    return (
      <Centered>
        <p className="font-serif text-2xl">This book isn’t in your library</p>
        <button onClick={openLibrary} className="mt-6 rounded-full border border-[var(--line)] px-5 py-2.5">
          Go to library
        </button>
      </Centered>
    );
  }

  const fixed = view?.isFixedLayout ?? false;
  const chapter = loc?.tocItem?.label?.trim();
  // While listening, time left is at the listening speed, from the sentence being read.
  const listeningLeft = narration.listening && narration.state.left !== null ? narration.state.left / narration.rate / 60 : undefined;
  const pageInfo = fixed && loc?.section ? `Page ${loc.section.current + 1} of ${loc.section.total}` : timeLeft(listeningLeft ?? loc?.time?.section);
  const showChrome = chrome || panel !== null;
  const hasText = !!view?.book.sections.some((s) => s.createDocument);

  return (
    <div className="fixed inset-0 overflow-clip bg-[var(--bg)] select-none" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* The book. Taps in the page margins (outside the text frames) land here. */}
      <div
        ref={host}
        className="absolute inset-0"
        style={{ top: "env(safe-area-inset-top)", bottom: `calc(env(safe-area-inset-bottom) + ${bookBottom}px)` }}
        onClick={(e) => e.target === e.currentTarget.firstElementChild && tap(e.clientX)}
        onPointerDown={() => position.userActed()}
        onWheel={() => position.userActed()}
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
            className={`pointer-events-none absolute inset-x-0 z-20 truncate text-center text-xs text-[var(--muted)] tabular-nums transition-opacity ${narration.listening ? "px-6" : "px-16"} ${showChrome ? "opacity-0" : "opacity-100"}`}
            style={{ top: "calc(env(safe-area-inset-top) + 18px)" }}
            aria-live="off"
          >
            {/* While listening: how it stands, in place of the chapter. */}
            {narration.listening ? narrationStatus(narration.state, narration.voice, narration.rate) : fixed ? "" : chapter}
          </div>
          <div
            className={`pointer-events-none absolute inset-x-0 z-20 flex justify-between px-6 text-xs text-[var(--muted)] tabular-nums transition-opacity sm:px-10 ${showChrome || narration.listening ? "opacity-0" : "opacity-100"}`}
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
          {hasText && !fixed && (
            <IconButton label="Read aloud" onClick={listen} active={narration.listening}>
              <Headphones />
            </IconButton>
          )}
          {hasText && (
            <IconButton label="Find in book" onClick={() => setPanel(panel === "search" ? null : "search")} active={panel === "search"}>
              <Search />
            </IconButton>
          )}
          {hasText && (
            <IconButton label="Copy chapter" onClick={() => setPanel(panel === "copy" ? null : "copy")} active={panel === "copy"}>
              <Copy />
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
        className={`absolute inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[var(--surface)] transition-transform duration-200 ${showChrome && panel !== "settings" && panel !== "copy" ? "translate-y-0" : "translate-y-full"}`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto max-w-3xl px-5 pt-3 pb-4">
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="min-w-0 truncate">{chapter ?? book?.title}</span>
            <span className="shrink-0 text-[var(--muted)] tabular-nums">{loc ? pct(loc.fraction) : ""}</span>
          </div>
          <ProgressSlider view={view} fraction={loc?.fraction ?? 0} onSeek={() => position.userActed()} />
          <p className="text-xs text-[var(--muted)]">{pageInfo}</p>
        </div>
      </footer>

      {panel === "contents" && view && (
        <ContentsPanel
          toc={toc}
          current={loc?.tocItem?.href}
          onClose={() => setPanel(null)}
          onPick={(href) => {
            position.userActed();
            void view.goTo(href);
            setPanel(null);
            setChrome(false);
          }}
        />
      )}
      {panel === "settings" && <SettingsPanel fixed={fixed} onClose={() => setPanel(null)} />}
      {panel === "copy" && view && (
        <CopyPanel view={view} tocItem={loc?.tocItem} section={loc?.section?.current ?? 0} chapter={chapter} onClose={() => setPanel(null)} />
      )}
      {panel === "search" && view && (
        <SearchPanel
          state={search.state}
          active={search.active}
          onSearch={search.run}
          onClose={() => setPanel(null)}
          onPick={(i) => {
            void search.show(i);
            setPanel(null);
            setChrome(false);
          }}
        />
      )}

      {/* The match on screen: step through the others, or go back to where reading was. */}
      {search.active !== null && panel !== "search" && (
        <div className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-4" style={{ top: "calc(env(safe-area-inset-top) + 12px)" }}>
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] py-1 pr-1 pl-2 text-sm shadow-lg">
            <button onClick={() => setPanel("search")} className="rounded-full px-2 py-1.5 tabular-nums" title="Show all matches">
              {search.active + 1} of {search.state.hits.length}
            </button>
            <IconButton label="Previous match" onClick={() => search.step(-1)}>
              <Prev />
            </IconButton>
            <IconButton label="Next match" onClick={() => search.step(1)}>
              <Next />
            </IconButton>
            {search.canGoBack && (
              <button onClick={() => void search.goBack()} className="rounded-full px-3 py-1.5 text-[var(--muted)] hover:text-[var(--fg)]">
                Go back
              </button>
            )}
            <IconButton label="Done" onClick={search.end}>
              <Close />
            </IconButton>
          </div>
        </div>
      )}

      {narration.listening && (
        <NarrationBar
          state={narration.state}
          voice={narration.voice}
          rate={narration.rate}
          raised={showChrome && panel === null}
          onToggle={narration.toggle}
          onSkip={narration.skip}
          onFromHere={
            picked
              ? () => {
                  picked.startContainer.ownerDocument?.getSelection()?.removeAllRanges();
                  setPicked(null);
                  narration.readFrom(picked);
                }
              : undefined
          }
          onRate={narration.setRate}
          onVoice={narration.setVoice}
          onClose={narration.close}
          onRoom={narration.setPlayerRoom}
        />
      )}

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
              <button
                onClick={() => {
                  position.stay();
                  setOffer(null);
                }}
                className="rounded-full px-3 py-1.5 text-[var(--muted)]"
              >
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
  const seek = () => {
    if (drag !== null && view) {
      onSeek();
      void view.goToFraction(drag);
    }
    setDrag(null);
  };
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
        onPointerUp={seek}
        onKeyUp={seek}
      />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 z-20 flex flex-col items-center justify-center px-6 text-center">{children}</div>;
}
