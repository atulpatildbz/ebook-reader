// KOReader XPointers, the way e-readers on KOReader sync (CrossPoint on the Xteink) name a place
// in an EPUB:
//
//   /body/DocFragment[12]/body/div[2]/p[4]/text()[2].17
//
// DocFragment is the spine item (1-based); then elements by tag name and position among same-name
// siblings; then the text run inside the last element and a character offset into it. Following
// CrossPoint, text run k is the text after the element's (k-1)th child element, and offsets count
// Unicode code points.
import type { FoliateView } from "../lib/foliate";

/** Where `range` starts, as an XPointer into spine item `index`. */
export function toXPointer(index: number, range: Range): string | null {
  let node: Node = range.startContainer;
  let offset = range.startOffset;
  if (node.nodeType === Node.ELEMENT_NODE && node.childNodes[offset]) {
    node = node.childNodes[offset];
    offset = 0;
  }
  const doc = node.ownerDocument;
  if (!doc?.body) return null;

  let element: Element | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  let terminal = ".0";
  if (node.nodeType === Node.TEXT_NODE && element) {
    let run = 1;
    let chars = 0;
    for (const sib of element.childNodes) {
      if (sib === node) break;
      if (sib.nodeType === Node.ELEMENT_NODE) (run++, (chars = 0));
      else if (sib.nodeType === Node.TEXT_NODE) chars += codePoints(sib.textContent ?? "");
    }
    chars += codePoints((node.textContent ?? "").slice(0, offset));
    terminal = `/text()${run > 1 ? `[${run}]` : ""}.${chars}`;
  }

  const steps: string[] = [];
  while (element && element !== doc.body && element !== doc.documentElement) {
    const name = element.localName;
    let n = 1;
    for (let s = element.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === name) n++;
    steps.unshift(`${name}[${n}]`);
    element = element.parentElement;
  }
  if (element !== doc.body) return null; // outside <body>: nothing a device could find
  return `/body/DocFragment[${index + 1}]/body${steps.map((s) => `/${s}`).join("")}${steps.length ? terminal : ""}`;
}

const codePoints = (s: string) => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

/** UTF-16 index of the `n`th code point of `s` (or its length). */
function indexOfCodePoint(s: string, n: number) {
  let i = 0;
  for (const ch of s) {
    if (n-- <= 0) return i;
    i += ch.length;
  }
  return s.length;
}

type Parsed = { index: number; steps: { tag: string; n: number }[]; run: number; chars: number };

function parseXPointer(xp: string): Parsed | null {
  const m = xp.match(/^\/body\/DocFragment\[(\d+)\](?:\/body((?:\/[A-Za-z][\w:-]*(?:\[\d+\])?)*)(?:\/text\(\)(?:\[(\d+)\])?)?(?:\.(\d+))?)?$/);
  if (!m) return null;
  const steps = (m[2] ?? "")
    .split("/")
    .filter(Boolean)
    .map((s) => {
      const [, tag, n] = s.match(/^([^[]+)(?:\[(\d+)\])?$/)!;
      return { tag: tag.toLowerCase(), n: n ? Number(n) : 1 };
    });
  return { index: Number(m[1]) - 1, steps, run: m[3] ? Number(m[3]) : 1, chars: m[4] ? Number(m[4]) : 0 };
}

/** The place an XPointer names, in a chapter document. Unresolvable steps stop at the last found. */
function resolveXPointer(doc: Document, p: Parsed): Range {
  const range = doc.createRange();
  let el: Element = doc.body;
  let exact = true;
  for (const { tag, n } of p.steps) {
    const next = [...el.children].filter((c) => c.localName.toLowerCase() === tag)[n - 1];
    if (!next) {
      exact = false;
      break;
    }
    el = next;
  }
  range.setStart(el, 0);
  if (!exact) return range;

  let start: Node | null = el.firstChild;
  for (let seen = 0; start && seen < p.run - 1; start = start.nextSibling) if (start.nodeType === Node.ELEMENT_NODE) seen++;
  if (!start) return range;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  walker.currentNode = start;
  let text: Node | null = start.nodeType === Node.TEXT_NODE ? start : walker.nextNode();
  let left = p.chars;
  while (text) {
    const s = text.textContent ?? "";
    const len = codePoints(s);
    if (left < len || !walker.nextNode()) {
      range.setStart(text, indexOfCodePoint(s, Math.min(left, len)));
      break;
    }
    left -= len;
    text = walker.currentNode;
  }
  return range;
}

/** An XPointer from a device as a CFI for this book, or null if it can't be placed. */
export async function xpointerToCFI(view: FoliateView, xp: string): Promise<string | null> {
  const p = parseXPointer(xp);
  const section = p && view.book.sections[p.index];
  if (!p || !section?.createDocument) return null;
  try {
    const doc = await section.createDocument();
    const range = resolveXPointer(doc, p);
    range.collapse(true);
    return view.getCFI(p.index, range);
  } catch (e) {
    console.warn("Could not place", xp, e);
    return null;
  }
}
