import { useSyncExternalStore } from "react";

// Hash routes (GitHub Pages has no server rewrites): "#/" is the library, "#/read/<bookId>" a book.
type Route = { name: "library" } | { name: "read"; bookId: string };

function parse(): Route {
  const m = location.hash.match(/^#\/read\/([^/?]+)/);
  try {
    return m ? { name: "read", bookId: decodeURIComponent(m[1]) } : { name: "library" };
  } catch {
    return { name: "library" }; // a mangled link
  }
}

let current = parse();
const listeners = new Set<() => void>();
window.addEventListener("hashchange", () => {
  current = parse();
  listeners.forEach((l) => l());
});

export const useRoute = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );

let openedFromLibrary = false;

export function openBook(bookId: string) {
  openedFromLibrary = true;
  location.hash = `#/read/${encodeURIComponent(bookId)}`;
}

/** Back to the library; uses history when the book was opened from it, so Back stays sensible. */
export function openLibrary() {
  if (openedFromLibrary) {
    openedFromLibrary = false;
    history.back();
  } else location.hash = "#/";
}
