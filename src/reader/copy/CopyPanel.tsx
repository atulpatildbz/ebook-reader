import { useEffect, useMemo, useState } from "react";
import { copyText } from "../../lib/clipboard";
import type { FoliateView } from "../../lib/foliate";
import { setSettings, useSettings } from "../../lib/settings";
import { Group, Segmented, Sheet } from "../../ui/controls";
import { Check } from "../../ui/icons";
import { chapterText, countWords, splitParts } from "./chapterText";

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
    <Sheet title="Copy chapter" onClose={onClose} className="space-y-5">
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
    </Sheet>
  );
}
