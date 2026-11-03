import type { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { authors, loadFoliate, text } from "./foliate";
import { putCached } from "./bookCache";

export type Format = "epub" | "mobi" | "azw3" | "pdf" | "fb2" | "cbz";

export const ACCEPT = ".epub,.mobi,.azw3,.azw,.prc,.pdf,.fb2,.fbz,.cbz,application/epub+zip,application/pdf,application/x-mobipocket-ebook";

function formatOf(file: File): Format | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "epub") return "epub";
  if (ext === "mobi" || ext === "prc") return "mobi";
  if (ext === "azw3" || ext === "azw") return "azw3";
  if (ext === "pdf") return "pdf";
  if (ext === "fb2" || ext === "fbz") return "fb2";
  if (ext === "cbz") return "cbz";
  if (file.type === "application/epub+zip") return "epub";
  if (file.type === "application/pdf") return "pdf";
  return null;
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

export type ImportResult = { bookId: Id<"books">; duplicate: boolean };

export async function importBook(
  convex: ConvexReactClient,
  file: File,
  onStage: (stage: string, fraction?: number) => void,
): Promise<ImportResult> {
  const format = formatOf(file);
  if (!format) throw new Error("Not a book file. Use EPUB, MOBI, AZW3, PDF, FB2 or CBZ.");

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
