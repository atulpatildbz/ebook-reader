// Checks the app against the behaviour written down in tests/spec/*.json. The spec files are the
// source of truth and don't depend on this code's language; this file only feeds each case to the
// TypeScript implementation. Run with `npm test` (Node 22.18+ reads the .ts files directly).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { splitPieces, wordSpan } from "../src/reader/narration/sentences.ts";
import { alignWords, estimateWords } from "../src/reader/narration/align.ts";
import { stretch } from "../src/reader/narration/stretch.ts";
import { pageKey } from "../src/reader/keys.ts";

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

const estimated = spec("estimate-words");
for (const c of estimated.cases) {
  test(`estimate words: ${c.name}`, () => {
    const parts = c.audio.map((a) => {
      const n = Math.round((a.sound ?? a.silence) * c.sampleRate);
      const x = new Float32Array(n);
      if (a.sound) for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / c.sampleRate);
      return x;
    });
    const samples = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
    parts.reduce((at, p) => (samples.set(p, at), at + p.length), 0);
    const words = estimateWords(c.text, samples, c.sampleRate);
    assert.deepEqual(
      words.map((w) => c.text.slice(w.charStart, w.charEnd)),
      [...c.text.matchAll(/\S+/g)].map((m) => m[0]),
      "one timing per word, in order",
    );
    for (const e of c.expected) {
      const w = words.find((w) => c.text.slice(w.charStart, w.charEnd) === e.word);
      if (e.start !== undefined) near(w.start, e.start, estimated.tolerance, `"${e.word}" start`);
      if (e.end !== undefined) near(w.end, e.end, estimated.tolerance, `"${e.word}" end`);
    }
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

for (const c of spec("page-keys").cases) {
  test(`page keys: ${c.name}`, () => {
    assert.equal(pageKey(c.key, c.shift, c.target, c.panel), c.turn);
  });
}

// The position code's imports leave off ".ts", as the app's bundler allows.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (e) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw e;
    }
  },
});

/** The browser and server around the position code, with time under the test's control. */
function world(serverSetup = {}) {
  const realNow = Date.now;
  let clock = 1_000_000;
  Date.now = () => clock;
  let timers = [];
  let nextTimer = 1;
  const addTimer = (f, ms, every) => (timers.push({ id: nextTimer, f, at: clock + ms, every }), nextTimer++);
  const dropTimer = (id) => (timers = timers.filter((t) => t.id !== id));
  const store = new Map();
  const listeners = { doc: new Map(), win: new Map() };
  const listen = (m) => ({
    addEventListener: (k, f) => m.set(k, [...(m.get(k) ?? []), f]),
    removeEventListener: (k, f) => m.set(k, (m.get(k) ?? []).filter((g) => g !== f)),
  });
  const doc = { visibilityState: "visible", ...listen(listeners.doc) };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  });
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  globalThis.window = {
    setTimeout: (f, ms) => addTimer(f, ms),
    clearTimeout: dropTimer,
    setInterval: (f, ms) => addTimer(f, ms, ms),
    clearInterval: dropTimer,
    ...listen(listeners.win),
  };

  const ahead = serverSetup.aheadBy ?? 0;
  const serverNow = () => clock + ahead;
  const start = serverSetup.position;
  const server = {
    position: start ? { ...start, fraction: 0.5, xpointer: null, chapter: null, deviceName: "Phone", updatedAt: serverNow() - start.age } : null,
    saved: [],
    refused: 0,
    answers: [],
  };
  const save = async (p) => {
    if (server.position && server.position.updatedAt > p.updatedAt) {
      server.refused++;
      return { saved: false, now: serverNow() };
    }
    server.position = { ...p, xpointer: null, chapter: null };
    server.saved.push(p.cfi);
    return { saved: true, now: serverNow() };
  };
  const fresh = () => new Promise((resolve) => server.answers.push(() => resolve(server.position)));
  return {
    server,
    serverNow,
    save,
    fresh,
    store,
    doc,
    fire: (k) => (listeners.doc.get(k) ?? []).forEach((f) => f()),
    pass(ms) {
      const end = clock + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        clock = Math.max(clock, due.at);
        if (due.every) due.at = clock + due.every;
        else dropTimer(due.id);
        due.f();
      }
      clock = end;
    },
    end() {
      Date.now = realNow;
    },
  };
}

const settled = () => new Promise((r) => setImmediate(r));

for (const c of spec("position").cases) {
  test(`position: ${c.name}`, async () => {
    const w = world(c.server);
    try {
      const { Position } = await import("../src/reader/position.ts");
      const position = new Position("book", w.save, w.fresh);
      const view = { isFixedLayout: true, lastLocation: { cfi: "" } };
      let offered = null;
      let stop = () => {};
      const pos = (cfi, updatedAt, device = "phone") => ({ cfi, device, deviceName: "Phone", fraction: 0.5, xpointer: null, chapter: null, updatedAt });
      for (const s of c.steps) {
        if (s.open) {
          if (s.open.local) w.store.set("ribbon:pos:book", JSON.stringify({ fraction: 0.5, ...s.open.local }));
          await position.start(view, s.open.remote && pos(s.open.remote.cfi, s.open.remote.updatedAt, s.open.remote.device));
          stop = position.recheckAfterAway(view, (r) => (offered = r.cfi));
        } else if (s.show) {
          view.lastLocation.cfi = s.show;
          if (position.relocated(view, { cfi: s.show, fraction: 0.5 })) offered = null;
        } else if (s.touch) position.userActed();
        else if (s.wait) w.pass(s.wait);
        else if (s.hide) {
          w.doc.visibilityState = "hidden";
          w.fire("visibilitychange");
        } else if (s.reveal) {
          w.doc.visibilityState = "visible";
          w.fire("visibilitychange");
        } else if (s["other-device-saves"]) w.server.position = pos(s["other-device-saves"], w.serverNow());
        else if (s["server-answers"]) w.server.answers.splice(0).forEach((f) => f());
        else if (s.stay) position.stay();
        await settled();
        w.pass(0);
        await settled();
        if (s.expect) {
          const e = s.expect;
          if (e.saved) assert.deepEqual(w.server.saved, e.saved, "accepted by the server");
          if ("refused" in e) assert.equal(w.server.refused, e.refused, "refused by the server");
          if ("offered" in e) assert.equal(offered, e.offered, "offered to go to");
          if ("local-updated-at" in e) assert.equal(JSON.parse(w.store.get("ribbon:pos:book")).updatedAt, e["local-updated-at"], "time stored on this device");
        }
      }
      stop();
    } finally {
      w.end();
    }
  });
}
