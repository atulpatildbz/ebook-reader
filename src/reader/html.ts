// Rules about a book's HTML that the page's styles and the text read from it (to copy or narrate)
// must agree on.

/** Elements that start a new paragraph when a book's HTML is turned into text. */
export const BLOCK_ELEMENTS = new Set(
  "address article aside blockquote dd div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table td th tr ul".split(" "),
);

const EPUB_NS = "http://www.idpf.org/2007/ops";
const NOTE_TYPES = ["endnote", "footnote", "note", "rearnote"];

export const epubType = (el: Element) => (el.getAttributeNS(EPUB_NS, "type") ?? el.getAttribute("epub:type") ?? "").split(/\s+/);

/** Notes placed inline in the chapter. The page hides them (they open as footnotes), so they aren't part of its text. */
export const isHiddenNote = (el: Element) => el.localName === "aside" && epubType(el).some((t) => NOTE_TYPES.includes(t));

/** The same rule as CSS, for the page. Needs `@namespace epub "http://www.idpf.org/2007/ops"`. */
export const HIDDEN_NOTES_CSS = `${NOTE_TYPES.map((t) => `aside[epub|type~="${t}"]`).join(", ")} { display: none; }`;
