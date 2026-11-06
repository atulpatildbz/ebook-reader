// The chapter being read as plain text, for copying out of the book: whole, or in parts small
// enough for wherever it's pasted.
import type { FoliateView, TocItem } from "./foliate";

type Section = { id?: unknown; linear?: string; createDocument?: () => Promise<Document> };
type Book = {
  toc?: TocItem[];
  sections: Section[];
  splitTOCHref?: (href: string) => unknown;
  getTOCFragment?: (doc: Document, fragment: unknown) => Element | null;
};
/** A table-of-contents entry resolved to its section and the anchor inside it, if any. */
type Place = { index: number; fragment?: unknown };

const flatten = (items?: TocItem[] | null): TocItem[] => (items ?? []).flatMap((it) => [it, ...flatten(it.subitems)]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function resolve(book: Book, href?: string): Promise<Place | null> {
  if (!href || !book.splitTOCHref) return null;
  try {
    const [id, fragment] = (await book.splitTOCHref(href)) as [unknown, unknown];
    const index = book.sections.findIndex((s) => s.id === id);
    return index < 0 ? null : { index, fragment: fragment ?? undefined };
  } catch {
    return null;
  }
}

const BLOCK = new Set(
  "address article aside blockquote dd div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table td th tr ul".split(" "),
);
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
    if (SKIP.has(name)) return;
    if (name === "br") {
      line += "\n";
      return;
    }
    const block = BLOCK.has(name);
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
  const book = view.book as unknown as Book;
  const items = flatten(book.toc);
  const at = tocItem ? items.findIndex((it) => it === tocItem || it.href === tocItem.href) : -1;

  let start = at >= 0 ? await resolve(book, items[at].href) : null;
  let end: Place | null = null;
  if (start) {
    for (const it of items.slice(at + 1)) {
      const p = await resolve(book, it.href);
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

/** Put text on the clipboard. Must run straight from a tap or click. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  // No Clipboard API outside https (say, the dev server opened over the local network).
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("Copy was blocked");
}
