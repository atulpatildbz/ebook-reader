import { useEffect, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ACCEPT, importBook } from "../lib/importBook";
import { dropCached, persistStorage } from "../lib/bookCache";
import { openBook } from "../lib/route";
import { setSettings, useTheme } from "../lib/settings";
import { Moon, More, Plus, RibbonMark, Sun } from "./icons";

export type Book = NonNullable<ReturnType<typeof useQuery<typeof api.books.list>>>[number];
type Me = { email: string; name: string; image: string | null };
type Upload = { id: number; name: string; stage: string; fraction?: number; error?: string; note?: string };

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function ago(t: number) {
  const s = (t - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [u, n] of units) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return "just now";
}

const pct = (f: number) => `${Math.round(f * 100)}%`;

export function Library({ me }: { me: Me }) {
  return <LibraryView me={me} books={useQuery(api.books.list)} />;
}

/** `books`: undefined while loading. */
export function LibraryView({ me, books }: { me: Me; books: Book[] | null | undefined }) {
  const convex = useConvex();
  const theme = useTheme();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  useEffect(() => {
    document.title = "Ribbon";
  }, []);

  const addFiles = async (files: File[]) => {
    persistStorage();
    for (const file of files) {
      const id = nextId.current++;
      const patch = (p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...p } : x)));
      setUploads((u) => [...u, { id, name: file.name, stage: "Waiting" }]);
      try {
        const { duplicate } = await importBook(convex, file, (stage, fraction) => patch({ stage, fraction }));
        if (duplicate) patch({ stage: "Done", note: "Already on your shelf" });
        else setUploads((u) => u.filter((x) => x.id !== id));
      } catch (e) {
        patch({ error: e instanceof Error ? e.message : String(e) });
      }
    }
  };

  // Drop books anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => hasFiles(e) && (depth++, setDragging(true));
    const leave = (e: DragEvent) => hasFiles(e) && --depth <= 0 && ((depth = 0), setDragging(false));
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void addFiles([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  });

  const current = books?.find((b) => b.progress && b.progress.fraction < 0.995);

  return (
    <div className="min-h-dvh pb-24" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-4 sm:px-8 sm:py-6">
        <RibbonMark className="h-6 w-5 text-[var(--ribbon)]" />
        <span className="font-serif text-xl font-medium tracking-tight">Ribbon</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setSettings({ mode: theme.dark ? "day" : "night" })}
            className="grid h-10 w-10 place-items-center rounded-full text-[var(--muted)] hover:text-[var(--fg)]"
            aria-label={theme.dark ? "Switch to day theme" : "Switch to night theme"}
            title={theme.dark ? "Day theme" : "Night theme"}
          >
            {theme.dark ? <Sun /> : <Moon />}
          </button>
          <button
            onClick={() => input.current?.click()}
            className="ml-1 inline-flex h-10 items-center gap-1.5 rounded-full bg-[var(--fg)] pr-4 pl-3 text-sm font-medium text-[var(--bg)]"
          >
            <Plus className="h-4 w-4" /> Add books
          </button>
          <Account me={me} />
        </div>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-8">
        {uploads.length > 0 && <Uploads uploads={uploads} onDismiss={(id) => setUploads((u) => u.filter((x) => x.id !== id))} />}

        {books === undefined ? null : books === null || books.length === 0 ? (
          <Empty onAdd={() => input.current?.click()} />
        ) : (
          <>
            {current && <ContinueReading book={current} />}
            <section className="mt-10 sm:mt-14">
              <h2 className="font-serif text-2xl font-medium tracking-tight">
                All books <span className="text-[var(--muted)]">{books.length}</span>
              </h2>
              <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-x-5 gap-y-9 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] sm:gap-x-8">
                {books.map((b) => (
                  <ShelfBook key={b._id} book={b} />
                ))}
              </ul>
            </section>
          </>
        )}
      </main>

      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-50 grid place-items-center rounded-2xl border-2 border-dashed border-[var(--ribbon)] bg-[color-mix(in_srgb,var(--bg)_85%,transparent)]">
          <p className="font-serif text-2xl">Drop to add to your shelf</p>
        </div>
      )}
    </div>
  );
}

function Account({ me }: { me: Me }) {
  const { signOut } = useAuthActions();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative ml-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="grid h-10 w-10 place-items-center overflow-hidden rounded-full border border-[var(--line)] bg-[var(--surface)] text-sm font-medium"
        aria-label="Account"
        aria-expanded={open}
      >
        {me.image ? <img src={me.image} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : (me.name || me.email)[0]?.toUpperCase()}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-lg">
            {me.name && <p className="font-medium">{me.name}</p>}
            <p className="truncate text-sm text-[var(--muted)]">{me.email}</p>
            <button onClick={() => void signOut()} className="mt-4 w-full rounded-lg border border-[var(--line)] py-2 text-sm">
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Uploads({ uploads, onDismiss }: { uploads: Upload[]; onDismiss: (id: number) => void }) {
  return (
    <ul className="mb-8 space-y-2" aria-live="polite">
      {uploads.map((u) => (
        <li key={u.id} className="flex items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{u.name}</p>
            <p className={`text-sm ${u.error ? "text-[var(--ribbon)]" : "text-[var(--muted)]"}`}>
              {u.error ?? u.note ?? (u.fraction !== undefined ? `${u.stage}, ${pct(u.fraction)}` : `${u.stage}…`)}
            </p>
            {!u.error && !u.note && u.fraction !== undefined && (
              <div className="mt-2 h-0.5 overflow-hidden rounded bg-[var(--line)]">
                <div className="h-full bg-[var(--ribbon)] transition-[width]" style={{ width: pct(u.fraction) }} />
              </div>
            )}
          </div>
          {(u.error || u.note) && (
            <button onClick={() => onDismiss(u.id)} className="text-sm text-[var(--muted)] hover:text-[var(--fg)]">
              Dismiss
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="mx-auto mt-[12vh] max-w-md text-center">
      <RibbonMark className="mx-auto h-12 w-9 text-[var(--line)]" />
      <h1 className="mt-6 font-serif text-3xl font-medium tracking-tight">Your shelf is empty</h1>
      <p className="mt-3 leading-relaxed text-[var(--muted)]">
        Add an EPUB, MOBI, AZW3 or PDF you own. It’s stored privately in your account, so you can open it on any device.
      </p>
      <button onClick={onAdd} className="mt-8 inline-flex items-center gap-2 rounded-full bg-[var(--fg)] px-6 py-3 font-medium text-[var(--bg)]">
        <Plus className="h-4 w-4" /> Add books
      </button>
      <p className="mt-4 text-sm text-[var(--muted)]">Or drop files anywhere on this page.</p>
    </section>
  );
}

function Cover({ book, className }: { book: Book; className?: string }) {
  const [failed, setFailed] = useState(false);
  const inProgress = book.progress && book.progress.fraction > 0.001 && book.progress.fraction < 0.995;
  return (
    <div className={`relative aspect-[2/3] ${className ?? ""}`}>
      {book.coverUrl && !failed ? (
        <img
          src={book.coverUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full rounded-[3px] object-cover shadow-[0_1px_2px_rgba(0,0,0,.18),0_8px_20px_-8px_rgba(0,0,0,.35)]"
        />
      ) : (
        <PlainCover book={book} />
      )}
      {inProgress && (
        // The bookmark ribbon: reaches down the cover as far as you've read.
        <div
          className="absolute right-3 w-3 bg-[var(--ribbon)] [clip-path:polygon(0_0,100%_0,100%_100%,50%_calc(100%-5px),0_100%)]"
          style={{ top: 0, height: `calc(12px + ${Math.round(book.progress!.fraction * 100)}%)`, maxHeight: "calc(100% + 12px)" }}
          aria-hidden
        />
      )}
    </div>
  );
}

function PlainCover({ book }: { book: Book }) {
  // Hue from the file hash, so each book keeps its own colour on every device.
  const hue = parseInt(book.sha256.slice(0, 4), 16) % 360;
  return (
    <div
      className="flex h-full w-full flex-col justify-between rounded-[3px] p-3 shadow-[0_1px_2px_rgba(0,0,0,.18),0_8px_20px_-8px_rgba(0,0,0,.35)]"
      style={{ background: `oklch(0.42 0.06 ${hue})`, color: `oklch(0.93 0.02 ${hue})` }}
    >
      <p className="line-clamp-5 font-serif text-[0.95rem] leading-snug font-medium">{book.title}</p>
      <p className="line-clamp-2 text-xs opacity-80">{book.author}</p>
    </div>
  );
}

function ContinueReading({ book }: { book: Book }) {
  const p = book.progress!;
  return (
    <section className="mt-4 flex gap-5 sm:mt-8 sm:gap-10">
      <button onClick={() => openBook(book._id)} className="w-28 shrink-0 sm:w-40" aria-label={`Continue ${book.title}`}>
        <Cover book={book} />
      </button>
      <div className="flex min-w-0 flex-col justify-center">
        <h1 className="line-clamp-3 font-serif text-2xl leading-tight font-medium tracking-tight sm:text-4xl">{book.title}</h1>
        {book.author && <p className="mt-1.5 text-[var(--muted)] sm:text-lg">{book.author}</p>}
        <p className="mt-4 text-sm sm:text-base">
          {pct(p.fraction)} read{p.chapter ? <>, in <span className="italic">{p.chapter}</span></> : null}
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Last read {ago(p.updatedAt)} on {p.deviceName}
        </p>
        <button
          onClick={() => openBook(book._id)}
          className="mt-5 self-start rounded-full bg-[var(--ribbon)] px-6 py-2.5 font-medium text-[var(--on-ribbon)]"
        >
          Continue reading
        </button>
      </div>
    </section>
  );
}

function ShelfBook({ book }: { book: Book }) {
  const remove = useMutation(api.books.remove);
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const f = book.progress?.fraction ?? 0;
  const status = !book.progress || f < 0.001 ? "New" : f >= 0.995 ? "Finished" : pct(f);

  const doRemove = async () => {
    await remove({ bookId: book._id as Id<"books"> });
    void dropCached(book.sha256);
  };

  return (
    <li className="group relative">
      <button onClick={() => openBook(book._id)} className="block w-full text-left">
        <Cover book={book} />
        <p className="mt-4 line-clamp-2 font-serif leading-snug font-medium">{book.title}</p>
      </button>
      <div className="mt-0.5 flex items-center gap-2 text-sm text-[var(--muted)]">
        <span className="min-w-0 flex-1 truncate">{book.author || book.format.toUpperCase()}</span>
        <span className={f > 0.001 && f < 0.995 ? "text-[var(--fg)]" : undefined}>{status}</span>
        <button
          onClick={() => setMenu((m) => !m)}
          className="-mr-2 grid h-7 w-7 place-items-center rounded-full hover:bg-[var(--line)]"
          aria-label={`Options for ${book.title}`}
          aria-expanded={menu}
        >
          <More className="h-4 w-4" />
        </button>
      </div>
      {menu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => (setMenu(false), setConfirming(false))} />
          <div className="absolute right-0 z-20 mt-1 w-60 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-sm shadow-lg">
            {confirming ? (
              <>
                <p className="leading-snug">Remove this book and its reading position from every device?</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => void doRemove()} className="flex-1 rounded-lg bg-[var(--ribbon)] py-1.5 font-medium text-[var(--on-ribbon)]">
                    Remove
                  </button>
                  <button onClick={() => (setMenu(false), setConfirming(false))} className="flex-1 rounded-lg border border-[var(--line)] py-1.5">
                    Keep
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="px-1 text-[var(--muted)]">
                  {book.format.toUpperCase()}, {(book.size / 1048576).toFixed(1)} MB
                </p>
                <button onClick={() => setConfirming(true)} className="mt-2 w-full rounded-lg px-1 py-1.5 text-left hover:bg-[var(--line)]">
                  Remove from library
                </button>
              </>
            )}
          </div>
        </>
      )}
    </li>
  );
}
