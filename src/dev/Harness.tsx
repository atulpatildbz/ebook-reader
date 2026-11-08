// Dev-only: open a book from dev-books/ with no sign-in, and fake "another device" moving the
// synced position. Load http://localhost:5173/?harness=quickstart.epub
import { useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { useApplyTheme, useTheme } from "../lib/settings";
import { Reader } from "../reader/Reader";
import type { Remote } from "../reader/position";

export function Harness({ name }: { name: string }) {
  useApplyTheme(useTheme());
  const [remote, setRemote] = useState<Remote | null>(null);
  const book = { title: name, author: "Test", fileName: name, sha256: `dev-${name}`, fileUrl: `/dev-books/${name}` };
  const w = window as unknown as Record<string, unknown>;
  w.harnessSaves ??= [];
  w.harnessRemote = (r: Partial<Remote>) =>
    setRemote({ cfi: "", xpointer: null, fraction: 0.5, chapter: null, device: "other", deviceName: "Android phone (Chrome)", updatedAt: Date.now(), ...r });
  return (
    <Reader
      bookId={`dev-${name}` as Id<"books">}
      book={book}
      remote={remote}
      save={async (p) => {
        (w.harnessSaves as unknown[]).push(p);
        return { saved: true, now: Date.now() };
      }}
    />
  );
}
