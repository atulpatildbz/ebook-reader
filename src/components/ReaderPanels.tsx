import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchHit } from "../lib/search";
import type { FoliateView, TocItem } from "../lib/foliate";
import { chapterText, copyText, countWords, splitParts } from "../lib/chapterText";
import { DEFAULTS, setSettings, useSettings, useTheme, type Settings } from "../lib/settings";
import { DAY_THEMES, FONTS, NIGHT_THEMES, type Theme } from "../lib/themes";
import { Check, Close, Search as SearchIcon } from "./icons";

export function ContentsPanel({ toc, current, onPick, onClose }: { toc: TocItem[]; current?: string; onPick: (href: string) => void; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector("[aria-current='true']")?.scrollIntoView({ block: "center" });
  }, []);
  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/25" onClick={onClose} />
      <aside
        className="absolute inset-y-0 left-0 z-50 flex w-[min(24rem,88vw)] flex-col border-r border-[var(--line)] bg-[var(--surface)] shadow-2xl"
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Contents"
      >
        <div className="flex h-14 items-center justify-between pr-2 pl-5">
          <h2 className="font-serif text-lg font-medium">Contents</h2>
          <button onClick={onClose} aria-label="Close contents" className="grid h-11 w-11 place-items-center rounded-full text-[var(--muted)]">
            <Close />
          </button>
        </div>
        <div ref={list} className="flex-1 overflow-y-auto overscroll-contain px-2 pb-6">
          <TocList items={toc} current={current} onPick={onPick} depth={0} />
        </div>
      </aside>
    </>
  );
}

function TocList({ items, current, onPick, depth }: { items: TocItem[]; current?: string; onPick: (h: string) => void; depth: number }) {
  return (
    <ul>
      {items.map((it, i) => (
        <li key={`${it.href}-${i}`}>
          <button
            onClick={() => it.href && onPick(it.href)}
            aria-current={it.href === current}
            className={`block w-full rounded-lg py-2.5 pr-3 text-left leading-snug hover:bg-[var(--line)] aria-[current=true]:font-medium aria-[current=true]:text-[var(--ribbon)] ${depth ? "text-[0.95rem] text-[var(--muted)]" : ""}`}
            style={{ paddingLeft: `${0.75 + depth * 1}rem` }}
          >
            {it.label?.trim()}
          </button>
          {it.subitems?.length ? <TocList items={it.subitems} current={current} onPick={onPick} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

const FONT_SHEET = `https://fonts.googleapis.com/css2?${FONTS.filter((f) => f.google)
  .map((f) => `family=${f.google}`)
  .join("&")}&display=swap`;

export function SettingsPanel({ fixed, onClose }: { fixed: boolean; onClose: () => void }) {
  const s = useSettings();
  const shown = useTheme();

  // The font list shows each face in itself.
  useEffect(() => {
    if (document.querySelector(`link[data-fonts]`)) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = FONT_SHEET;
    l.dataset.fonts = "";
    document.head.append(l);
  }, []);

  return (
    <>
      <div className="absolute inset-0 z-40" onClick={onClose} />
      <aside
        className="absolute inset-x-0 bottom-0 z-50 mx-auto max-h-[78dvh] max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl border-t border-[var(--line)] bg-[var(--surface)] shadow-2xl sm:inset-x-auto sm:mx-0 sm:top-[calc(env(safe-area-inset-top)+3.5rem)] sm:right-3 sm:bottom-auto sm:max-h-[calc(100dvh-5rem)] sm:w-[23rem] sm:rounded-2xl sm:border"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Text and theme"
      >
        <div className="sticky top-0 z-10 flex h-12 items-center justify-between bg-[var(--surface)] pr-2 pl-5">
          <h2 className="font-serif text-lg font-medium">Text and theme</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full text-[var(--muted)]">
            <Close />
          </button>
        </div>

        <div className="space-y-6 px-5 pt-1 pb-6">
          <Group label="Theme">
            <Segmented
              value={s.mode}
              options={[
                ["auto", "Match system"],
                ["day", "Day"],
                ["night", "Night"],
              ]}
              onChange={(mode) => setSettings({ mode })}
            />
            <Swatches themes={DAY_THEMES} value={s.dayTheme} onPick={(id) => setSettings({ dayTheme: id, mode: shown.dark ? "day" : s.mode })} />
            <Swatches themes={NIGHT_THEMES} value={s.nightTheme} onPick={(id) => setSettings({ nightTheme: id, mode: shown.dark ? s.mode : "night" })} />
          </Group>

          {!fixed && (
            <>
              <Group label="Font">
                <div className="grid grid-cols-2 gap-2">
                  {FONTS.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setSettings({ font: f.id })}
                      aria-pressed={s.font === f.id}
                      className="rounded-xl border border-[var(--line)] px-3 py-2 text-left aria-pressed:border-[var(--fg)] aria-pressed:bg-[var(--bg)]"
                    >
                      <span className="block text-[1.05rem]" style={{ fontFamily: f.stack || "inherit" }}>
                        {f.name}
                      </span>
                      <span className="block text-xs text-[var(--muted)]">{f.note}</span>
                    </button>
                  ))}
                </div>
              </Group>

              <Group label="Size">
                <div className="flex items-center gap-3">
                  <Step onClick={() => setSettings({ fontSize: Math.max(13, s.fontSize - 1) })} label="Smaller text">
                    <span className="font-serif text-sm">A</span>
                  </Step>
                  <input
                    type="range"
                    min={13}
                    max={36}
                    value={s.fontSize}
                    onChange={(e) => setSettings({ fontSize: Number(e.target.value) })}
                    className="flex-1"
                    aria-label="Text size"
                  />
                  <Step onClick={() => setSettings({ fontSize: Math.min(36, s.fontSize + 1) })} label="Larger text">
                    <span className="font-serif text-xl">A</span>
                  </Step>
                </div>
              </Group>

              <Slider label="Line spacing" min={1.1} max={2.2} step={0.05} value={s.lineHeight} show={(v) => v.toFixed(2)} onChange={(lineHeight) => setSettings({ lineHeight })} />
              <Slider label="Page width" min={420} max={1100} step={20} value={s.width} show={(v) => `${Math.round(v / 10)} em`} onChange={(width) => setSettings({ width })} />

              <Group label="Layout">
                <Segmented
                  value={s.flow}
                  options={[
                    ["paginated", "Pages"],
                    ["scrolled", "Scroll"],
                  ]}
                  onChange={(flow) => setSettings({ flow })}
                />
                <Toggle label="Justify text" value={s.justify} onChange={(justify) => setSettings({ justify })} />
                <Toggle label="Hyphenate" value={s.hyphenate} onChange={(hyphenate) => setSettings({ hyphenate })} />
                <Toggle label="Two pages on wide screens" value={s.spread} onChange={(spread) => setSettings({ spread })} />
                <Toggle label="Slide when turning pages" value={s.animated} onChange={(animated) => setSettings({ animated })} />
                <Toggle label="Keep the book’s own colours" value={s.publisherColors} onChange={(publisherColors) => setSettings({ publisherColors })} />
              </Group>
            </>
          )}

          {fixed && (
            <Group label="Page fit">
              <Segmented
                value={s.pdfZoom}
                options={[
                  ["fit-page", "Whole page"],
                  ["fit-width", "Full width"],
                ]}
                onChange={(pdfZoom) => setSettings({ pdfZoom })}
              />
            </Group>
          )}

          <Slider label="Dim the screen" min={0} max={0.6} step={0.05} value={s.dim} show={(v) => (v ? `${Math.round(v * 100)}%` : "Off")} onChange={(dim) => setSettings({ dim })} />

          <button
            onClick={() => setSettings({ ...DEFAULTS, mode: s.mode, dayTheme: s.dayTheme, nightTheme: s.nightTheme, copyPartWords: s.copyPartWords } satisfies Settings)}
            className="text-sm text-[var(--muted)] underline underline-offset-4 hover:text-[var(--fg)]"
          >
            Reset text and layout
          </button>
        </div>
      </aside>
    </>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-[var(--muted)]">{label}</h3>
      {children}
    </section>
  );
}

function Swatches({ themes, value, onPick }: { themes: Theme[]; value: string; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {themes.map((t) => (
        <button
          key={t.id}
          onClick={() => onPick(t.id)}
          aria-pressed={value === t.id}
          className="group flex flex-col items-center gap-1.5"
          aria-label={`${t.name} theme`}
        >
          <span
            className="relative grid aspect-[4/5] w-full place-items-center overflow-hidden rounded-lg border font-serif text-lg ring-offset-2 ring-offset-[var(--surface)] group-aria-pressed:ring-2 group-aria-pressed:ring-[var(--fg)]"
            style={{ background: t.bg, color: t.fg, borderColor: t.line }}
          >
            Aa
            <span className="absolute top-0 right-1.5 h-3 w-1.5" style={{ background: t.ribbon, clipPath: "polygon(0 0,100% 0,100% 100%,50% 75%,0 100%)" }} />
          </span>
          <span className="text-xs text-[var(--muted)] group-aria-pressed:text-[var(--fg)]">{t.name}</span>
        </button>
      ))}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-full border border-[var(--line)] p-1" role="radiogroup">
      {options.map(([v, label]) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className="flex-1 rounded-full py-1.5 text-sm text-[var(--muted)] aria-checked:bg-[var(--fg)] aria-checked:text-[var(--surface)]"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Slider({ label, min, max, step, value, show, onChange }: { label: string; min: number; max: number; step: number; value: number; show: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block space-y-2">
      <span className="flex justify-between text-sm">
        <span className="font-medium text-[var(--muted)]">{label}</span>
        <span className="text-[var(--muted)] tabular-nums">{show(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={value} onClick={() => onChange(!value)} className="flex w-full items-center justify-between py-1 text-left">
      <span>{label}</span>
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${value ? "bg-[var(--ribbon)]" : "bg-[var(--line)]"}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-[left] ${value ? "left-5" : "left-1"}`} />
      </span>
    </button>
  );
}

function Step({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} className="grid h-10 w-10 place-items-center rounded-full border border-[var(--line)]">
      {children}
    </button>
  );
}

export type SearchState = { query: string; hits: SearchHit[]; progress: number; running: boolean };

export function SearchPanel({
  state,
  active,
  onSearch,
  onPick,
  onClose,
}: {
  state: SearchState;
  active: number | null;
  onSearch: (q: string) => void;
  onPick: (i: number) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(state.query);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    list.current?.querySelector("[aria-current='true']")?.scrollIntoView({ block: "center" });
  }, []);

  // Search as you type, once typing pauses.
  useEffect(() => {
    if (text === state.query) return;
    const t = window.setTimeout(() => onSearch(text), 450);
    return () => window.clearTimeout(t);
  }, [text, state.query, onSearch]);

  const { hits, running, progress, query } = state;
  const status = !query.trim()
    ? "Type a few words you heard or remember. Punctuation and capitals don’t matter."
    : running
      ? `Searching, ${Math.round(progress * 100)}%${hits.length ? `. ${hits.length} found so far` : ""}`
      : hits.length === 0
        ? `No matches for “${query.trim()}”. Try fewer or different words.`
        : `${hits.length === 300 ? "First 300" : hits.length} ${hits.length === 1 ? "match" : "matches"}`;

  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/25" onClick={onClose} />
      <aside
        className="absolute inset-y-0 left-0 z-50 flex w-[min(26rem,92vw)] flex-col border-r border-[var(--line)] bg-[var(--surface)] shadow-2xl"
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Find in book"
      >
        <div className="flex h-14 items-center justify-between pr-2 pl-5">
          <h2 className="font-serif text-lg font-medium">Find in book</h2>
          <button onClick={onClose} aria-label="Close search" className="grid h-11 w-11 place-items-center rounded-full text-[var(--muted)]">
            <Close />
          </button>
        </div>
        <form
          className="px-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch(text);
          }}
        >
          <label className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 focus-within:border-[var(--fg)]">
            <SearchIcon className="h-4 w-4 shrink-0 text-[var(--muted)]" />
            <input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Find a phrase"
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--muted)]"
              aria-label="Words to find"
            />
            {text && (
              <button type="button" onClick={() => (setText(""), onSearch(""), input.current?.focus())} aria-label="Clear" className="text-[var(--muted)]">
                <Close className="h-4 w-4" />
              </button>
            )}
          </label>
          <p className="mt-2 px-1 text-sm leading-snug text-[var(--muted)]" aria-live="polite">
            {status}
          </p>
          {running && (
            <div className="mt-2 h-0.5 overflow-hidden rounded bg-[var(--line)]">
              <div className="h-full bg-[var(--ribbon)] transition-[width]" style={{ width: `${progress * 100}%` }} />
            </div>
          )}
        </form>
        <div ref={list} className="mt-3 flex-1 overflow-y-auto overscroll-contain px-2 pb-6">
          <ul>
            {hits.map((h, i) => (
              <li key={h.cfi}>
                {(i === 0 || hits[i - 1].chapter !== h.chapter) && h.chapter && (
                  <p className="mt-3 mb-1 px-3 text-xs font-medium text-[var(--muted)]">{h.chapter}</p>
                )}
                <button
                  onClick={() => onPick(i)}
                  aria-current={i === active}
                  className="block w-full rounded-lg px-3 py-2 text-left font-serif text-[0.95rem] leading-snug hover:bg-[var(--line)] aria-[current=true]:bg-[var(--line)]"
                >
                  <span className="text-[var(--muted)]">{h.pre}</span>
                  <mark className="rounded-sm bg-[color-mix(in_srgb,var(--ribbon)_28%,transparent)] px-0.5 text-[var(--fg)]">{h.match}</mark>
                  <span className="text-[var(--muted)]">{h.post}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </>
  );
}

const PART_SIZES = [1000, 2000, 5000];
const num = (n: number) => n.toLocaleString();
const opening = (s: string) => s.split(/\s+/).slice(0, 9).join(" ") + "…";

/** Copy the chapter on screen as plain text: whole, or part by part for apps that take less at a time. */
export function CopyPanel({
  view,
  tocItem,
  section,
  chapter,
  onClose,
}: {
  view: FoliateView;
  tocItem: { href?: string } | null | undefined;
  section: number;
  chapter?: string;
  onClose: () => void;
}) {
  const s = useSettings();
  const [paras, setParas] = useState<string[] | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [copied, setCopied] = useState<string | null>(null); // "all", or the part as "size:index"
  const [done, setDone] = useState<Set<string>>(new Set()); // parts already copied
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setParas(null);
    chapterText(view, tocItem, section)
      .then((p) => !cancelled && setParas(p))
      .catch((e) => {
        console.error(e);
        if (!cancelled) setUnreadable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [view, tocItem, section]);

  const text = useMemo(() => paras?.join("\n\n") ?? "", [paras]);
  const words = useMemo(() => countWords(text), [text]);
  const parts = useMemo(() => (paras ? splitParts(paras, s.copyPartWords) : []), [paras, s.copyPartWords]);

  // The text is ready before the tap, so the copy runs straight from it (Safari requires that).
  const copy = (key: string, t: string) => {
    copyText(t).then(
      () => {
        setError(false);
        setCopied(key);
        if (key !== "all") setDone((d) => new Set(d).add(key));
      },
      (e) => {
        console.warn("Copy failed", e);
        setCopied(null);
        setError(true);
      },
    );
  };

  return (
    <>
      <div className="absolute inset-0 z-40" onClick={onClose} />
      <aside
        className="absolute inset-x-0 bottom-0 z-50 mx-auto flex max-h-[78dvh] max-w-lg flex-col rounded-t-2xl border-t border-[var(--line)] bg-[var(--surface)] shadow-2xl sm:inset-x-auto sm:mx-0 sm:top-[calc(env(safe-area-inset-top)+3.5rem)] sm:right-3 sm:bottom-auto sm:max-h-[calc(100dvh-5rem)] sm:w-[23rem] sm:rounded-2xl sm:border"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Copy chapter"
      >
        <div className="flex h-12 shrink-0 items-center justify-between pr-2 pl-5">
          <h2 className="font-serif text-lg font-medium">Copy chapter</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full text-[var(--muted)]">
            <Close />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto overscroll-contain px-5 pt-1 pb-6">
          <div>
            <p className="font-serif leading-snug">{chapter || "This chapter"}</p>
            <p className="mt-1 text-sm text-[var(--muted)] tabular-nums" aria-live="polite">
              {unreadable
                ? "The text of this chapter couldn’t be read."
                : !paras
                  ? "Reading the chapter…"
                  : words
                    ? `${num(words)} ${words === 1 ? "word" : "words"} · ${num(text.length)} characters`
                    : "There’s no text in this chapter."}
            </p>
          </div>

          {words > 0 && (
            <button
              onClick={() => copy("all", text)}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--ribbon)] px-5 py-2.5 font-medium text-[var(--on-ribbon)]"
            >
              {copied === "all" ? (
                <>
                  <Check /> Copied
                </>
              ) : (
                "Copy whole chapter"
              )}
            </button>
          )}
          {error && (
            <p role="alert" className="text-sm leading-snug">
              That didn’t copy. The browser may have blocked it, or it was too much at once: try a smaller part below.
            </p>
          )}

          {words > PART_SIZES[0] && (
            <Group label="Or in parts">
              <Segmented
                value={String(s.copyPartWords)}
                options={PART_SIZES.map((n) => [String(n), `${num(n)} words`])}
                onChange={(v) => setSettings({ copyPartWords: Number(v) })}
              />
              <ul className="-mx-2">
                {parts.map((p, i) => {
                  const key = `${s.copyPartWords}:${i}`;
                  return (
                    <li key={key}>
                      <button onClick={() => copy(key, p)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-[var(--line)]">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">
                            Part {i + 1} of {parts.length}
                            <span className="font-normal text-[var(--muted)] tabular-nums"> · {num(countWords(p))} words</span>
                          </span>
                          <span className="block truncate font-serif text-sm text-[var(--muted)]">{opening(p)}</span>
                        </span>
                        <span className="shrink-0 text-sm text-[var(--muted)]">
                          {copied === key ? (
                            <span className="flex items-center gap-1 text-[var(--fg)]">
                              <Check className="h-4 w-4" /> Copied
                            </span>
                          ) : done.has(key) ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            "Copy"
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Group>
          )}
        </div>
      </aside>
    </>
  );
}
