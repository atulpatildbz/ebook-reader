import { IconButton } from "../../ui/controls";
import { Close, Next, Prev } from "../../ui/icons";
import type { BookSearch } from "./useBookSearch";

/** The match on screen: step through the others, or go back to where reading was. */
export function MatchBar({ search, onShowAll }: { search: BookSearch; onShowAll: () => void }) {
  if (search.active === null) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-4" style={{ top: "calc(env(safe-area-inset-top) + 12px)" }}>
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] py-1 pr-1 pl-2 text-sm shadow-lg">
        <button onClick={onShowAll} className="rounded-full px-2 py-1.5 tabular-nums" title="Show all matches">
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
  );
}
