// Finding text in the open book: search it all, jump to a match with it highlighted, step through
// the others, and go back to where reading was if it was the wrong one.
import { useCallback, useEffect, useRef, useState } from "react";
import { foliateModule, type FoliateView } from "../../lib/foliate";
import { normalizeQuery, searchBook, type SearchHit } from "./search";

export type SearchState = { query: string; hits: SearchHit[]; progress: number; running: boolean };

export function useBookSearch(
  view: FoliateView | null,
  opts: {
    color: string;
    /** Where the reader is now. */
    here: () => string | null;
    /** Called before each jump: the reader moving on. */
    onJump: () => void;
  },
) {
  const [state, setState] = useState<SearchState>({ query: "", hits: [], progress: 0, running: false });
  const [active, setActive] = useState<number | null>(null); // the match on screen
  const abort = useRef<AbortController | null>(null);
  const returnTo = useRef<string | null>(null); // where the reader was before jumping to a match
  const mark = useRef<{ value: string; index: number } | null>(null); // the highlighted match
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // The match is drawn in the highlight colour, and again whenever its chapter is laid out anew.
  useEffect(() => {
    if (!view) return;
    let cancelled = false;
    let highlight: unknown;
    void foliateModule<{ Overlayer: { highlight: unknown } }>("overlayer.js").then(({ Overlayer }) => (highlight = Overlayer.highlight));
    const draw = (e: Event) => {
      const { draw } = (e as CustomEvent<{ draw: (f: unknown, o: object) => void }>).detail;
      if (highlight) draw(highlight, { color: optsRef.current.color });
    };
    const overlay = (e: Event) => {
      const m = mark.current;
      if (!cancelled && m && (e as CustomEvent<{ index: number }>).detail.index === m.index) void view.addAnnotation({ value: m.value });
    };
    view.addEventListener("draw-annotation", draw);
    view.addEventListener("create-overlay", overlay);
    return () => {
      cancelled = true;
      view.removeEventListener("draw-annotation", draw);
      view.removeEventListener("create-overlay", overlay);
    };
  }, [view]);

  useEffect(() => () => abort.current?.abort(), []);

  const run = useCallback(
    (query: string) => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setActive(null);
      const enough = normalizeQuery(query).length >= 2;
      setState({ query, hits: [], progress: 0, running: enough });
      if (!view || !enough) return;
      searchBook(view, query, {
        signal: ctrl.signal,
        onHits: (hits) => !ctrl.signal.aborted && setState((s) => ({ ...s, hits: [...s.hits, ...hits] })),
        onProgress: (progress) => !ctrl.signal.aborted && setState((s) => ({ ...s, progress })),
      })
        .catch((e) => console.error("Search failed", e))
        .finally(() => !ctrl.signal.aborted && setState((s) => ({ ...s, running: false, progress: 1 })));
    },
    [view],
  );

  const unmark = () => {
    if (mark.current && view) void view.deleteAnnotation({ value: mark.current.value });
    mark.current = null;
  };

  const show = async (i: number) => {
    const hit = state.hits[i];
    if (!view || !hit) return;
    returnTo.current ??= opts.here() ?? view.lastLocation?.cfi ?? null;
    setActive(i);
    opts.onJump();
    unmark();
    mark.current = { value: hit.cfi, index: hit.section };
    await view.goTo(hit.cfi);
    if (mark.current?.value === hit.cfi) await view.addAnnotation({ value: hit.cfi });
  };

  const step = (d: 1 | -1) => {
    const n = state.hits.length;
    if (active !== null && n) void show((active + d + n) % n);
  };

  const end = () => {
    unmark();
    setActive(null);
    returnTo.current = null;
  };

  const goBack = async () => {
    const back = returnTo.current;
    end();
    if (back && view) {
      opts.onJump();
      await view.goTo(back);
    }
  };

  return { state, active, run, show, step, end, goBack, canGoBack: !!returnTo.current };
}
