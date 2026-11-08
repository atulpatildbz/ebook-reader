import type { Device } from "./kokoro.worker";

/** What a voice engine reports. Only Kokoro sends stats. */
export type Stats = {
  device?: Device;
  dtype?: string;
  loadMs?: number;
  download?: { loaded: number; total: number };
  /** Seconds of audio per second of synthesis: the latest sentence, all of them, and the last two minutes' worth. */
  speed?: { last: number; avg: number; recent: number };
  /** Times playback had to wait for synthesis, and the total wait. */
  stalls: { count: number; seconds: number };
  /**
   * Speech made and waiting to be played, in seconds at normal pace; `complete` once everything
   * to the end of what's being read is made.
   */
  ahead?: { seconds: number; complete: boolean };
  /** Characters of text per second of speech at normal pace, as this voice actually speaks. */
  charsPerSecond?: number;
};

export type Events = {
  onPosition(sentence: number, word: number): void;
  onState(state: "loading" | "playing" | "paused" | "idle"): void;
  onStats(stats: Stats): void;
  onError(message: string): void;
  /** The last sentence finished (not called when stopped). */
  onEnd?(): void;
};

export type Sentence = { text: string; paragraphStart: boolean };

/** What the narrator needs from a voice engine (Kokoro, or the browser's own voices). */
export interface Player {
  events: Events;
  play(sentences: Sentence[], from: number, voice: string, rate: number): void | Promise<void>;
  setRate(rate: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
  dispose(): void;
}
