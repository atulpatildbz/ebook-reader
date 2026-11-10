import { useEffect, useRef, useState } from "react";
import { Drawer } from "../../ui/controls";
import { Close, Search as SearchIcon } from "../../ui/icons";
import { canSearch, SEARCH_LIMIT } from "./search";
import type { SearchState } from "./useBookSearch";

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

  useEffect(() => {
    if (text === state.query) return;
    const t = window.setTimeout(() => onSearch(text), 450);
    return () => window.clearTimeout(t);
  }, [text, state.query, onSearch]);

  const { hits, running, progress, query } = state;
  const status = !canSearch(query)
    ? "Type a few words you heard or remember. Punctuation and capitals don’t matter."
    : running
      ? `Searching, ${Math.round(progress * 100)}%${hits.length ? `. ${hits.length} found so far` : ""}`
      : hits.length === 0
        ? `No matches for “${query.trim()}”. Try fewer or different words.`
        : `${hits.length === SEARCH_LIMIT ? `First ${SEARCH_LIMIT}` : hits.length} ${hits.length === 1 ? "match" : "matches"}`;

  return (
    <Drawer title="Find in book" width="w-[min(26rem,92vw)]" onClose={onClose}>
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
    </Drawer>
  );
}
