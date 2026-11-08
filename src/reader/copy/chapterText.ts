// The chapter being read as plain text, for copying out of the book: whole, or in parts small
// enough for wherever it's pasted.
import { tocSection, type FoliateView, type TocItem } from "../../lib/foliate";
import { BLOCK_ELEMENTS, isHiddenNote } from "../html";

type Place = { index: number; fragment?: unknown };

const flatten = (items?: TocItem[] | null): TocItem[] => (items ?? []).flatMap((it) => [it, ...flatten(it.subitems)]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const SKIP = new Set(["script", "style", "noscript", "template", "head"]);

/** Paragraphs of text under `root`, one per block element; line breaks kept. */
function paragraphs(root: Node): string[] {
  const out: string[] = [];
  let line = "";
  const flush = () => {
    const t = line.replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
    if (t) out.push(t);
    line = "";
  };
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      line += (n as Text).data.replace(/\s+/g, " ");
      return;
    }
    const name = (n as Element).localName;
    if (SKIP.has(name) || isHiddenNote(n as Element)) return;
    if (name === "br") {
      line += "\n";
      return;
    }
    const block = BLOCK_ELEMENTS.has(name);
    if (block) flush();
    for (const c of n.childNodes) walk(c);
    if (block) flush();
  };
  walk(root);
  flush();
  return out;
}

/**
 * The text of the chapter on screen: from its table-of-contents entry to the next one, which may
 * span several sections or be part of one. Without a usable entry, the current section.
 */
export async function chapterText(view: FoliateView, tocItem: { href?: string } | null | undefined, section: number): Promise<string[]> {
  const book = view.book;
  const items = flatten(book.toc);
  const at = tocItem ? items.findIndex((it) => it === tocItem || it.href === tocItem.href) : -1;

  let start = at >= 0 ? await tocSection(book, items[at].href) : null;
  let end: Place | null = null;
  if (start) {
    for (const it of items.slice(at + 1)) {
      const p = await tocSection(book, it.href);
      if (p && (p.index > start.index || (p.index === start.index && p.fragment !== undefined && !same(p.fragment, start.fragment)))) {
        end = p;
        break;
      }
    }
  }
  // The last section the chapter reaches into; the last entry runs to the end of the book.
  let last = end ? (end.fragment !== undefined ? end.index : end.index - 1) : book.sections.length - 1;
  if (!start || section < start.index || section > last) {
    start = { index: section };
    end = null;
    last = section;
  }

  const out: string[] = [];
  for (let i = start.index; i <= last; i++) {
    const s = book.sections[i];
    if (!s?.createDocument || (i !== start.index && s.linear === "no")) continue; // notes and other asides
    const doc = await s.createDocument();
    const range = doc.createRange();
    range.selectNodeContents(doc.body ?? doc.documentElement);
    const from = i === start.index && start.fragment !== undefined ? book.getTOCFragment?.(doc, start.fragment) : null;
    const to = end && i === end.index && end.fragment !== undefined ? book.getTOCFragment?.(doc, end.fragment) : null;
    if (from) range.setStartBefore(from);
    if (to && range.comparePoint(to, 0) === 0) range.setEndBefore(to);
    out.push(...paragraphs(range.cloneContents()));
  }
  return out;
}

export const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Paragraphs grouped into parts of at most about `maxWords` words; an overlong paragraph is cut between words. */
export function splitParts(paras: string[], maxWords: number): string[] {
  const parts: string[] = [];
  let cur: string[] = [];
  let n = 0;
  const flush = () => {
    if (cur.length) parts.push(cur.join("\n\n"));
    cur = [];
    n = 0;
  };
  for (const p of paras) {
    const w = countWords(p);
    if (w > maxWords) {
      flush();
      const words = p.split(/(?<=\s)(?=\S)/); // each word keeps the space after it
      for (let i = 0; i < words.length; i += maxWords) parts.push(words.slice(i, i + maxWords).join("").trim());
      continue;
    }
    if (n + w > maxWords) flush();
    cur.push(p);
    n += w;
  }
  flush();
  return parts;
}
