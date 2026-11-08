// Speeds speech up (or slows it down) without changing its pitch, by WSOLA: the overlap-add method
// browsers use for <audio> playbackRate. Short overlapping windows of the original are laid down
// at a steady pace; each is taken from wherever near its nominal place best continues the
// waveform laid down so far, so the joins don't click or warble.

const WINDOW = 0.02; // seconds per window
const SEARCH = 0.01; // how far either side of its nominal place a window may be taken from

/** `x` played `factor` times as fast (2 = half as long), at the same pitch. */
export function stretch(x: Float32Array<ArrayBuffer>, factor: number, sampleRate: number): Float32Array<ArrayBuffer> {
  const n = 2 * Math.round((sampleRate * WINDOW) / 2);
  const hop = n / 2;
  const tol = Math.round(sampleRate * SEARCH);
  if (Math.abs(factor - 1) < 0.01 || x.length < 2 * n + 2 * tol) return x;

  const win = new Float32Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  const frames = Math.max(1, Math.floor((x.length / factor - n) / hop) + 1);
  const y = new Float32Array((frames - 1) * hop + n);
  const last = x.length - n;

  // How well a window starting at p carries on from `nat` (normalized, so loudness doesn't win).
  const score = (nat: number, p: number) => {
    let c = 0;
    let e = 1e-9;
    for (let i = 0; i < hop; i += 2) {
      const v = x[p + i];
      c += x[nat + i] * v;
      e += v * v;
    }
    return c / Math.sqrt(e);
  };

  let prev = 0;
  for (let k = 0; k < frames; k++) {
    const nominal = Math.min(last, Math.round(k * hop * factor));
    let pos = nominal;
    if (k > 0) {
      const nat = prev + hop; // where the previous window would naturally carry on
      const lo = Math.max(0, nominal - tol);
      const hi = Math.min(last, nominal + tol);
      let best = -Infinity;
      for (let p = lo; p <= hi; p += 2) {
        const s = score(nat, p);
        if (s > best) (best = s), (pos = p);
      }
      for (const p of [pos - 1, pos + 1]) {
        if (p < lo || p > hi) continue;
        const s = score(nat, p);
        if (s > best) (best = s), (pos = p);
      }
    }
    const o = k * hop;
    for (let i = 0; i < n; i++) y[o + i] += x[pos + i] * win[i];
    prev = pos;
  }
  return y;
}
