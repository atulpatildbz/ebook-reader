// Checks the app against the behaviour written down in tests/spec/*.json. The spec files are the
// source of truth and don't depend on this code's language; this file only feeds each case to the
// TypeScript implementation. Run with `npm test` (Node 22.18+ reads the .ts files directly).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitPieces, wordSpan } from "../src/reader/narration/sentences.ts";
import { alignWords } from "../src/reader/narration/align.ts";
import { stretch } from "../src/reader/narration/stretch.ts";

const spec = (name) => JSON.parse(readFileSync(new URL(`./spec/${name}.json`, import.meta.url), "utf8"));
const near = (actual, expected, tol, what) => assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} is not within ${tol} of ${expected}`);

for (const c of spec("sentences").cases) {
  test(`sentences: ${c.name}`, () => {
    const pieces = splitPieces(c.paragraphs, c.lang).map(({ text, paragraph, paragraphStart, start, end }) => ({ text, paragraph, paragraphStart, start, end }));
    assert.deepEqual(pieces, c.pieces);
  });
}

for (const c of spec("word-span").cases) {
  test(`word span: ${c.name}`, () => {
    assert.deepEqual(
      c.spans.map((_, i) => wordSpan(c.text, i)),
      c.spans,
    );
  });
}

const align = spec("align");
for (const c of align.cases) {
  test(`align: ${c.name}`, () => {
    const words = alignWords(c.text, c.phonemes, c.durations, c.seconds);
    assert.deepEqual(
      words.map((w) => c.text.slice(w.charStart, w.charEnd)),
      c.words.map((w) => w.word),
      "one timing per word, in order",
    );
    words.forEach((w, i) => {
      const e = c.words[i];
      near(w.start, e.start, align.tolerance, `"${e.word}" start`);
      near(w.end, e.end, align.tolerance, `"${e.word}" end`);
    });
  });
}

/** The test tone a stretch case describes. */
function tone({ sampleRate, seconds, f0, harmonics, swellHz }) {
  const x = new Float32Array(Math.round(sampleRate * seconds));
  const norm = harmonics.reduce((a, b) => a + b, 0);
  for (let i = 0; i < x.length; i++) {
    const t = i / sampleRate;
    let v = 0;
    harmonics.forEach((a, h) => (v += a * Math.sin(2 * Math.PI * f0 * (h + 1) * t)));
    x[i] = ((0.5 + 0.4 * Math.sin(2 * Math.PI * swellHz * t)) * v) / norm;
  }
  return x;
}

const maxJump = (a) => {
  let m = 0;
  for (let i = 1; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - a[i - 1]));
  return m;
};

const st = spec("stretch");
for (const c of st.cases) {
  test(`stretch: ${c.name}`, () => {
    const { sampleRate, seconds, f0 } = c.signal;
    const x = tone(c.signal);
    const t0 = performance.now();
    const y = stretch(x, c.factor, sampleRate);
    const ms = performance.now() - t0;
    near(y.length / x.length, 1 / c.factor, st.tolerance.lengthRatio, "length ratio");
    const mid = y.subarray(Math.round(sampleRate * 0.2), y.length - Math.round(sampleRate * 0.2));
    let rising = 0;
    for (let i = 1; i < mid.length; i++) if (mid[i - 1] < 0 && mid[i] >= 0) rising++;
    near(rising / (mid.length / sampleRate), f0, f0 * st.tolerance.pitchHz, "pitch (Hz)");
    assert.ok(maxJump(mid) <= maxJump(x) * st.tolerance.jump, `largest jump ${maxJump(mid).toFixed(4)} is over ${st.tolerance.jump}× the input's ${maxJump(x).toFixed(4)}: clicks`);
    assert.ok(ms <= st.maxMillisecondsPerSecondOfInput * seconds, `took ${ms.toFixed(0)} ms for ${seconds} s`);
  });
}
