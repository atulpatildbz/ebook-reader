// Word timings for one synthesized sentence. Kokoro reports how long it spends on each phoneme;
// the phonemes come back as one string with spaces between spoken words. Spoken words don't line
// up one-to-one with written ones ("1,500" is said as three words, a lone "—" as none), so the
// written words are matched to runs of spoken words by length, cheapest overall match wins.

export type WordTiming = { charStart: number; charEnd: number; start: number; end: number };

const LETTER = /[\p{L}\p{N}]/u;
// Phoneme characters that take no time of their own in a length estimate.
const NOT_SOUND = /[ˈˌː\s"“”‘’,.;:!?—–\-()…]/u;

type Spoken = { start: number; end: number; len: number };

/** Spoken words with start/end seconds, from the phoneme of each input id and its duration. */
function spokenWords(phonemes: string[], durations: number[], seconds: number): Spoken[] {
  const total = durations.reduce((a, b) => a + b, 0) || 1;
  const scale = seconds / total;
  const out: Spoken[] = [];
  let t = 0;
  let cur: Spoken | null = null;
  // The first and last ids are the sentence boundary ("$"): leading and trailing silence.
  for (let i = 0; i < phonemes.length; i++) {
    const p = phonemes[i];
    const d = durations[i] * scale;
    if (i === 0 || i === phonemes.length - 1 || p === " ") {
      if (cur) out.push(cur);
      cur = null;
    } else {
      cur ??= { start: t, end: t, len: 0 };
      cur.end = t + d;
      if (!NOT_SOUND.test(p)) cur.len++;
    }
    t += d;
  }
  if (cur) out.push(cur);
  return out;
}

/** Rough phoneme count for a written word. */
function estimate(word: string): number {
  const letters = (word.match(/\p{L}/gu) ?? []).length;
  const digits = (word.match(/\p{N}/gu) ?? []).length;
  return letters * 0.85 + digits * 5;
}

export function alignWords(text: string, phonemes: string[], durations: number[], seconds: number): WordTiming[] {
  const written = [...text.matchAll(/\S+/g)].map((m) => ({ s: m.index!, e: m.index! + m[0].length, w: m[0] }));
  const spoken = spokenWords(phonemes, durations, seconds);
  const n = written.length;
  const m = spoken.length;
  if (!n) return [];

  // dp[i][j]: cheapest match of the first i written words to the first j spoken ones. A step is
  // one written word to k spoken words (k = 0 for punctuation said as a pause), or two written
  // words run together into one spoken word ("to be" said as "təbi").
  const INF = 1e9;
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF));
  const move = Array.from({ length: n + 1 }, () => new Int8Array(m + 1)); // k, or -1 for a pair
  dp[0][0] = 0;
  const relax = (i: number, j: number, c: number, mv: number) => {
    if (c < dp[i][j]) {
      dp[i][j] = c;
      move[i][j] = mv;
    }
  };
  for (let i = 0; i < n; i++) {
    const w = written[i].w;
    const silent = !LETTER.test(w);
    const hasDigit = /\p{N}/u.test(w);
    const est = estimate(w);
    const maxK = hasDigit ? 8 : 3;
    for (let j = 0; j <= m; j++) {
      const base = dp[i][j];
      if (base >= INF) continue;
      let len = 0;
      for (let k = 0; k <= maxK && j + k <= m; k++) {
        if (k > 0) len += spoken[j + k - 1].len;
        let c: number;
        if (k === 0) c = silent ? 0 : 6;
        else {
          c = Math.abs(Math.log((len + 1) / (est + 1)));
          if (silent) c += 2;
          c += (k - 1) * (hasDigit ? 0.1 : /[-'’]/.test(w) ? 0.6 : 1.5);
        }
        relax(i + 1, j + k, base + c, k);
      }
      if (i + 1 < n && j < m && !silent && LETTER.test(written[i + 1].w)) {
        const pair = est + estimate(written[i + 1].w);
        relax(i + 2, j + 1, base + Math.abs(Math.log((spoken[j].len + 1) / (pair + 1))) + 1, -1);
      }
    }
  }

  if (dp[n][m] >= INF) return proportional(written, spoken, seconds);

  // Walk back from the full match, then hand out times.
  const steps: { i: number; j: number; mv: number }[] = [];
  for (let i = n, j = m; i > 0; ) {
    const mv = move[i][j];
    const ni = mv === -1 ? i - 2 : i - 1;
    const nj = mv === -1 ? j - 1 : j - mv;
    steps.push({ i: ni, j: nj, mv });
    i = ni;
    j = nj;
  }
  steps.reverse();

  const out: WordTiming[] = [];
  let prevEnd = spoken[0]?.start ?? 0;
  const push = (w: (typeof written)[number], start: number, end: number) => {
    out.push({ charStart: w.s, charEnd: w.e, start, end });
    prevEnd = end;
  };
  for (const { i, j, mv } of steps) {
    if (mv === -1) {
      // Split the shared spoken word between the pair by their expected lengths.
      const a = estimate(written[i].w) + 0.5;
      const b = estimate(written[i + 1].w) + 0.5;
      const { start, end } = spoken[j];
      const mid = start + ((end - start) * a) / (a + b);
      push(written[i], start, mid);
      push(written[i + 1], mid, end);
    } else if (mv === 0) push(written[i], prevEnd, prevEnd);
    else push(written[i], spoken[j].start, spoken[j + mv - 1].end);
  }
  return out;
}

/** No sensible match: spread the spoken stretch over the words by their length. */
function proportional(written: { s: number; e: number; w: string }[], spoken: Spoken[], seconds: number): WordTiming[] {
  const from = spoken[0]?.start ?? 0;
  const to = spoken.at(-1)?.end ?? seconds;
  const weights = written.map((x) => estimate(x.w) + 0.5);
  const total = weights.reduce((a, b) => a + b, 0);
  let t = from;
  return written.map((x, i) => {
    const start = t;
    t += ((to - from) * weights[i]) / total;
    return { charStart: x.s, charEnd: x.e, start, end: t };
  });
}
