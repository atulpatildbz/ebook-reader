import type { FoliateView } from "../lib/foliate";
import type { Settings } from "../lib/settings";
import { fontById, type Theme } from "../lib/themes";
import { HIDDEN_NOTES_CSS } from "./html";

/** Space the paginator leaves around the text, in px. */
export const PAGE_MARGIN = 52;

/** CSS injected into each chapter: [before the book's own CSS, after it]. */
function bookCSS(s: Settings, t: Theme): [string, string] {
  const font = fontById(s.font);
  const before = font.google ? `@import url("https://fonts.googleapis.com/css2?family=${font.google}&display=swap");` : "";
  const textual = "p, li, blockquote, dd";
  const after = `
@namespace epub "http://www.idpf.org/2007/ops";
html { color-scheme: ${t.dark ? "dark" : "light"}; font-size: ${s.fontSize}px !important; }
html, body { background: ${t.bg} !important; color: ${t.fg} !important; }
body { font-size: 1rem !important; line-height: ${s.lineHeight} !important; }
${font.stack ? `body, body *:not(code):not(pre):not(kbd):not(samp):not(tt) { font-family: ${font.stack} !important; }` : ""}
${textual} {
  line-height: ${s.lineHeight} !important;
  text-align: ${s.justify ? "justify" : "start"};
  -webkit-hyphens: ${s.hyphenate ? "auto" : "manual"};
  hyphens: ${s.hyphenate ? "auto" : "manual"};
  -webkit-hyphenate-limit-before: 3;
  -webkit-hyphenate-limit-after: 2;
  -webkit-hyphenate-limit-lines: 2;
  hanging-punctuation: allow-end last;
  widows: 2;
  orphans: 2;
}
[align="left"] { text-align: left; }
[align="right"] { text-align: right; }
[align="center"] { text-align: center; }
h1, h2, h3, h4, h5, h6 { text-align: start; hyphens: manual; line-height: 1.25 !important; }
${s.publisherColors ? "" : `body *:not(a):not(img):not(svg):not(svg *) { color: inherit !important; background-color: transparent !important; }`}
a:any-link { color: ${t.link} !important; text-decoration-color: color-mix(in srgb, ${t.link} 40%, transparent); text-underline-offset: 0.15em; }
::selection { background: color-mix(in srgb, ${t.ribbon} 32%, transparent); }
${t.dark ? "img, svg, video { filter: brightness(0.82) contrast(1.05); }" : ""}
pre { white-space: pre-wrap !important; }
${HIDDEN_NOTES_CSS}
`;
  return [before, after];
}

/** Apply layout + theme to an open view. PDFs are pictures of pages, so they get tinted instead. */
export function applyToView(view: FoliateView, s: Settings, t: Theme) {
  const r = view.renderer;
  if (view.isFixedLayout) {
    r.setAttribute("zoom", s.pdfZoom);
    if (t.dark) {
      view.style.filter = "invert(1) hue-rotate(180deg) brightness(0.8)";
      view.style.mixBlendMode = "screen";
    } else {
      view.style.filter = "";
      view.style.mixBlendMode = t.bg.toLowerCase() === "#ffffff" ? "" : "multiply";
    }
    return;
  }
  r.setAttribute("flow", s.flow);
  r.setAttribute("max-inline-size", `${s.width}px`);
  r.setAttribute("max-column-count", s.spread ? "2" : "1");
  r.setAttribute("gap", "6%");
  r.setAttribute("margin", `${PAGE_MARGIN}px`);
  if (s.animated) r.setAttribute("animated", "");
  else r.removeAttribute("animated");
  r.setStyles?.(bookCSS(s, t));
}
