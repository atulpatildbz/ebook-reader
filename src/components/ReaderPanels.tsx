import { useEffect, useRef } from "react";
import type { TocItem } from "../lib/foliate";
import { DEFAULTS, setSettings, useSettings, useTheme, type Settings } from "../lib/settings";
import { DAY_THEMES, FONTS, NIGHT_THEMES, type Theme } from "../lib/themes";
import { Close } from "./icons";

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
            onClick={() => setSettings({ ...DEFAULTS, mode: s.mode, dayTheme: s.dayTheme, nightTheme: s.nightTheme } satisfies Settings)}
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
