// The last library seen on this device, so it can still be shown, and its downloaded books opened,
// with no connection. Cleared on signing out.
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { readStored, removeStored, writeStored } from "./storage";

export type Me = NonNullable<FunctionReturnType<typeof api.books.me>>;
export type Book = NonNullable<FunctionReturnType<typeof api.books.list>>[number];
export type Shelf = { me: Me; books: Book[] };

const KEY = "ribbon:shelf";

export const readShelf = () => readStored<Shelf>(KEY);
export const saveShelf = (shelf: Shelf) => writeStored(KEY, shelf);
export const clearShelf = () => removeStored(KEY);
