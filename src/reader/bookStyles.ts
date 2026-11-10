import type { FoliateView } from "../lib/foliate";
import type { Settings } from "../lib/settings";
import { fontById, type Theme } from "../lib/themes";
import { HIDDEN_NOTES_CSS, NAMESPACE_CSS, NARRATION_HIGHLIGHTS } from "./html";

/** Space the paginator leaves around the text, in px. */
export const PAGE_MARGIN = 52;

/** CSS injected into each chapter: [before the book's own CSS, after it]. */
function bookCSS(s: Settings, t: Theme): [string, string] {
  const font = fontById(s.font);
  const before = font.google ? `@import url("https://fonts.googleapis.com/css2?family=${font.google}&display=swap");` : "";
  const textual = "p, li, blockquote, dd";
  const after = `
${NAMESPACE_CSS}
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
::highlight(${NARRATION_HIGHLIGHTS.word}) { background: color-mix(in srgb, ${t.ribbon} 32%, transparent); }
::highlight(${NARRATION_HIGHLIGHTS.sentence}) { background: color-mix(in srgb, ${t.ribbon} 13%, transparent); }
${t.dark ? "img, svg, video { filter: brightness(0.82) contrast(1.05); }" : ""}
pre { white-space: pre-wrap !important; }
${HIDDEN_NOTES_CSS}
`;
  return [before, after];
}

/**
 * How the open book looks, as plain data: two equal looks lay the book out the same, so it's
 * applied again only when this changes. PDFs are pictures of pages, so they're tinted instead.
 */
export function bookLook(s: Settings, t: Theme) {
  return {
    fixed: {
      zoom: s.pdfZoom,
      filter: t.dark ? "invert(1) hue-rotate(180deg) brightness(0.8)" : "",
      blend: t.dark ? "screen" : t.bg.toLowerCase() === "#ffffff" ? "" : "multiply",
    },
    reflowable: {
      attributes: {
        flow: s.flow,
        "max-inline-size": `${s.width}px`,
        "max-column-count": s.spread ? "2" : "1",
        gap: "6%",
        margin: `${PAGE_MARGIN}px`,
        animated: s.animated ? "" : null,
      } as Record<string, string | null>,
      styles: bookCSS(s, t),
    },
  };
}

export type BookLook = ReturnType<typeof bookLook>;

export function applyLook(view: FoliateView, look: BookLook) {
  const r = view.renderer;
  if (view.isFixedLayout) {
    r.setAttribute("zoom", look.fixed.zoom);
    view.style.filter = look.fixed.filter;
    view.style.mixBlendMode = look.fixed.blend;
    return;
  }
  for (const [name, value] of Object.entries(look.reflowable.attributes)) {
    if (value === null) r.removeAttribute(name);
    else r.setAttribute(name, value);
  }
  r.setStyles?.(look.reflowable.styles);
}
