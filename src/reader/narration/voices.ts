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

// Supertonic 3's voices: about 5× lighter to run than Kokoro, for phones that can't keep up with it.
export const SUPERTONIC_VOICES = [
  { id: "st:F1", name: "F1", gender: "woman" },
  { id: "st:F2", name: "F2", gender: "woman" },
  { id: "st:F3", name: "F3", gender: "woman" },
  { id: "st:F4", name: "F4", gender: "woman" },
  { id: "st:F5", name: "F5", gender: "woman" },
  { id: "st:M1", name: "M1", gender: "man" },
  { id: "st:M2", name: "M2", gender: "man" },
  { id: "st:M3", name: "M3", gender: "man" },
  { id: "st:M4", name: "M4", gender: "man" },
  { id: "st:M5", name: "M5", gender: "man" },
] as const;

export type Engine = "kokoro" | "supertonic";
export const engineOf = (voice: string): Engine => (voice.startsWith("st:") ? "supertonic" : "kokoro");

/** The most natural voice: what's read in whenever this device keeps up with it. */
export const BEST_VOICE: string = KOKORO_VOICES[0].id;
/** What's read in instead on a device that doesn't. */
export const LIGHT_VOICE: string = SUPERTONIC_VOICES[0].id;

/** The voice id that means "the best voice this device keeps up with at the speed listened at". */
export const AUTO_VOICE = "auto";
export const DEFAULT_VOICE: string = AUTO_VOICE;

/** The voice id that means "this device's own voice" rather than a Kokoro voice. */
export const DEVICE_VOICE = "device";
