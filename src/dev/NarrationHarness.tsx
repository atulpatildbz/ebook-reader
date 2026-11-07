// Dev-only: try narration voices on any text, with sentence and word highlighting.
// http://localhost:5173/?harness=narration
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApplyTheme, useTheme } from "../lib/settings";
import { KokoroPlayer, type Stats } from "../lib/narration/kokoroPlayer";
import { BrowserPlayer } from "../lib/narration/browserPlayer";
import { splitPieces, type Piece } from "../lib/narration/sentences";

const SAMPLE = `It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.

However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.

"My dear Mr. Bennet," said his lady to him one day, "have you heard that Netherfield Park is let at last?"

Mr. Bennet replied that he had not.

"But it is," returned she; "for Mrs. Long has just been here, and she told me all about it."

Mr. Bennet made no answer.

"Do you not want to know who has taken it?" cried his wife impatiently.

"You want to tell me, and I have no objection to hearing it."

This was invitation enough.

"Why, my dear, you must know, Mrs. Long says that Netherfield is taken by a young man of large fortune from the north of England; that he came down on Monday in a chaise and four to see the place, and was so much delighted with it, that he agreed with Mr. Morris immediately; that he is to take possession before Michaelmas, and some of his servants are to be in the house by the end of next week."

"What is his name?"

"Bingley."

"Is he married or single?"

"Oh! Single, my dear, to be sure! A single man of large fortune; four or five thousand a year. What a fine thing for our girls!"`;

// The better-rated English voices, best first (grades from the Kokoro model card).
const KOKORO_VOICES = [
  ["af_heart", "Heart · US woman · A"],
  ["af_bella", "Bella · US woman · A-"],
  ["af_nicole", "Nicole · US woman, soft · B-"],
  ["bf_emma", "Emma · UK woman · B-"],
  ["am_fenrir", "Fenrir · US man · C+"],
  ["am_michael", "Michael · US man · C+"],
  ["am_puck", "Puck · US man · C+"],
  ["af_aoede", "Aoede · US woman · C+"],
  ["af_kore", "Kore · US woman · C+"],
  ["af_sarah", "Sarah · US woman · C+"],
  ["bm_george", "George · UK man · C"],
  ["bm_fable", "Fable · UK man · C"],
] as const;

type Engine = "webgpu" | "wasm" | "browser";
type State = "loading" | "playing" | "paused" | "idle";

const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;

export function NarrationHarness() {
  useApplyTheme(useTheme());
  const [text, setText] = useState(SAMPLE);
  const [editing, setEditing] = useState(false);
  const [engine, setEngine] = useState<Engine>(hasWebGPU ? "webgpu" : "wasm");
  const [voice, setVoice] = useState<string>("af_heart");
  const [browserVoice, setBrowserVoice] = useState("");
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [rate, setRate] = useState(1);
  const [state, setState] = useState<State>("idle");
  const [pos, setPos] = useState({ sentence: -1, word: -1 });
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pieces = useMemo(
    () =>
      splitPieces(
        text
          .split(/\n+/)
          .map((p) => p.trim())
          .filter(Boolean),
      ),
    [text],
  );
  const paragraphs = useMemo(() => {
    const out: { piece: Piece; index: number }[][] = [];
    pieces.forEach((piece, index) => (out[piece.paragraph] ??= []).push({ piece, index }));
    return out;
  }, [pieces]);

  // One player per engine, kept so the Kokoro model loads only once.
  const players = useRef(new Map<Engine, KokoroPlayer | BrowserPlayer>());
  const events = useMemo(
    () => ({
      onPosition: (sentence: number, word: number) => setPos({ sentence, word }),
      onState: (s: State) => {
        setState(s);
        if (s === "idle") setPos({ sentence: -1, word: -1 });
      },
      onStats: setStats,
      onError: setError,
    }),
    [],
  );
  const player = (e: Engine) => {
    let p = players.current.get(e);
    if (!p) players.current.set(e, (p = e === "browser" ? new BrowserPlayer(events) : new KokoroPlayer(e, events)));
    return p;
  };
  useEffect(() => () => players.current.forEach((p) => p.dispose()), []);

  useEffect(() => {
    const load = () => {
      const vs = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
      setBrowserVoices(vs);
      setBrowserVoice((cur) => cur || (vs.find((v) => v.default) ?? vs[0])?.voiceURI || "");
    };
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const stopAll = () => {
    players.current.forEach((p) => p.stop());
    setState("idle");
    setPos({ sentence: -1, word: -1 });
  };

  const playFrom = (from: number) => {
    setError(null);
    players.current.forEach((p, e) => e !== engine && p.stop());
    const p = player(engine);
    if (p instanceof BrowserPlayer) p.play(pieces, from, browserVoice, rate);
    else void p.play(pieces, from, voice, rate);
  };

  const toggle = () => {
    const p = player(engine);
    if (state === "playing") p.pause();
    else if (state === "paused") p.resume();
    else playFrom(Math.max(0, pos.sentence));
  };

  // Changing voice, speed or engine mid-listen restarts at the current sentence.
  const restartRef = useRef(playFrom);
  restartRef.current = playFrom;
  const pick = useCallback((i: number) => restartRef.current(i), []);
  const posRef = useRef(pos);
  posRef.current = pos;
  useEffect(() => {
    if (state === "playing" || state === "paused") restartRef.current(Math.max(0, posRef.current.sentence));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, voice, browserVoice]);

  // Kokoro changes speed on the fly; the built-in voice has to restart the sentence.
  useEffect(() => {
    const p = players.current.get(engine);
    if (p instanceof KokoroPlayer) p.setRate(rate);
    else if (p && (state === "playing" || state === "paused")) restartRef.current(Math.max(0, posRef.current.sentence));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate]);

  const current = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [pos.sentence]);

  const label = "text-xs font-medium tracking-wide text-[var(--muted)] uppercase";
  const field = "w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2";

  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 pb-40">
      <h1 className="font-serif text-2xl font-medium">Narration test</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Kokoro runs on this device; the first play downloads the voice model once. Tap any sentence to start there.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <label className="space-y-1">
          <span className={label}>Engine</span>
          <select className={field} value={engine} onChange={(e) => setEngine(e.target.value as Engine)}>
            <option value="webgpu" disabled={!hasWebGPU}>
              Kokoro · GPU{hasWebGPU ? "" : " (not available)"}
            </option>
            <option value="wasm">Kokoro · CPU</option>
            <option value="browser">Built-in voice</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className={label}>Voice</span>
          {engine === "browser" ? (
            <select className={field} value={browserVoice} onChange={(e) => setBrowserVoice(e.target.value)}>
              {browserVoices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang}){v.localService ? "" : " · online"}
                </option>
              ))}
            </select>
          ) : (
            <select className={field} value={voice} onChange={(e) => setVoice(e.target.value)}>
              {KOKORO_VOICES.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="space-y-1">
          <span className={label}>Speed · {rate.toFixed(2)}×</span>
          <input className="block w-full py-2.5" type="range" min={0.75} max={3} step={0.05} value={rate} onChange={(e) => setRate(+e.target.value)} />
        </label>
      </div>

      <StatsLine engine={engine} stats={stats} state={state} />
      {error && <p className="mt-2 text-sm text-[var(--ribbon)]">Error: {error}</p>}

      <div className="mt-6 flex items-center justify-between">
        <span className={label}>Text</span>
        <button
          className="text-sm text-[var(--link)]"
          onClick={() => {
            stopAll();
            setEditing(!editing);
          }}
        >
          {editing ? "Done" : "Paste your own text"}
        </button>
      </div>
      {editing ? (
        <textarea
          className={`${field} mt-2 h-[60dvh] font-serif leading-relaxed`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste a chapter here (in a book: chapter menu → Copy chapter)."
        />
      ) : (
        <div className="mt-2 space-y-4 font-serif text-lg leading-relaxed">
          {paragraphs.map((ps, i) => (
            <p key={i}>
              {ps.map(({ piece, index }) => (
                <Sentence
                  key={index}
                  text={piece.text}
                  word={pos.sentence === index ? pos.word : null}
                  spanRef={pos.sentence === index ? current : undefined}
                  index={index}
                  onPick={pick}
                />
              ))}
            </p>
          ))}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-[var(--line)] bg-[var(--surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <button
            onClick={toggle}
            disabled={editing || !pieces.length}
            className="h-12 min-w-28 rounded-full bg-[var(--ribbon)] px-5 font-medium text-[var(--on-ribbon)] disabled:opacity-40"
          >
            {state === "playing" ? "Pause" : state === "paused" ? "Resume" : state === "loading" ? "Loading…" : "Play"}
          </button>
          <button onClick={stopAll} disabled={state === "idle"} className="h-12 rounded-full border border-[var(--line)] px-5 disabled:opacity-40">
            Stop
          </button>
          <span className="ml-auto text-sm text-[var(--muted)] tabular-nums">
            {pos.sentence >= 0 ? `Sentence ${pos.sentence + 1} of ${pieces.length}` : `${pieces.length} sentences`}
          </span>
        </div>
      </div>
    </div>
  );
}

const Sentence = memo(function Sentence({
  text,
  word,
  spanRef,
  index,
  onPick,
}: {
  text: string;
  word: number | null;
  spanRef?: React.Ref<HTMLSpanElement>;
  index: number;
  onPick: (index: number) => void;
}) {
  const active = word !== null;
  const parts = useMemo(() => text.split(/(\s+)/), [text]);
  let w = -1;
  return (
    <>
      <span
        ref={spanRef}
        onClick={() => onPick(index)}
        className={`cursor-pointer rounded transition-colors ${active ? "bg-[color-mix(in_srgb,var(--ribbon)_12%,transparent)]" : "hover:bg-[var(--line)]/50"}`}
      >
        {active
          ? parts.map((p, i) => {
              if (/^\s+$/.test(p) || !p) return p;
              w++;
              return (
                <span key={i} className={w === word ? "rounded bg-[color-mix(in_srgb,var(--ribbon)_30%,transparent)]" : undefined}>
                  {p}
                </span>
              );
            })
          : text}
      </span>{" "}
    </>
  );
});

function StatsLine({ engine, stats, state }: { engine: Engine; stats: Stats | null; state: State }) {
  if (engine === "browser" || !stats) return null;
  const mb = (n: number) => (n / 1e6).toFixed(0);
  const bits: string[] = [];
  if (stats.loadMs === undefined && stats.download && state === "loading") {
    bits.push(`Downloading voice model ${mb(stats.download.loaded)} / ${mb(stats.download.total)} MB`);
  }
  if (stats.loadMs !== undefined) bits.push(`${stats.device === "webgpu" ? "GPU" : "CPU"} · ${stats.dtype} · ready in ${(stats.loadMs / 1000).toFixed(1)} s`);
  if (stats.speed) bits.push(`makes speech ${stats.speed.avg.toFixed(1)}× faster than real time, so keeps up with listening up to ~${stats.speed.avg.toFixed(1)}×`);
  if (stats.stalls.count) bits.push(`waited ${stats.stalls.count}× for ${stats.stalls.seconds.toFixed(1)} s`);
  return <p className="mt-4 text-sm text-[var(--muted)] tabular-nums">{bits.join(" · ")}</p>;
}
