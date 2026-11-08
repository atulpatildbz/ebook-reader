// Text into the pieces the narrator speaks one at a time: sentences, with very long ones cut at
// a semicolon or comma so each stays well inside what the voice model takes in one go. Each
// piece keeps where it is in its paragraph, so it can be found again in the book.

export type Piece = {
  text: string;
  paragraph: number;
  paragraphStart: boolean;
  /** Offsets of `text` in its paragraph. */
  start: number;
  end: number;
};

const ABBREV = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|Mt|vs|etc|e\.g|i\.e|No)\.\s*$/i;
const MAX = 280;

/** [start, end) narrowed past whitespace at either end. */
function trim(p: string, s: number, e: number): [number, number] {
  while (s < e && /\s/.test(p[s])) s++;
  while (e > s && /\s/.test(p[e - 1])) e--;
  return [s, e];
}

function cut(p: string, s: number, e: number): [number, number][] {
  if (e - s <= MAX) return [[s, e]];
  const head = p.slice(s, s + MAX);
  let at = Math.max(head.lastIndexOf("; "), head.lastIndexOf(": "));
  if (at < MAX / 3) at = head.lastIndexOf(", ");
  if (at < MAX / 3) at = head.lastIndexOf(" ");
  if (at <= 0) at = MAX - 1;
  return [trim(p, s, s + at + 1), ...cut(p, ...trim(p, s + at + 1, e))];
}

export function splitPieces(paragraphs: string[], lang = "en"): Piece[] {
  const seg = new Intl.Segmenter(lang, { granularity: "sentence" });
  const out: Piece[] = [];
  paragraphs.forEach((p, paragraph) => {
    const sentences: [number, number][] = [];
    for (const { index, segment } of seg.segment(p)) {
      const prev = sentences.at(-1);
      // Rejoin "Mr. Bennet" and the like, which the segmenter may split after the abbreviation.
      if (prev && ABBREV.test(p.slice(prev[0], prev[1]))) prev[1] = index + segment.length;
      else sentences.push([index, index + segment.length]);
    }
    let first = true;
    for (const [s0, e0] of sentences) {
      for (const [s, e] of cut(p, ...trim(p, s0, e0))) {
        if (s >= e) continue;
        out.push({ text: p.slice(s, e), paragraph, paragraphStart: first, start: s, end: e });
        first = false;
      }
    }
  });
  return out;
}
