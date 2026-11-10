// What this browser keeps in localStorage. Storage can be disabled (private mode) or full: then
// reads find nothing and writes are lost, and the app carries on for this visit.

export function readText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeText(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* disabled or full */
  }
}

export function removeStored(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* disabled */
  }
}

export function readStored<T>(key: string): T | null {
  const raw = readText(key);
  try {
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export const writeStored = (key: string, value: unknown) => writeText(key, JSON.stringify(value));
