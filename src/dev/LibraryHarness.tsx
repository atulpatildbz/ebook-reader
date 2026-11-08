// Dev-only: the library with made-up books (no sign-in). http://localhost:5173/?harness=library
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { LibraryView, type Book } from "../library/Library";
import { useApplyTheme, useTheme } from "../lib/settings";

const hour = 3600_000;
const books = [
  ["Dune", "Frank Herbert", 0.16, 2, "Book One: Dune"],
  ["A Gentleman in Moscow", "Amor Towles", 0.62, 30, "1923: An Appointment"],
  ["Peak", "Anders Ericsson", 0.05, 80, "The Power of Purposeful Practice"],
  ["100 Go Mistakes and How to Avoid Them", "Teiva Harsanyi", 0.1, 200, "2.5 #5: Interface pollution"],
  ["The Book of Chuang Tzu", "Chuang Tzu", null, 0, null],
  ["Endurance: Shackleton’s Incredible Voyage", "Alfred Lansing", 1, 900, "Epilogue"],
  ["Digital Minimalism", "Cal Newport", null, 0, null],
].map(([title, author, f, ago, chapter], i) => ({
  _id: `b${i}`,
  title,
  author,
  format: "epub",
  size: 2_400_000,
  sha256: ((i * 2654435761) >>> 0).toString(16).padStart(8, "0").split("").reverse().join("") + "0".repeat(56),
  addedAt: Date.now() - 1000 * hour - i,
  coverUrl: null,
  progress: f === null ? null : { fraction: f, chapter, updatedAt: Date.now() - (ago as number) * hour, deviceName: i % 2 ? "Android phone (Chrome)" : "Mac (Chrome)" },
})) as unknown as Book[];

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

export function LibraryHarness({ empty }: { empty?: boolean }) {
  useApplyTheme(useTheme());
  return (
    <ConvexAuthProvider client={convex} shouldHandleCode={false}>
      <LibraryView me={{ email: "reader@example.com", name: "Reader", image: null }} books={empty ? [] : books} />
    </ConvexAuthProvider>
  );
}
