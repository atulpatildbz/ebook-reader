export const pct = (f: number) => `${Math.round(f * 100)}%`;

/** A stretch of time: "45 s", "3 min", "1 h 20 min". */
export function duration(seconds: number) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const min = Math.round(seconds / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}
