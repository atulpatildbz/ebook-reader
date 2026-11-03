// foliate-js is vendored as plain ES modules in public/foliate-js (it resolves its own workers,
// pdf.js and fonts relative to import.meta.url, so it is served as-is rather than bundled).

export type TocItem = { label: string; href: string; subitems?: TocItem[] };

export type FoliateBook = {
  metadata?: { title?: unknown; author?: unknown; language?: unknown };
  toc?: TocItem[];
  dir?: string;
  rendition?: { layout?: string };
  sections: unknown[];
  getCover?: () => Promise<Blob | null> | Blob | null;
  destroy?: () => void;
};

export type RelocateDetail = {
  cfi: string;
  fraction: number;
  location?: { current: number; next: number; total: number };
  section?: { current: number; total: number };
  time?: { section: number; total: number };
  tocItem?: { label?: string; href?: string } | null;
  pageItem?: { label?: string } | null;
};

export interface FoliateView extends HTMLElement {
  book: FoliateBook;
  isFixedLayout: boolean;
  lastLocation: RelocateDetail | null;
  renderer: HTMLElement & {
    setStyles?: (css: string | [string, string]) => void;
    next: () => Promise<void>;
    prev: () => Promise<void>;
  };
  open(file: File | Blob): Promise<void>;
  init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
  close(): void;
  goTo(target: string | number): Promise<unknown>;
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

type ViewModule = { makeBook: (file: File) => Promise<FoliateBook> };

let loading: Promise<ViewModule> | null = null;

export function loadFoliate(): Promise<ViewModule> {
  const url = `${import.meta.env.BASE_URL}foliate-js/view.js`;
  return (loading ??= import(/* @vite-ignore */ url) as Promise<ViewModule>);
}

/** Title strings in books can be plain strings or language maps ({ en: "…" }). */
export function text(x: unknown): string {
  if (!x) return "";
  if (typeof x === "string") return x;
  if (Array.isArray(x)) return x.map(text).filter(Boolean).join(", ");
  if (typeof x === "object") {
    const o = x as Record<string, unknown>;
    if ("name" in o) return text(o.name);
    const first = Object.values(o)[0];
    return text(first);
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
