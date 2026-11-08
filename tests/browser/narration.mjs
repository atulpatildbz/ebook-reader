// Checks narration from outside, in a real browser with a GPU: plays the narration test page
// (?harness=narration) and watches only what the page and the browser show, not the code behind
// them, so the same checks apply to any implementation of that page.
//
//   npm run test:browser                 build, then check the production bundle
//   npm run test:browser -- --minutes 5  play for longer (default 2.5)
//   CHROME=/path/to/chrome npm run test:browser
//
// Checks:
//   memory   with the voice loaded, Chrome's processes stay under a limit; playing on doesn't
//            grow them; a reload gives the memory back
//   gaps     sentences are queued back to back on the audio clock (no restart between them)
//   words    the word highlight keeps moving all the way through, past tricky text
//   resume   play after pause carries on at once, without making speech again
//
// Needs a GPU (WebGPU) and downloads the voice model (326 MB) once, into tests/browser/.profile.
// Runs on macOS; elsewhere memory is read from ps.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const profile = join(root, "tests/browser/.profile");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const MINUTES = Number(arg("minutes", 2.5));
const RATE = 3;
const PORT = 4174;
const DEBUG_PORT = 9334;
const LIMITS = {
  memoryMB: Number(arg("memory-limit", 4500)), // voice loaded and playing; about 3 GB on an M-series Mac
  growth: 0.15, // while playing, after the first minute
  reloadMB: 900, // after a reload, back near an empty page
  gapSeconds: 0.02, // between sentences in a paragraph
  paragraphGapSeconds: 0.35 / RATE + 0.02, // the pause before a paragraph, at this speed
  wordStallSeconds: 3, // longest the word highlight may sit still while playing
  resumeSeconds: 1.5, // from play after pause to the highlight moving again
};

// Text with the cases that have tripped narration up, as a few paragraphs, repeated.
const PASSAGE = `Well, yes, but ... He left. I waited... and waited.
“Is that it?” I asked — and she laughed. It cost 1,500 rupees in 1997.
To be or not to be, that is the question. Mr. Bennet replied that he had not.
Dr. Smith's well-known theory, e.g. the third one, failed. Rama and Lakshmana crossed the Sarayu at dawn; the boatman was asleep, and the water was black and still.`;
const TEXT = Array.from({ length: 40 }, () => PASSAGE).join("\n");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${name}: ${detail}`);
};

// ---- the app and the browser ----

let preview, chrome;
function cleanup() {
  preview?.kill();
  chrome?.kill();
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

if (!process.argv.includes("--no-build")) {
  console.log("Building…");
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "ignore" });
}
preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "ignore" });
const chromePath = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(profile, { recursive: true });
chrome = spawn(chromePath, [
  "--headless=new",
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  "--enable-unsafe-webgpu",
  "--no-first-run",
  "--mute-audio",
  "--autoplay-policy=no-user-gesture-required",
  "about:blank",
]);

async function until(what, fn, timeoutMs, everyMs = 500) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

await until("the app", () => fetch(`http://localhost:${PORT}/`).then((r) => r.ok), 30000);
const target = await until(
  "Chrome",
  () => fetch(`http://localhost:${DEBUG_PORT}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")),
  30000,
);

// A minimal DevTools protocol client.
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
let nextId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id !== undefined && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const page = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

// Before the page's own scripts: note every sound queued on the audio clock, and every change of
// the word highlighted.
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__test = { queued: [], stops: 0, wordChanges: [], lastWordAt: 0, states: [] };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
      __test.ctx = this.context;
      __test.queued.push({ when: Math.max(when, this.context.currentTime), seconds: this.buffer?.duration ?? 0 });
      return start.call(this, when, ...rest);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (...a) { __test.stops++; __test.queued.push({ restart: true }); return stop.apply(this, a); };
    new MutationObserver(() => {
      const w = document.querySelector('[data-spoken="word"]');
      if (w && w !== __test.word) { __test.word = w; __test.lastWordAt = performance.now(); __test.wordChanges.push(performance.now()); }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-spoken"] });
    // What the page says it's doing, by both clocks, so stops it owns up to ("getting ahead") can
    // be told apart from gaps it doesn't know about.
    new MutationObserver(() => {
      const s = document.querySelector("[data-narration-state]")?.dataset.narrationState;
      if (s && s !== __test.states.at(-1)?.state) __test.states.push({ state: s, at: performance.now(), clock: __test.ctx?.currentTime ?? 0 });
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-narration-state"] });
  `,
});

/** Memory of this Chrome's processes, in MB, as Activity Monitor counts it (ps RSS elsewhere). */
function memoryMB() {
  const pids = execFileSync("pgrep", ["-f", profile]).toString().trim().split("\n");
  if (process.platform === "darwin") {
    const out = execFileSync("top", ["-l", "1", "-stats", "pid,mem", ...pids.flatMap((p) => ["-pid", p])]).toString();
    let mb = 0;
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+([\d.]+)([KMG])/);
      if (m && pids.includes(m[1])) mb += Number(m[2]) * { K: 1 / 1024, M: 1, G: 1024 }[m[3]];
    }
    return Math.round(mb);
  }
  const out = execFileSync("ps", ["-o", "rss=", "-p", pids.join(",")]).toString();
  return Math.round(out.split("\n").reduce((a, l) => a + (Number(l) || 0), 0) / 1024);
}

const state = () => page(`document.querySelector("[data-narration-state]")?.dataset.narrationState`);
const click = (label) => page(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()`);

// ---- the checks ----

try {
  await send("Page.navigate", { url: `http://localhost:${PORT}/?harness=narration` });
  await until("the narration page", state, 30000);
  const emptyMB = memoryMB();

  // Our text, at 3×.
  await click("Paste your own text");
  await page(`(() => {
    const set = (el, v) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    set(document.querySelector("textarea"), ${JSON.stringify(TEXT)});
    set(document.querySelector('input[type="range"]'), "${RATE}");
  })()`);
  await click("Done");
  await click("Play");
  console.log("Loading the voice (downloads 326 MB the first time)…");
  await until("narration to start playing", async () => (await state()) === "playing", 10 * 60000, 1000);

  // Play on, sampling memory.
  const samples = [];
  const playFor = MINUTES * 60000;
  const t0 = Date.now();
  while (Date.now() - t0 < playFor) {
    samples.push({ at: (Date.now() - t0) / 1000, mb: memoryMB(), state: await state() });
    process.stdout.write(`\r  playing ${Math.round((Date.now() - t0) / 1000)} s, ${samples.at(-1).mb} MB   `);
    await sleep(10000);
  }
  process.stdout.write("\n");
  const peak = Math.max(...samples.map((s) => s.mb));
  check("memory: limit", peak <= LIMITS.memoryMB, `peak ${peak} MB with the voice loaded (limit ${LIMITS.memoryMB} MB; empty page ${emptyMB} MB)`);
  const settled = samples.filter((s) => s.at >= 60);
  if (settled.length >= 3) {
    const first = settled[0].mb;
    const late = Math.max(...settled.slice(-3).map((s) => s.mb));
    check("memory: no growth while playing", late <= first * (1 + LIMITS.growth), `${first} MB after a minute, ${late} MB at the end (allowed +${LIMITS.growth * 100}%)`);
  } else check("memory: no growth while playing", false, "played too briefly to tell (use --minutes 2 or more)");

  // Sentences back to back: the sounds queued are the sentences in order (until the first
  // restart); only a sentence that starts a paragraph may come after a pause. Joins where the page
  // said it had run out and was getting ahead are counted apart: that's a device too slow for the
  // speed, which the page shows, not a gap.
  const queued = await page("__test.queued");
  const states = await page("__test.states");
  const waitingBetween = (key, from, to) =>
    states.some((s, i) => s.state !== "playing" && s[key] <= to && (states[i + 1]?.[key] ?? Infinity) >= from);
  const paragraphStarts = new Set(await page(`[...document.querySelectorAll("p")].map((p) => Number(p.querySelector("[data-sentence]")?.dataset.sentence)).filter((n) => n >= 0)`));
  let joins = 0;
  let waits = 0;
  const bad = [];
  for (let i = 1; i < queued.length && !queued[i].restart; i++) {
    const end = queued[i - 1].when + queued[i - 1].seconds;
    const gap = queued[i].when - end;
    if (waitingBetween("clock", end - 0.05, queued[i].when + 0.05)) {
      waits++;
      continue;
    }
    const allowed = paragraphStarts.has(i) ? LIMITS.paragraphGapSeconds : LIMITS.gapSeconds;
    joins++;
    if (gap > allowed) bad.push(`before sentence ${i}: ${Math.round(gap * 1000)} ms (allowed ${Math.round(allowed * 1000)})`);
  }
  check(
    "gaps: back to back",
    joins > 20 && bad.length === 0,
    `${joins} joins while playing, ${bad.length} too long${bad.length ? ": " + bad.slice(0, 3).join("; ") : ""} (within a paragraph ${LIMITS.gapSeconds * 1000} ms, before one ${Math.round(LIMITS.paragraphGapSeconds * 1000)} ms); ${waits} stops to get ahead, shown as such`,
  );

  // The word highlight kept moving whenever the page said it was playing.
  const changes = await page("__test.wordChanges");
  let stall = 0;
  for (let i = 1; i < changes.length; i++) {
    if (waitingBetween("at", changes[i - 1], changes[i])) continue;
    stall = Math.max(stall, (changes[i] - changes[i - 1]) / 1000);
  }
  const sinceLast = await page("(performance.now() - __test.lastWordAt) / 1000");
  check(
    "words: highlight keeps moving",
    changes.length > 100 && stall <= LIMITS.wordStallSeconds && sinceLast <= LIMITS.wordStallSeconds,
    `${changes.length} word changes, longest still while playing ${stall.toFixed(1)} s, last ${sinceLast.toFixed(1)} s ago`,
  );

  // Pause, then play: carries on at once.
  await click("Pause");
  await until("paused", async () => (await state()) === "paused", 5000, 100);
  await sleep(3000);
  const before = await page("__test.wordChanges.length");
  const resumedAt = Date.now();
  await click("Resume");
  await until("the highlight to move after resuming", async () => (await page("__test.wordChanges.length")) > before + 1, 15000, 50);
  const resumeSeconds = (Date.now() - resumedAt) / 1000;
  check("resume: carries on at once", resumeSeconds <= LIMITS.resumeSeconds, `highlight moving again ${resumeSeconds.toFixed(2)} s after play (limit ${LIMITS.resumeSeconds} s)`);
  await click("Stop");

  // A reload gives the memory back.
  await send("Page.reload");
  await until("the page after reload", state, 30000);
  await sleep(5000);
  const reloadMB = memoryMB();
  check("memory: reload gives it back", reloadMB <= Math.max(LIMITS.reloadMB, emptyMB * 1.3), `${reloadMB} MB after reload (empty page was ${emptyMB} MB)`);
} catch (e) {
  check("run", false, e.message);
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nAll ${results.length} checks passed`);
ws.close();
process.exit(failed ? 1 : 0);
