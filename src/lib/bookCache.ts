// Downloaded books stay in this browser (IndexedDB, keyed by the file's SHA-256), so reopening
// is instant and a book already opened here reads offline.
import { createStore, get, set, del, keys } from "idb-keyval";

const store = createStore("ribbon-books", "files");

export const getCached = (sha: string) => get<Blob>(sha, store).catch(() => undefined);
export const putCached = (sha: string, blob: Blob) => set(sha, blob, store).catch(() => {});
export const dropCached = (sha: string) => del(sha, store).catch(() => {});

export const cachedHashes = () => keys<string>(store).catch(() => [] as string[]);

export async function sha256(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Ask the browser not to evict cached books under storage pressure (best effort). */
export function persistStorage() {
  navigator.storage?.persist?.().catch(() => {});
}

/** Fetch a book from file storage, reporting download progress (0–1). */
export async function download(url: string, onProgress: (f: number) => void): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    if (total) onProgress(got / total);
  }
  return new Blob(chunks as BlobPart[], { type: res.headers.get("content-type") ?? "" });
}
