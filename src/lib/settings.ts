import { useEffect, useState, useSyncExternalStore } from "react";
import { themeById, type Theme } from "./themes";

// Reading settings stay on the device: a phone and a laptop want different sizes and widths.
export type Settings = {
  mode: "auto" | "day" | "night";
  dayTheme: string;
  nightTheme: string;
  font: string;
  fontSize: number;
  lineHeight: number;
  /** Max text column width in px. */
  width: number;
  justify: boolean;
  hyphenate: boolean;
  flow: "paginated" | "scrolled";
  /** Two columns side by side on wide screens. */
  spread: boolean;
  animated: boolean;
  publisherColors: boolean;
  /** Extra darkening over the page, 0–0.6 (for bright screens at night). */
  dim: number;
  pdfZoom: "fit-page" | "fit-width";
  /** Words per part when copying a chapter in parts. */
  copyPartWords: number;
  /** Narration voice: a Kokoro voice id, or "device" for the system's own. */
  narrationVoice: string;
  /** Narration speed, 0.75–3. */
  narrationRate: number;
};

export const DEFAULTS: Settings = {
  mode: "auto",
  dayTheme: "paper",
  nightTheme: "night",
  font: "literata",
  fontSize: 19,
  lineHeight: 1.6,
  width: 680,
  justify: true,
  hyphenate: true,
  flow: "paginated",
  spread: true,
  animated: true,
  publisherColors: false,
  dim: 0,
  pdfZoom: "fit-page",
  copyPartWords: 2000,
  narrationVoice: "af_heart",
  narrationRate: 1,
};

const KEY = "ribbon:settings";
const listeners = new Set<() => void>();

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let current = read();

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode: settings last for this visit */
  }
  listeners.forEach((l) => l());
}

window.addEventListener("storage", (e) => {
  if (e.key === KEY) {
    current = read();
    listeners.forEach((l) => l());
  }
});

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

function useSystemDark() {
  const [dark, setDark] = useState(darkQuery.matches);
  useEffect(() => {
    const on = () => setDark(darkQuery.matches);
    darkQuery.addEventListener("change", on);
    return () => darkQuery.removeEventListener("change", on);
  }, []);
  return dark;
}

/** The theme in effect now: the day or night pick, by the mode (auto follows the system). */
export function useTheme(): Theme {
  const s = useSettings();
  const systemDark = useSystemDark();
  const night = s.mode === "night" || (s.mode === "auto" && systemDark);
  return themeById(night ? s.nightTheme : s.dayTheme);
}

/** Paint the app chrome (outside the book) in the reading theme. */
export function useApplyTheme(theme: Theme) {
  useEffect(() => {
    const r = document.documentElement.style;
    for (const k of ["bg", "fg", "muted", "surface", "line", "link", "ribbon"] as const) r.setProperty(`--${k}`, theme[k]);
    // Text on the ribbon colour: white on the deep day reds, page colour on the night golds.
    r.setProperty("--on-ribbon", theme.dark ? theme.bg : "#ffffff");
    document.documentElement.style.colorScheme = theme.dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.bg);
  }, [theme]);
}
