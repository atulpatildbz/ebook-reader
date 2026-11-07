// The player shown while the book is being read aloud: back/forward a sentence, play/pause,
// speed and voice. Floats above the page; moves up out of the way of the reader's footer.
import type { NarrationState } from "../lib/narration/narrator";
import { DEVICE_VOICE } from "../lib/narration/narrator";
import { Close, PauseIcon, PlayIcon, SkipBack, SkipForward } from "./icons";

// The better-rated English voices, best first (grades from the Kokoro model card).
export const VOICES: [id: string, name: string][] = [
  ["af_heart", "Heart (US)"],
  ["af_bella", "Bella (US)"],
  ["af_nicole", "Nicole (US, soft)"],
  ["bf_emma", "Emma (UK)"],
  ["am_fenrir", "Fenrir (US)"],
  ["am_michael", "Michael (US)"],
  ["am_puck", "Puck (US)"],
  ["af_aoede", "Aoede (US)"],
  ["af_kore", "Kore (US)"],
  ["af_sarah", "Sarah (US)"],
  ["bm_george", "George (UK)"],
  ["bm_fable", "Fable (UK)"],
  [DEVICE_VOICE, "This device's voice"],
];

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];

export function NarrationBar({
  state,
  voice,
  rate,
  raised,
  onToggle,
  onSkip,
  onRate,
  onVoice,
  onClose,
}: {
  state: NarrationState;
  voice: string;
  rate: number;
  /** The reader's footer is showing: sit above it. */
  raised: boolean;
  onToggle: () => void;
  onSkip: (delta: number) => void;
  onRate: (rate: number) => void;
  onVoice: (voice: string) => void;
  onClose: () => void;
}) {
  const { status, download, engine, error, speed, stalls } = state;
  const playing = status === "playing";
  let note = "";
  if (status === "loading" && download && download.total) {
    note = `Downloading the voice, once: ${Math.round((download.loaded / download.total) * 100)}% of ${Math.round(download.total / 1e6)} MB`;
  } else if (status === "loading") note = "Starting…";
  else if (engine === "device" && voice !== DEVICE_VOICE) note = "Using this device's voice: natural voices need a browser with WebGPU, and English";
  if (engine === "kokoro" && speed !== null && speed < rate && (stalls > 0 || status === "loading")) {
    // The fastest listed speed this device can keep up with, with a little to spare.
    const ok = RATES.filter((r) => r <= speed * 0.9).at(-1);
    const why = `This device makes speech at ${speed.toFixed(1)}× real time, so at ${rate}× it stops now and then to get ahead.`;
    const fix = ok ? ` ${ok}× or slower plays without stops.` : "";
    note = status === "loading" ? `Getting ahead… ${why}${fix}` : `${why}${fix}`;
  }
  if (error) note = `Narration stopped: ${error}`;

  const select = "h-8 rounded-full border border-[var(--line)] bg-transparent px-2.5 text-sm text-[var(--fg)]";
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-30 flex flex-col items-center gap-2 px-3 transition-[bottom] duration-200"
      style={{ bottom: raised ? "calc(env(safe-area-inset-bottom) + 118px)" : "calc(env(safe-area-inset-bottom) + 4px)" }}
    >
      {note && <p className="pointer-events-auto max-w-md rounded-full bg-[var(--surface)] px-3 py-1 text-center text-xs text-[var(--muted)] shadow">{note}</p>}
      <div
        role="region"
        aria-label="Read aloud"
        className="pointer-events-auto flex max-w-full items-center gap-0.5 rounded-full border border-[var(--line)] bg-[var(--surface)] py-1 pr-1 pl-1.5 shadow-lg"
      >
        <Round label="Back a sentence" onClick={() => onSkip(-1)}>
          <SkipBack />
        </Round>
        <button
          onClick={onToggle}
          aria-label={playing ? "Pause" : "Play"}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--ribbon)] text-[var(--on-ribbon)]"
        >
          {status === "loading" ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <Round label="Forward a sentence" onClick={() => onSkip(1)}>
          <SkipForward />
        </Round>
        <select aria-label="Speed" className={`${select} ml-1 tabular-nums`} value={rate} onChange={(e) => onRate(Number(e.target.value))}>
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
        <select aria-label="Voice" className={`${select} max-w-[8.5rem] min-w-0`} value={voice} onChange={(e) => onVoice(e.target.value)}>
          {VOICES.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <Round label="Stop reading aloud" onClick={onClose}>
          <Close />
        </Round>
      </div>
    </div>
  );
}

function Round({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--muted)] hover:text-[var(--fg)]">
      {children}
    </button>
  );
}
