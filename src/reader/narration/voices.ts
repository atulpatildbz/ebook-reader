// The better-rated English Kokoro voices, best first (grades from the Kokoro model card).
export const KOKORO_VOICES = [
  { id: "af_heart", name: "Heart", accent: "US", gender: "woman", grade: "A" },
  { id: "af_bella", name: "Bella", accent: "US", gender: "woman", grade: "A-" },
  { id: "af_nicole", name: "Nicole", accent: "US", gender: "woman", grade: "B-", note: "soft" },
  { id: "bf_emma", name: "Emma", accent: "UK", gender: "woman", grade: "B-" },
  { id: "am_fenrir", name: "Fenrir", accent: "US", gender: "man", grade: "C+" },
  { id: "am_michael", name: "Michael", accent: "US", gender: "man", grade: "C+" },
  { id: "am_puck", name: "Puck", accent: "US", gender: "man", grade: "C+" },
  { id: "af_aoede", name: "Aoede", accent: "US", gender: "woman", grade: "C+" },
  { id: "af_kore", name: "Kore", accent: "US", gender: "woman", grade: "C+" },
  { id: "af_sarah", name: "Sarah", accent: "US", gender: "woman", grade: "C+" },
  { id: "bm_george", name: "George", accent: "UK", gender: "man", grade: "C" },
  { id: "bm_fable", name: "Fable", accent: "UK", gender: "man", grade: "C" },
] as const satisfies { id: string; name: string; accent: string; gender: string; grade: string; note?: string }[];

export const DEFAULT_VOICE: string = KOKORO_VOICES[0].id;

/** The voice id that means "this device's own voice" rather than a Kokoro voice. */
export const DEVICE_VOICE = "device";
