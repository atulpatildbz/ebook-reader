// Runs Kokoro off the main thread: loads the model once, then turns sentences into audio with
// word timings, one at a time (the model can't run two at once).
import { KokoroTTS } from "kokoro-js";
import { alignWords, type WordTiming } from "./align";

// The "timestamped" export also returns how long each phoneme lasts, which gives word timings.
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped";

export type Device = "webgpu" | "wasm";
export type Dtype = "fp32" | "fp16" | "q8";
export type ToWorker =
  | { type: "load"; device: Device; dtype?: Dtype }
  | { type: "speak"; id: number; text: string; voice: string; speed: number }
  /** Drop queued sentences with an id below this; they were for playback that's been stopped. */
  | { type: "cancel"; below: number };
export type FromWorker =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; device: Device; dtype: string; ms: number }
  | { type: "audio"; id: number; samples: Float32Array; sampleRate: number; words: WordTiming[]; genMs: number }
  /** A cancelled sentence, dropped without being made. */
  | { type: "skipped"; id: number }
  | { type: "error"; id?: number; message: string };

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

type Tensor = { data: ArrayLike<number | bigint> };
let tts: KokoroTTS | null = null;
let last: { ids: Tensor; durations: Tensor } | null = null;
let queue = Promise.resolve();
let cancelBelow = 0;

async function load(device: Device, wanted?: Dtype) {
  const t = performance.now();
  // fp32 on the GPU (the quantized models are slow or wrong there); 8-bit on the CPU.
  const dtype = wanted ?? (device === "webgpu" ? "fp32" : "q8");
  const files = new Map<string, { loaded: number; total: number }>();
  tts = await KokoroTTS.from_pretrained(MODEL, {
    dtype,
    device,
    progress_callback: (p) => {
      if (p.status !== "progress") return;
      files.set(p.file, { loaded: p.loaded, total: p.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) (loaded += f.loaded), (total += f.total);
      post({ type: "progress", loaded, total });
    },
  });
  // kokoro-js keeps only the waveform; catch the inputs and durations on the way past.
  const model = tts.model as unknown as (i: Record<string, Tensor>) => Promise<Record<string, Tensor>>;
  (tts as unknown as { model: typeof model }).model = async (inputs) => {
    const out = await model(inputs);
    last = { ids: inputs.input_ids, durations: out.durations };
    return out;
  };
  post({ type: "ready", device, dtype, ms: performance.now() - t });
}

async function speak({ id, text, voice, speed }: Extract<ToWorker, { type: "speak" }>) {
  if (id < cancelBelow) return post({ type: "skipped", id });
  if (!tts) throw new Error("Model not loaded");
  const t = performance.now();
  const audio = await tts.generate(text, { voice: voice as never, speed });
  const samples = audio.audio as Float32Array;
  let words: WordTiming[] = [];
  if (last) {
    const phonemes = Array.from(last.ids.data, (x) => tts!.tokenizer.decode([Number(x)]));
    words = alignWords(text, phonemes, Array.from(last.durations.data, Number), samples.length / audio.sampling_rate);
  }
  post({ type: "audio", id, samples, sampleRate: audio.sampling_rate, words, genMs: performance.now() - t }, [samples.buffer]);
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    cancelBelow = msg.below;
    return;
  }
  queue = queue
    .then(() => (msg.type === "load" ? load(msg.device, msg.dtype) : speak(msg)))
    .catch((err) => post({ type: "error", id: msg.type === "speak" ? msg.id : undefined, message: String(err?.message ?? err) }));
};
