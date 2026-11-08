import { ConvexError } from "convex/values";

/** Something a person can read, from whatever went wrong talking to the server. */
export function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) return String(e.data);
  const m = e instanceof Error ? e.message : String(e);
  return /Server Error|Request ID|\[CONVEX|Uncaught/i.test(m) ? "Something went wrong on the server. Try again." : m;
}
