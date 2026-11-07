// The text of a laid-out book section, as paragraphs to narrate, with a way back from any stretch
// of that text to a Range in the page (for highlighting it and turning to it).
import { splitPieces, type Piece } from "./sentences";

const BLOCK = new Set(
  "address article aside blockquote dd div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table td th tr ul".split(" "),
);
const SKIP = new Set(["script", "style", "noscript", "template", "head", "rt", "rp", "svg", "math", "nav"]);

/** A table of contents or index laid out as a page: mostly links, not worth reading aloud. */
export function isMostlyLinks(doc: Document): boolean {
  const all = (doc.body?.textContent ?? "").replace(/\s+/g, "").length;
  if (!all) return true;
  let links = 0;
  for (const a of doc.body!.querySelectorAll("a[href]")) links += (a.textContent ?? "").replace(/\s+/g, "").length;
  return links / all > 0.6;
}

/** Footnote markers ("¹", "[12]") aren't read aloud. */
function isNoteRef(el: Element) {
  const type = el.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? el.getAttribute("epub:type") ?? "";
  if (/\bnoteref\b/.test(type) || /\bdoc-noteref\b/.test(el.getAttribute("role") ?? "")) return true;
  return el.localName === "sup" && !!el.querySelector("a") && (el.textContent ?? "").trim().length <= 4;
}

type Paragraph = { text: string; nodes: Text[]; node: number[]; offset: number[] };

export type SectionText = {
  doc: Document;
  pieces: Piece[];
  /** The page Range for characters [from, to) of a piece (the whole piece by default). */
  range(piece: number, from?: number, to?: number): Range;
};

export function sectionText(doc: Document, lang = "en"): SectionText {
  const paragraphs: Paragraph[] = [];
  let cur: Paragraph = { text: "", nodes: [], node: [], offset: [] };
  const flush = () => {
    while (cur.text.endsWith(" ")) {
      cur.text = cur.text.slice(0, -1);
      cur.node.pop();
      cur.offset.pop();
    }
    if (/[\p{L}\p{N}]/u.test(cur.text)) paragraphs.push(cur);
    cur = { text: "", nodes: [], node: [], offset: [] };
  };
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n as Text;
      const data = t.data;
      let idx = -1;
      for (let i = 0; i < data.length; i++) {
        const space = /\s/.test(data[i]);
        if (space && (cur.text === "" || cur.text.endsWith(" "))) continue;
        if (idx < 0) idx = cur.nodes.push(t) - 1;
        cur.text += space ? " " : data[i];
        cur.node.push(idx);
        cur.offset.push(i);
      }
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    if (SKIP.has(el.localName) || isNoteRef(el)) return;
    const block = BLOCK.has(el.localName) || el.localName === "br";
    if (block) flush();
    for (const c of el.childNodes) walk(c);
    if (block) flush();
  };
  if (doc.body) walk(doc.body);
  flush();

  const pieces = splitPieces(paragraphs.map((p) => p.text), lang);
  return {
    doc,
    pieces,
    range(i, from = 0, to?: number) {
      const piece = pieces[i];
      const p = paragraphs[piece.paragraph];
      const s = piece.start + from;
      const e = Math.max(s + 1, piece.start + (to ?? piece.text.length));
      const r = doc.createRange();
      r.setStart(p.nodes[p.node[s]], p.offset[s]);
      r.setEnd(p.nodes[p.node[e - 1]], p.offset[e - 1] + 1);
      return r;
    },
  };
}
