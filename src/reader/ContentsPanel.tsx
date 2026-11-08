import { useEffect, useRef } from "react";
import type { TocItem } from "../lib/foliate";
import { Drawer } from "../ui/controls";

export function ContentsPanel({ toc, current, onPick, onClose }: { toc: TocItem[]; current?: string; onPick: (href: string) => void; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector("[aria-current='true']")?.scrollIntoView({ block: "center" });
  }, []);
  return (
    <Drawer title="Contents" width="w-[min(24rem,88vw)]" onClose={onClose}>
      <div ref={list} className="flex-1 overflow-y-auto overscroll-contain px-2 pb-6">
        <TocList items={toc} current={current} onPick={onPick} depth={0} />
      </div>
    </Drawer>
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
