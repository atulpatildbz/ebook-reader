export type Theme = {
  id: string;
  name: string;
  dark: boolean;
  bg: string;
  fg: string;
  /** Secondary text: running heads, progress, captions. */
  muted: string;
  /** Raised UI (sheets, toolbars) over the page. */
  surface: string;
  line: string;
  link: string;
  /** The bookmark ribbon: progress, the one accent in each theme. */
  ribbon: string;
};

// Every pair is tuned to stay well above WCAG AA for body text without the glare of pure
// black-on-white; night themes keep text below full brightness.
export const DAY_THEMES: Theme[] = [
  { id: "paper", name: "Paper", dark: false, bg: "#f3f1ec", fg: "#2b2925", muted: "#7a756b", surface: "#fbfaf7", line: "#dedad1", link: "#2f5c74", ribbon: "#a33a45" },
  { id: "sepia", name: "Sepia", dark: false, bg: "#ede0c6", fg: "#4a3a28", muted: "#86735a", surface: "#f5ead6", line: "#d8c7a6", link: "#6b4521", ribbon: "#8f2f2a" },
  { id: "sage", name: "Sage", dark: false, bg: "#e1e7dd", fg: "#25302a", muted: "#68756c", surface: "#ecf0e9", line: "#c9d2c4", link: "#2d5a4a", ribbon: "#8a3b2f" },
  { id: "mist", name: "Mist", dark: false, bg: "#e4e8ee", fg: "#232830", muted: "#69717d", surface: "#eff2f6", line: "#cdd3dc", link: "#2b5486", ribbon: "#9b3550" },
  { id: "white", name: "White", dark: false, bg: "#ffffff", fg: "#1f1f21", muted: "#75757a", surface: "#ffffff", line: "#e3e3e6", link: "#1f5aa6", ribbon: "#b0303f" },
];

export const NIGHT_THEMES: Theme[] = [
  { id: "night", name: "Night", dark: true, bg: "#1b1a18", fg: "#cdc5b6", muted: "#857e72", surface: "#252421", line: "#35332f", link: "#9cbfd0", ribbon: "#c9a35b" },
  { id: "dusk", name: "Dusk", dark: true, bg: "#2a2c30", fg: "#d6d3cc", muted: "#8f9095", surface: "#33363b", line: "#41444a", link: "#a7c3e6", ribbon: "#d2a868" },
  { id: "midnight", name: "Midnight", dark: true, bg: "#10151c", fg: "#b9c3ce", muted: "#6c7886", surface: "#18202a", line: "#253040", link: "#8fb6e0", ribbon: "#c7a15e" },
  { id: "ember", name: "Ember", dark: true, bg: "#0e0b08", fg: "#c99a5c", muted: "#7c613e", surface: "#18130e", line: "#2a2118", link: "#d9b27a", ribbon: "#b65a3c" },
  { id: "black", name: "Black", dark: true, bg: "#000000", fg: "#a3a3a3", muted: "#626262", surface: "#121212", line: "#262626", link: "#8ab0d8", ribbon: "#b8955a" },
];

const ALL_THEMES = [...DAY_THEMES, ...NIGHT_THEMES];
export const themeById = (id: string) => ALL_THEMES.find((t) => t.id === id) ?? DAY_THEMES[0];

type Font = { id: string; name: string; stack: string; google?: string; note: string };

export const FONTS: Font[] = [
  { id: "original", name: "Book's own", stack: "", note: "As the publisher set it" },
  { id: "literata", name: "Literata", stack: "'Literata', Georgia, serif", google: "Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400", note: "Serif made for screens" },
  { id: "source-serif", name: "Source Serif", stack: "'Source Serif 4', Georgia, serif", google: "Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400", note: "Even, modern serif" },
  { id: "garamond", name: "EB Garamond", stack: "'EB Garamond', Garamond, serif", google: "EB+Garamond:ital,wght@0,400;0,600;1,400", note: "Classic book face" },
  { id: "atkinson", name: "Atkinson", stack: "'Atkinson Hyperlegible Next', system-ui, sans-serif", google: "Atkinson+Hyperlegible+Next:ital,wght@0,400;0,600;1,400", note: "Sans for legibility" },
  { id: "lexend", name: "Lexend", stack: "'Lexend', system-ui, sans-serif", google: "Lexend:wght@300;400;600", note: "Wide, calm sans" },
];
export const fontById = (id: string) => FONTS.find((f) => f.id === id) ?? FONTS[0];
