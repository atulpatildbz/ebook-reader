// The player shown while the book is being read aloud: back/forward a sentence, play/pause,
// speed and voice. Sits in the page's bottom margin; moves up out of the way of the reader's
// footer. How listening stands goes in the top margin (narrationStatus).
import { useEffect, useRef, useState } from "react";
import { duration } from "../../lib/format";
import { ChevronDown, Close, PauseIcon, PlayIcon, SkipBack, SkipForward } from "../../ui/icons";
import type { NarrationState } from "./narrator";
import { REBUFFER_SECONDS } from "./kokoroPlayer";
import { DEVICE_VOICE, KOKORO_VOICES } from "./voices";

const VOICES: [id: string, name: string][] = [
  ...KOKORO_VOICES.map((v): [string, string] => [v.id, `${v.name} (${v.accent}${"note" in v ? `, ${v.note}` : ""})`]),
  [DEVICE_VOICE, "This device's voice"],
];

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];
const MIN_RATE = 0.75;
const MAX_RATE = 3;
const RATE_STEP = 0.05;
/** The nearest speed on offer (and free of floating-point dust like 1.8000000000000003). */
const tidyRate = (r: number) => Number(Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(r / RATE_STEP) * RATE_STEP)).toFixed(2));

/** Gap between the player and the bottom edge of the screen, in px. */
const BOTTOM = 4;

/**
 * One line on how listening stands, for the top margin while listening (it fits there, so the
 * page doesn't have to make room): time left at this speed and how much is made ahead, or what's
 * holding things up.
 */
export function narrationStatus(state: NarrationState, voice: string, rate: number): string {
  const { status, download, engine, error, speed, stalls, ahead, left } = state;
  if (error) return `Narration stopped: ${error}`;
  if (status === "loading" && download?.total) return `Downloading the voice, once: ${Math.round((download.loaded / download.total) * 100)}% of ${Math.round(download.total / 1e6)} MB`;
  const slow = engine === "kokoro" && speed !== null && speed < rate;
  if (status === "loading" && ahead !== null && (stalls > 0 || slow)) {
    // The fastest listed speed this device keeps up with, with a little to spare.
    const ok = speed !== null ? RATES.filter((r) => r <= speed * 0.9).at(-1) : undefined;
    return `Getting ahead: ${duration(ahead.seconds / rate)} of ${REBUFFER_SECONDS} s ready${ok ? ` · no stops at ${ok}×` : ""}`;
  }
  if (status === "loading") return "Starting…";
  const parts: string[] = [];
  if (engine === "device" && voice !== DEVICE_VOICE) parts.push("Device voice (natural voices need WebGPU)");
  if (left !== null) parts.push(`${duration(left / rate)} left in chapter at ${rate}×`);
  if (ahead !== null && engine === "kokoro") parts.push(ahead.complete ? "rest of chapter ready" : `${duration(ahead.seconds / rate)} ready ahead`);
  return parts.join(" · ");
}

export function NarrationBar({
  state,
  voice,
  rate,
  raised,
  onToggle,
  onSkip,
  onFromHere,
  onRate,
  onVoice,
  onClose,
  onRoom,
}: {
  state: NarrationState;
  voice: string;
  rate: number;
  /** The reader's footer is showing: sit above it. */
  raised: boolean;
  onToggle: () => void;
  onSkip: (delta: number) => void;
  /** Text is selected in the book: offer to read from there. */
  onFromHere?: () => void;
  onRate: (rate: number) => void;
  onVoice: (voice: string) => void;
  onClose: () => void;
  /** How far up from the bottom edge the player reaches, in px, whenever that changes, so the page can end above it. */
  onRoom: (px: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const roomRef = useRef(onRoom);
  roomRef.current = onRoom;
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => roomRef.current(el.offsetHeight + BOTTOM));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { status } = state;
  const playing = status === "playing";
  const [speedOpen, setSpeedOpen] = useState(false);

  const pill = "h-8 rounded-full border border-[var(--line)] bg-transparent text-sm text-[var(--fg)]";
  const chevron = "h-4 w-4 text-[var(--muted)]";
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-3 transition-[bottom] duration-200"
      style={{ bottom: `calc(env(safe-area-inset-bottom) + ${raised ? 118 : BOTTOM}px)` }}
    >
      {/* Over the page rather than taking room from it: it's there only for a moment. */}
      {onFromHere && !speedOpen && (
        <button
          onClick={onFromHere}
          className="pointer-events-auto absolute bottom-full mb-2 flex h-9 items-center gap-1.5 rounded-full bg-[var(--ribbon)] px-4 text-sm font-medium text-[var(--on-ribbon)] shadow-lg"
        >
          <PlayIcon />
          Read from here
        </button>
      )}
      {speedOpen && <SpeedPanel rate={rate} onRate={onRate} onClose={() => setSpeedOpen(false)} />}
      <div
        ref={bar}
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
        <button
          onClick={() => setSpeedOpen((o) => !o)}
          aria-label={`Speed, ${rate}×`}
          aria-expanded={speedOpen}
          className={`${pill} ml-1 flex shrink-0 items-center gap-0.5 pr-1.5 pl-3 tabular-nums`}
        >
          {rate}×
          <ChevronDown className={chevron} />
        </button>
        <span className="relative ml-1 min-w-0">
          <select aria-label="Voice" className={`${pill} w-full max-w-[8.5rem] appearance-none truncate pr-6 pl-3`} value={voice} onChange={(e) => onVoice(e.target.value)}>
            {VOICES.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <ChevronDown className={`${chevron} pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2`} />
        </span>
        <Round label="Stop reading aloud" onClick={onClose}>
          <Close />
        </Round>
      </div>
    </div>
  );
}

/** Any speed from 0.75× to 3×, in steps of 0.05: the slider and − + for exact ones, buttons for the usual ones. */
function SpeedPanel({ rate, onRate, onClose }: { rate: number; onRate: (rate: number) => void; onClose: () => void }) {
  const [shown, setShown] = useState(rate);
  const settle = useRef(0);
  useEffect(() => () => window.clearTimeout(settle.current), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Show `r` at once; apply it after `wait` ms (a slider being dragged only applies where it stops). */
  const change = (r: number, wait = 0) => {
    const next = tidyRate(r);
    setShown(next);
    window.clearTimeout(settle.current);
    if (wait) settle.current = window.setTimeout(() => onRate(next), wait);
    else onRate(next);
  };

  return (
    <>
      {/* Tapping away closes it, without turning the page underneath. */}
      <div className="pointer-events-auto fixed inset-0" onClick={onClose} />
      <div role="group" aria-label="Speed" className="pointer-events-auto absolute bottom-full z-10 mb-2 w-[min(17rem,calc(100vw-1.5rem))] rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-lg">
        <div className="flex items-center justify-between">
          <Round label="Slower" onClick={() => change(shown - RATE_STEP)}>
            <span className="text-xl leading-none">−</span>
          </Round>
          <output className="text-2xl font-medium tabular-nums">{shown}×</output>
          <Round label="Faster" onClick={() => change(shown + RATE_STEP)}>
            <span className="text-xl leading-none">+</span>
          </Round>
        </div>
        <input
          type="range"
          aria-label="Speed"
          aria-valuetext={`${shown} times`}
          min={MIN_RATE}
          max={MAX_RATE}
          step={RATE_STEP}
          value={shown}
          onChange={(e) => change(Number(e.target.value), 150)}
          className="my-2 w-full"
        />
        <div className="grid grid-cols-5 gap-1">
          {RATES.map((r) => (
            <button
              key={r}
              onClick={() => change(r)}
              aria-pressed={r === shown}
              className={`h-8 rounded-full text-sm tabular-nums ${r === shown ? "bg-[var(--ribbon)] text-[var(--on-ribbon)]" : "text-[var(--fg)] hover:bg-[var(--line)]"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function Round({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--muted)] hover:text-[var(--fg)]">
      {children}
    </button>
  );
}
