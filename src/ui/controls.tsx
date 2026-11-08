import type { ReactNode } from "react";
import { Close } from "./icons";

function PanelHeader({ title, onClose, className }: { title: string; onClose: () => void; className: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-between pr-2 pl-5 ${className}`}>
      <h2 className="font-serif text-lg font-medium">{title}</h2>
      <button onClick={onClose} aria-label={`Close ${title.toLowerCase()}`} className="grid h-11 w-11 place-items-center rounded-full text-[var(--muted)]">
        <Close />
      </button>
    </div>
  );
}

/** A panel from the left edge over a dimmed page (contents, search). */
export function Drawer({ title, width, onClose, children }: { title: string; width: string; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/25" onClick={onClose} />
      <aside
        className={`absolute inset-y-0 left-0 z-50 flex flex-col border-r border-[var(--line)] bg-[var(--surface)] shadow-2xl ${width}`}
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label={title}
      >
        <PanelHeader title={title} onClose={onClose} className="h-14" />
        {children}
      </aside>
    </>
  );
}

/** A panel over the page that leaves it in view: a bottom sheet on phones, a card under the toolbar on wider screens. */
export function Sheet({ title, onClose, className, children }: { title: string; onClose: () => void; className: string; children: ReactNode }) {
  return (
    <>
      <div className="absolute inset-0 z-40" onClick={onClose} />
      <aside
        className="absolute inset-x-0 bottom-0 z-50 mx-auto flex max-h-[78dvh] max-w-lg flex-col rounded-t-2xl border-t border-[var(--line)] bg-[var(--surface)] shadow-2xl sm:inset-x-auto sm:mx-0 sm:top-[calc(env(safe-area-inset-top)+3.5rem)] sm:right-3 sm:bottom-auto sm:max-h-[calc(100dvh-5rem)] sm:w-[23rem] sm:rounded-2xl sm:border"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label={title}
      >
        <PanelHeader title={title} onClose={onClose} className="h-12" />
        <div className={`overflow-y-auto overscroll-contain px-5 pt-1 pb-6 ${className}`}>{children}</div>
      </aside>
    </>
  );
}

export function IconButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
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

export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-[var(--muted)]">{label}</h3>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
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

export function Slider({
  label,
  min,
  max,
  step,
  value,
  show,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  show: (v: number) => string;
  onChange: (v: number) => void;
}) {
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

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={value} onClick={() => onChange(!value)} className="flex w-full items-center justify-between py-1 text-left">
      <span>{label}</span>
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${value ? "bg-[var(--ribbon)]" : "bg-[var(--line)]"}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-[left] ${value ? "left-5" : "left-1"}`} />
      </span>
    </button>
  );
}

export function Step({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} className="grid h-10 w-10 place-items-center rounded-full border border-[var(--line)]">
      {children}
    </button>
  );
}
