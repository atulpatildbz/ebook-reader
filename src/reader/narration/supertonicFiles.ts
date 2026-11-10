// Supertonic's files, downloaded once and kept on the device. Used by its worker, and by the page
// to fetch the model ahead of time once it's clear this device will need it.

// Pinned: the project is archived, and a moved file shouldn't break narration.
const BASE = "https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/aafc6e32416a594460b32413efc49d7fe4ce6d46";
const CACHE = "supertonic-3";
export const MODELS = ["duration_predictor", "text_encoder", "vector_estimator", "vocoder"] as const;

const url = (path: string) => `${BASE}/${path}`;
const size = (r: Response) => Number(r.headers.get("content-length")) || 0;

/** A file of the model, from the device if it's been fetched before; `progress` gets bytes downloaded so far. */
export async function modelFile(path: string, progress?: (loaded: number) => void): Promise<Response> {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(url(path));
  if (kept) return kept;
  const res = await fetch(url(path));
  if (!res.ok || !res.body) throw new Error(`Could not download the voice (${res.status})`);
  let loaded = 0;
  const body = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) {
        loaded += chunk.byteLength;
        progress?.(loaded);
        c.enqueue(chunk);
      },
    }),
  );
  // Straight into the cache, so a 250 MB file isn't held in memory on the way.
  await cache.put(url(path), new Response(body, { headers: { "content-type": "application/octet-stream", "content-length": String(size(res)) } }));
  return (await cache.match(url(path)))!;
}

/** Bytes of each model file still to download (0 for those already on the device). */
export function sizesToDownload(): Promise<number[]> {
  return Promise.all(
    MODELS.map(async (m) => {
      if (await (await caches.open(CACHE)).match(url(`onnx/${m}.onnx`))) return 0;
      const head = await fetch(url(`onnx/${m}.onnx`), { method: "HEAD" }).catch(() => null);
      return head ? size(head) : 0;
    }),
  );
}

let fetching: Promise<void> | null = null;

/** Download the whole model in the background (once), so switching to it later is quick. */
export function prefetchModel(): Promise<void> {
  fetching ??= (async () => {
    for (const p of ["onnx/tts.json", "onnx/unicode_indexer.json", ...MODELS.map((m) => `onnx/${m}.onnx`)]) await modelFile(p);
  })().catch((e) => {
    fetching = null; // try again next time
    console.warn("Could not fetch the light voice ahead of time", e);
  });
  return fetching;
}
