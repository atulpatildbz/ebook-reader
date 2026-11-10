// Finding a phrase in the book, forgiving the way a phrase heard (say, from the audiobook) differs
// from the printed text: capitals, accents, punctuation, curly vs straight quotes and line breaks
// are all ignored. "dont you think its odd" finds "Don’t you think, it’s odd".
import { foliateModule, tocSection, type FoliateView, type TocItem } from "../../lib/foliate";
import { notText } from "../html";

export type SearchHit = {
  cfi: string;
  section: number;
  chapter: string;
  pre: string;
  match: string;
  post: string;
};

type Match = { range: Range; start: number; end: number; text: string };
type TextWalker = (
  doc: Document,
  func: (strs: string[], makeRange: (si: number, so: number, ei: number, eo: number) => Range) => Generator<Match>,
  filter: (node: Node) => number,
) => Generator<Match>;

/** Search the text as copying and narration see it: not in code, styles or hidden notes. */
const textNodes = (node: Node) =>
  node.nodeType !== Node.ELEMENT_NODE ? NodeFilter.FILTER_ACCEPT : notText(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;

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

const normalizeQuery = (q: string) => normalize(q).norm.trim();

/** Whether there's enough of a query to look for. */
export const canSearch = (q: string) => normalizeQuery(q).length >= 2;

const tidy = (s: string) => s.replace(/\s+/g, " ");

/** Chapter title for each section: the last table-of-contents entry starting at or before it. */
async function chapterLabels(view: FoliateView): Promise<string[]> {
  const { book } = view;
  const starts = new Map<number, string>();
  const walk = async (items?: TocItem[]) => {
    for (const it of items ?? []) {
      const place = await tocSection(book, it.href);
      if (place && !starts.has(place.index)) starts.set(place.index, it.label?.trim() ?? "");
      await walk(it.subitems);
    }
  };
  await walk(book.toc);
  const labels: string[] = [];
  let current = "";
  for (let i = 0; i < book.sections.length; i++) labels.push((current = starts.get(i) ?? current));
  return labels;
}

export const SEARCH_LIMIT = 300;

/**
 * Search the whole book, section by section. `onHits` receives each section's matches as they're
 * found; stop early by aborting `signal`.
 */
export async function searchBook(
  view: FoliateView,
  query: string,
  opts: { signal: AbortSignal; onHits: (hits: SearchHit[]) => void; onProgress: (f: number) => void },
): Promise<void> {
  const needle = normalizeQuery(query);
  if (!needle) return;
  const { textWalker } = await foliateModule<{ textWalker: TextWalker }>("text-walker.js");
  const { sections } = view.book;
  const labels = await chapterLabels(view);
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
    const matches = textWalker(doc, function* (strs, makeRange) {
      const text = strs.join("");
      const { norm, map } = normalize(text);
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
        yield { range: makeRange(si, so, ei, eo + 1), start, end, text };
        at = norm.indexOf(needle, at + needle.length);
      }
    }, textNodes);
    for (const { range, start, end, text } of matches) {
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
      if (++found >= SEARCH_LIMIT) break;
    }
    if (hits.length) opts.onHits(hits);
    if (found >= SEARCH_LIMIT) break;
    // Let the page breathe between sections on slow phones.
    await new Promise((r) => setTimeout(r, 0));
  }
  opts.onProgress(1);
}
