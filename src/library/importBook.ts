import type { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { putCached } from "../lib/bookCache";
import { authors, loadFoliate, text } from "../lib/foliate";

type Format = Doc<"books">["format"];

/** File extensions and media types of each format the library takes. */
const FORMATS = {
  epub: { exts: ["epub"], types: ["application/epub+zip"] },
  mobi: { exts: ["mobi", "prc"], types: ["application/x-mobipocket-ebook"] },
  azw3: { exts: ["azw3", "azw"], types: [] },
  pdf: { exts: ["pdf"], types: ["application/pdf"] },
  fb2: { exts: ["fb2", "fbz"], types: [] },
  cbz: { exts: ["cbz"], types: [] },
} satisfies Record<Format, { exts: string[]; types: string[] }>;

const entries = Object.entries(FORMATS) as [Format, { exts: string[]; types: string[] }][];

/** For a file picker's `accept`. */
export const ACCEPT = [...entries.flatMap(([, f]) => f.exts.map((e) => `.${e}`)), ...entries.flatMap(([, f]) => f.types)].join(",");

/** "EPUB, MOBI, AZW3, PDF, FB2 or CBZ" */
export const FORMAT_NAMES = new Intl.ListFormat("en", { type: "disjunction" }).format(entries.map(([f]) => f.toUpperCase()));

function formatOf(file: File): Format | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return (entries.find(([, f]) => f.exts.includes(ext)) ?? entries.find(([, f]) => f.types.includes(file.type)))?.[0] ?? null;
}

async function sha256(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A small JPEG of the cover, so the library loads quickly on a phone. */
async function shrinkCover(blob: Blob): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(blob);
    if (bmp.width < 60 || bmp.height < 60) return null; // placeholder images
    const w = Math.min(480, bmp.width);
    const h = Math.round((bmp.height / bmp.width) * w);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  } catch {
    return null;
  }
}

function upload(url: string, blob: Blob, onProgress?: (f: number) => void): Promise<Id<"_storage">> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", blob.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status < 300 ? resolve(JSON.parse(xhr.responseText).storageId) : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload failed: no connection"));
    xhr.send(blob);
  });
}

type ImportResult = { bookId: Id<"books">; duplicate: boolean };

export async function importBook(
  convex: ConvexReactClient,
  file: File,
  onStage: (stage: string, fraction?: number) => void,
): Promise<ImportResult> {
  const format = formatOf(file);
  if (!format) throw new Error(`Not a book file. Use ${FORMAT_NAMES}.`);

  onStage("Reading");
  const sha = await sha256(file);
  const existing = await convex.query(api.books.findBySha, { sha256: sha });
  if (existing) return { bookId: existing, duplicate: true };

  const { makeBook } = await loadFoliate();
  let title = file.name.replace(/\.[^.]+$/, "");
  let author = "";
  let cover: Blob | null = null;
  try {
    const book = await makeBook(file);
    title = text(book.metadata?.title) || title;
    author = authors(book.metadata?.author);
    const raw = await book.getCover?.();
    if (raw) cover = await shrinkCover(raw);
    book.destroy?.();
  } catch (e) {
    console.warn(e);
    throw new Error("This file could not be opened. It may be damaged or DRM-protected.");
  }

  onStage("Uploading", 0);
  const fileId = await upload(await convex.mutation(api.books.uploadUrl, {}), file, (f) => onStage("Uploading", f));
  const coverId = cover ? await upload(await convex.mutation(api.books.uploadUrl, {}), cover).catch(() => undefined) : undefined;
  const bookId = await convex.mutation(api.books.create, {
    fileId,
    coverId,
    title,
    author,
    format,
    fileName: file.name,
    sha256: sha,
  });
  await putCached(sha, file);
  return { bookId, duplicate: false };
}
