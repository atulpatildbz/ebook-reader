// foliate-js is vendored as plain ES modules in public/foliate-js (it resolves its own workers,
// pdf.js and fonts relative to import.meta.url, so it is served as-is rather than bundled).
// These are the parts of it this app uses.

export type TocItem = { label: string; href: string; subitems?: TocItem[] };

/** One spine item. `linear: "no"` marks notes and other asides; fixed layouts have no document. */
type Section = { id: unknown; linear?: string; createDocument?: () => Promise<Document> };

type FoliateBook = {
  metadata?: { title?: unknown; author?: unknown; language?: unknown };
  toc?: TocItem[];
  dir?: string;
  rendition?: { layout?: string };
  sections: Section[];
  splitTOCHref?: (href: string) => Promise<[unknown, unknown]> | [unknown, unknown];
  getTOCFragment?: (doc: Document, fragment: unknown) => Element | null;
  getCover?: () => Promise<Blob | null> | Blob | null;
  destroy?: () => void;
};

export type RelocateDetail = {
  cfi: string;
  fraction: number;
  location?: { current: number; next: number; total: number };
  section?: { current: number; total: number };
  range?: Range;
  time?: { section: number; total: number };
  tocItem?: { label?: string; href?: string } | null;
  pageItem?: { label?: string } | null;
};

/** Where to go: a CFI or href, a section index, or a fraction of the whole book. */
export type Target = string | number | { fraction: number };

export interface FoliateView extends HTMLElement {
  book: FoliateBook;
  isFixedLayout: boolean;
  lastLocation: RelocateDetail | null;
  renderer: HTMLElement & {
    setStyles?: (css: string | [string, string]) => void;
    /** The sections laid out now (the one on screen first). */
    getContents(): { index: number; doc: Document }[];
    scrollToAnchor(range: Range): Promise<void>;
  };
  open(file: File | Blob): Promise<void>;
  init(opts: { lastLocation?: Target | null; showTextStart?: boolean }): Promise<void>;
  close(): void;
  goTo(target: Target): Promise<unknown>;
  goToFraction(f: number): Promise<void>;
  goLeft(): Promise<void>;
  goRight(): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  getSectionFractions(): number[];
  getCFI(index: number, range: Range): string;
  addAnnotation(a: { value: string }): Promise<unknown>;
  deleteAnnotation(a: { value: string }): Promise<unknown>;
}

/** A module of the vendored foliate-js, e.g. "overlayer.js". */
export function foliateModule<T>(path: string): Promise<T> {
  return import(/* @vite-ignore */ `${import.meta.env.BASE_URL}foliate-js/${path}`) as Promise<T>;
}

let loading: Promise<{ makeBook: (file: File) => Promise<FoliateBook> }> | null = null;

/** Loads foliate-js (and defines <foliate-view>). */
export const loadFoliate = () => (loading ??= foliateModule("view.js"));

/** The section a table-of-contents href points into, and the anchor inside it if any. */
export async function tocSection(book: FoliateBook, href?: string): Promise<{ index: number; fragment?: unknown } | null> {
  if (!href || !book.splitTOCHref) return null;
  try {
    const [id, fragment] = await book.splitTOCHref(href);
    const index = book.sections.findIndex((s) => s.id === id);
    return index < 0 ? null : { index, fragment: fragment ?? undefined };
  } catch {
    return null;
  }
}

/** Title strings in books can be plain strings or language maps ({ en: "…" }). */
export function text(x: unknown): string {
  if (!x) return "";
  if (typeof x === "string") return x;
  if (Array.isArray(x)) return x.map(text).filter(Boolean).join(", ");
  if (typeof x === "object") {
    const o = x as Record<string, unknown>;
    if ("name" in o) return text(o.name);
    return text(Object.values(o)[0]);
  }
  return String(x);
}

const names = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** Authors for display: sort-order names ("Ericsson, Anders") flipped, several joined as a list. */
export function authors(x: unknown): string {
  const list = (Array.isArray(x) ? x : [x]).map(text).filter(Boolean);
  const flip = (n: string) => {
    const parts = n.split(",").map((p) => p.trim());
    return parts.length === 2 && parts[0] && parts[1] && !/\b(jr|sr|ii|iii|phd)\.?$/i.test(parts[1]) ? `${parts[1]} ${parts[0]}` : n;
  };
  return names.format(list.map(flip));
}
