// Finding a phrase in the book, forgiving the way a phrase heard (say, from the audiobook) differs
// from the printed text: capitals, accents, punctuation, curly vs straight quotes and line breaks
// are all ignored. "dont you think its odd" finds "Don’t you think, it’s odd".
import type { FoliateView } from "./foliate";

export type SearchHit = {
  cfi: string;
  section: number;
  chapter: string;
  pre: string;
  match: string;
  post: string;
};

type TextWalker = (
  doc: Document,
  func: (strs: string[], makeRange: (si: number, so: number, ei: number, eo: number) => Range) => Generator<Range>,
) => Generator<Range>;

const APOSTROPHES = /['‘’ʼ`´]/u;
const WORD = /[\p{L}\p{N}]/u;

/** Normalised text plus, for each normalised character, the index of the original character. */
function normalize(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let space = true; // collapse leading/duplicate separators
  let i = 0;
  for (const ch of text) {
    if (APOSTROPHES.test(ch)) {
      // dropped entirely: "don’t" and "dont" match
    } else {
      const base = ch.charCodeAt(0) < 128 ? ch.toLowerCase() : ch.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
      for (const c of base) {
        if (WORD.test(c)) {
          norm += c;
          map.push(i);
          space = false;
        } else if (!space) {
          norm += " ";
          map.push(i);
          space = true;
        }
      }
    }
    i += ch.length;
  }
  return { norm, map };
}

export const normalizeQuery = (q: string) => normalize(q).norm.trim();

const tidy = (s: string) => s.replace(/\s+/g, " ");

/** Chapter title for each section: the last table-of-contents entry starting at or before it. */
async function chapterLabels(view: FoliateView): Promise<string[]> {
  const book = view.book as unknown as {
    toc?: unknown;
    splitTOCHref?: (href: string) => Promise<[unknown, unknown]> | [unknown, unknown];
    sections: { id?: unknown }[];
  };
  const starts = new Map<number, string>();
  const walk = async (items?: { label?: string; href?: string; subitems?: unknown[] }[] | null) => {
    for (const it of items ?? []) {
      try {
        if (it.href && book.splitTOCHref) {
          const [id] = await book.splitTOCHref(it.href);
          const index = book.sections.findIndex((s) => s.id === id);
          if (index >= 0 && !starts.has(index)) starts.set(index, it.label?.trim() ?? "");
        }
      } catch {
        /* an entry that doesn't resolve is just skipped */
      }
      await walk(it.subitems as never);
    }
  };
  await walk(book.toc as never);
  const labels: string[] = [];
  let current = "";
  for (let i = 0; i < book.sections.length; i++) labels.push((current = starts.get(i) ?? current));
  return labels;
}

/**
 * Search the whole book, section by section. `onHits` receives each section's matches as they're
 * found; stop early by aborting `signal`. At most `limit` matches are reported.
 */
export async function searchBook(
  view: FoliateView,
  query: string,
  opts: { signal: AbortSignal; onHits: (hits: SearchHit[]) => void; onProgress: (f: number) => void; limit?: number },
): Promise<void> {
  const needle = normalizeQuery(query);
  if (!needle) return;
  const { textWalker } = (await import(/* @vite-ignore */ `${import.meta.env.BASE_URL}foliate-js/text-walker.js`)) as {
    textWalker: TextWalker;
  };
  const sections = view.book.sections as { createDocument?: () => Promise<Document>; linear?: string }[];
  const labels = await chapterLabels(view);
  const limit = opts.limit ?? 300;
  let found = 0;

  for (let index = 0; index < sections.length; index++) {
    if (opts.signal.aborted) return;
    opts.onProgress(index / sections.length);
    const create = sections[index].createDocument;
    if (!create) continue;
    let doc: Document;
    try {
      doc = await create();
    } catch {
      continue;
    }
    const hits: SearchHit[] = [];
    const ranges = textWalker(doc, function* (strs, makeRange) {
      const text = strs.join("");
      const { norm, map } = normalize(text);
      // Where each node's text starts in `text`, to turn offsets back into (node, offset).
      const starts: number[] = [];
      let sum = 0;
      for (const s of strs) starts.push((sum += s.length) - s.length);
      const locate = (offset: number): [number, number] => {
        let i = starts.length - 1;
        while (i > 0 && starts[i] > offset) i--;
        return [i, offset - starts[i]];
      };
      let at = norm.indexOf(needle);
      while (at !== -1) {
        const start = map[at];
        const lastChar = map[at + needle.length - 1];
        const end = lastChar + (text.codePointAt(lastChar)! > 0xffff ? 2 : 1);
        const [si, so] = locate(start);
        const [ei, eo] = locate(end - 1);
        const range = makeRange(si, so, ei, eo + 1);
        (range as Range & { _text?: [number, number, string] })._text = [start, end, text];
        yield range;
        at = norm.indexOf(needle, at + needle.length);
      }
    });
    for (const range of ranges) {
      const [start, end, text] = (range as Range & { _text: [number, number, string] })._text;
      const pre = tidy(text.slice(Math.max(0, start - 60), start)).trimStart();
      const post = tidy(text.slice(end, end + 60)).trimEnd();
      hits.push({
        cfi: view.getCFI(index, range),
        section: index,
        chapter: labels[index] ?? "",
        pre: (start > 60 ? "…" : "") + pre,
        match: tidy(text.slice(start, end)),
        post: post + (end + 60 < text.length ? "…" : ""),
      });
      if (++found >= limit) break;
    }
    if (hits.length) opts.onHits(hits);
    if (found >= limit) break;
    // Let the page breathe between sections on slow phones.
    await new Promise((r) => setTimeout(r, 0));
  }
  opts.onProgress(1);
}
