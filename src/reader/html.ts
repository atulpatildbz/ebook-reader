// Rules about a book's HTML that the page's styles and the text read from it (to copy, narrate or
// search) must agree on.

/** Elements that start a new paragraph when a book's HTML is turned into text. */
const BLOCK_ELEMENTS = new Set(
  "address article aside blockquote dd div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table td th tr ul".split(" "),
);

/** Elements whose content is never part of the text (code, styles, metadata). */
const NOT_TEXT = new Set(["script", "style", "noscript", "template", "head"]);

const EPUB_NS = "http://www.idpf.org/2007/ops";
const NOTE_TYPES = ["endnote", "footnote", "note", "rearnote"];

export const epubType = (el: Element) => (el.getAttributeNS(EPUB_NS, "type") ?? el.getAttribute("epub:type") ?? "").split(/\s+/);

/** Notes placed inline in the chapter. The page hides them (they open as footnotes), so they aren't part of its text. */
const isHiddenNote = (el: Element) => el.localName === "aside" && epubType(el).some((t) => NOTE_TYPES.includes(t));

/** Whether an element's content is left out of the book's text. */
export const notText = (el: Element) => NOT_TEXT.has(el.localName) || isHiddenNote(el);

/** CSS for the page: the `epub:` namespace (first in its stylesheet), then hiding the notes `notText` leaves out. */
export const NAMESPACE_CSS = `@namespace epub "${EPUB_NS}";`;
export const HIDDEN_NOTES_CSS = `${NOTE_TYPES.map((t) => `aside[epub|type~="${t}"]`).join(", ")} { display: none; }`;

/** CSS highlight names narration marks the sentence and word being read with; the page colours them. */
export const NARRATION_HIGHLIGHTS = { sentence: "ribbon-narration-sentence", word: "ribbon-narration-word" };

/**
 * The text under `root` as the page shows it: each text node in order, `block` at the start and
 * end of every block element, `br` at each line break. `skip` leaves out more elements.
 */
export function walkText(root: Node, on: { text(t: Text): void; block(): void; br(): void }, skip?: (el: Element) => boolean) {
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) return on.text(n as Text);
    const el = n.nodeType === Node.ELEMENT_NODE ? (n as Element) : null;
    if (el && (notText(el) || skip?.(el))) return;
    if (el?.localName === "br") return on.br();
    const block = !!el && BLOCK_ELEMENTS.has(el.localName);
    if (block) on.block();
    for (const c of n.childNodes) walk(c);
    if (block) on.block();
  };
  walk(root);
}
