// Runs Supertonic 3 off the main thread, speaking the same messages as kokoro.worker.ts. A much
// lighter voice than Kokoro (about 5× faster on a Pixel 9, a third of the memory). It doesn't
// say where its words fall, so word timings are estimated from the text and the pauses heard.
//
// Pipeline after supertone-oss-archive/supertonic web/helper.js (MIT); weights OpenRAIL-M.
import * as ort from "onnxruntime-web/webgpu";
import { estimateWords } from "./align";
import type { FromWorker, ToWorker } from "./kokoro.worker";
import { MODELS, modelFile as get, sizesToDownload } from "./supertonicFiles";

// Denoising steps: fewer is faster; 5 is the model card's balance of speed and quality.
const STEPS = 5;

type Style = { ttl: ort.Tensor; dp: ort.Tensor };
type Sessions = Record<(typeof MODELS)[number], ort.InferenceSession>;

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

let s: Sessions | null = null;
let cfg: { ae: { sample_rate: number; base_chunk_size: number }; ttl: { latent_dim: number; chunk_compress_factor: number } };
let indexer: number[] = [];
const styles = new Map<string, Style>();
let queue = Promise.resolve();
let cancelBelow = 0;

async function load(device: "webgpu" | "wasm") {
  const t = performance.now();
  cfg = await (await get("onnx/tts.json")).json();
  indexer = await (await get("onnx/unicode_indexer.json")).json();
  // Sizes for the progress bar (only what's downloaded counts), before the downloads start.
  const sizes = await sizesToDownload();
  const total = sizes.reduce((a, b) => a + b, 0);
  const loaded = sizes.map(() => 0);
  const out: Partial<Sessions> = {};
  for (const [i, m] of MODELS.entries()) {
    const res = await get(`onnx/${m}.onnx`, (n) => {
      loaded[i] = n;
      post({ type: "progress", loaded: loaded.reduce((a, b) => a + b, 0), total });
    });
    out[m] = await ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), {
      executionProviders: [device],
      graphOptimizationLevel: "all",
    });
  }
  s = out as Sessions;
  post({ type: "ready", device, dtype: "fp32", ms: performance.now() - t });
}

async function style(voice: string): Promise<Style> {
  let st = styles.get(voice);
  if (!st) {
    const j = await (await get(`voice_styles/${voice}.json`)).json();
    const t = (x: { data: unknown[]; dims: number[] }) => new ort.Tensor("float32", Float32Array.from(x.data.flat(Infinity) as number[]), x.dims);
    st = { ttl: t(j.style_ttl), dp: t(j.style_dp) };
    styles.set(voice, st);
  }
  return st;
}

/** The text as the model reads it (after the reference implementation's clean-up). */
function prepare(text: string, lang: string): string {
  text = text.normalize("NFKD");
  const swap: Record<string, string> = { "–": "-", "‑": "-", "—": "-", _: " ", "“": '"', "”": '"', "‘": "'", "’": "'", "´": "'", "`": "'", "[": " ", "]": " ", "|": " ", "/": " ", "#": " ", "→": " ", "←": " " };
  for (const [k, v] of Object.entries(swap)) text = text.replaceAll(k, v);
  text = text.replace(/[♥☆♡©\\]/g, "").replaceAll("@", " at ").replaceAll("e.g.,", "for example, ").replaceAll("i.e.,", "that is, ");
  text = text.replace(/ ([,.!?;:'])/g, "$1").replace(/"{2,}/g, '"').replace(/'{2,}/g, "'").replace(/\s+/g, " ").trim();
  if (!/[.!?;:,'")\]}…]$/.test(text)) text += ".";
  return `<${lang}>${text}</${lang}>`;
}

async function speak({ id, text, voice, speed }: Extract<ToWorker, { type: "speak" }>) {
  if (id < cancelBelow) return post({ type: "skipped", id });
  if (!s) throw new Error("Model not loaded");
  const t = performance.now();
  const [lang, name] = voice.includes(":") ? voice.split(":") : ["en", voice];
  const st = await style(name);
  const p = prepare(text, lang);
  const ids = new BigInt64Array(p.length);
  for (let j = 0; j < p.length; j++) {
    const c = p.codePointAt(j)!;
    ids[j] = BigInt(c < indexer.length ? Math.max(0, indexer[c]) : 0);
  }
  const textIds = new ort.Tensor("int64", ids, [1, p.length]);
  const textMask = new ort.Tensor("float32", new Float32Array(p.length).fill(1), [1, 1, p.length]);
  const seconds = ((await s.duration_predictor.run({ text_ids: textIds, style_dp: st.dp, text_mask: textMask })).duration.data as Float32Array)[0] / speed;
  const textEmb = (await s.text_encoder.run({ text_ids: textIds, style_ttl: st.ttl, text_mask: textMask })).text_emb;

  const sampleRate = cfg.ae.sample_rate;
  const chunk = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
  const dim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
  const length = Math.floor(seconds * sampleRate);
  const frames = Math.max(1, Math.ceil(length / chunk));
  let x = new Float32Array(dim * frames);
  for (let i = 0; i < x.length; i++) {
    x[i] = Math.sqrt(-2 * Math.log(Math.max(1e-4, Math.random()))) * Math.cos(2 * Math.PI * Math.random());
  }
  const latentMask = new ort.Tensor("float32", new Float32Array(frames).fill(1), [1, 1, frames]);
  const total = new ort.Tensor("float32", new Float32Array([STEPS]), [1]);
  for (let k = 0; k < STEPS; k++) {
    const out = await s.vector_estimator.run({
      noisy_latent: new ort.Tensor("float32", x, [1, dim, frames]),
      text_emb: textEmb,
      style_ttl: st.ttl,
      latent_mask: latentMask,
      text_mask: textMask,
      current_step: new ort.Tensor("float32", new Float32Array([k]), [1]),
      total_step: total,
    });
    x = new Float32Array(out.denoised_latent.data as Float32Array);
  }
  const wav = (await s.vocoder.run({ latent: new ort.Tensor("float32", x, [1, dim, frames]) })).wav_tts.data as Float32Array;
  const samples = wav.slice(0, Math.min(length, wav.length));
  const words = estimateWords(text, samples, sampleRate);
  post({ type: "audio", id, samples, sampleRate, words, genMs: performance.now() - t }, [samples.buffer]);
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    cancelBelow = msg.below;
    return;
  }
  queue = queue
    .then(() => (msg.type === "load" ? load(msg.device) : speak(msg)))
    .catch((err) => post({ type: "error", id: msg.type === "speak" ? msg.id : undefined, message: String(err?.message ?? err) }));
};
