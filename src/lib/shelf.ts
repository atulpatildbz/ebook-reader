// The last library seen on this device, so it can still be shown, and its downloaded books opened,
// with no connection. Cleared on signing out.
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

type Me = NonNullable<FunctionReturnType<typeof api.books.me>>;
type Book = NonNullable<FunctionReturnType<typeof api.books.list>>[number];
export type Shelf = { me: Me; books: Book[] };

const KEY = "ribbon:shelf";

export function readShelf(): Shelf | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveShelf(shelf: Shelf) {
  try {
    localStorage.setItem(KEY, JSON.stringify(shelf));
  } catch {
    /* storage full or disabled */
  }
}

export function clearShelf() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage disabled */
  }
}
