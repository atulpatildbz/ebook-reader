import { useEffect } from "react";
import { resetTextAndLayout, setSettings, useSettings, useTheme } from "../lib/settings";
import { DAY_THEMES, FONTS, NIGHT_THEMES, type Theme } from "../lib/themes";
import { Group, Segmented, Sheet, Slider, Step, Toggle } from "../ui/controls";

const FONT_SIZES = { min: 13, max: 36 };

const FONT_SHEET = `https://fonts.googleapis.com/css2?${FONTS.filter((f) => f.google)
  .map((f) => `family=${f.google}`)
  .join("&")}&display=swap`;

export function SettingsPanel({ fixed, onClose }: { fixed: boolean; onClose: () => void }) {
  const s = useSettings();
  const shown = useTheme();

  // The font list shows each face in itself.
  useEffect(() => {
    if (document.querySelector(`link[data-fonts]`)) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = FONT_SHEET;
    l.dataset.fonts = "";
    document.head.append(l);
  }, []);

  return (
    <Sheet title="Text and theme" onClose={onClose} className="space-y-6">
      <Group label="Theme">
        <Segmented
          value={s.mode}
          options={[
            ["auto", "Match system"],
            ["day", "Day"],
            ["night", "Night"],
          ]}
          onChange={(mode) => setSettings({ mode })}
        />
        <Swatches themes={DAY_THEMES} value={s.dayTheme} onPick={(id) => setSettings({ dayTheme: id, mode: shown.dark ? "day" : s.mode })} />
        <Swatches themes={NIGHT_THEMES} value={s.nightTheme} onPick={(id) => setSettings({ nightTheme: id, mode: shown.dark ? s.mode : "night" })} />
      </Group>

      {!fixed && (
        <>
          <Group label="Font">
            <div className="grid grid-cols-2 gap-2">
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSettings({ font: f.id })}
                  aria-pressed={s.font === f.id}
                  className="rounded-xl border border-[var(--line)] px-3 py-2 text-left aria-pressed:border-[var(--fg)] aria-pressed:bg-[var(--bg)]"
                >
                  <span className="block text-[1.05rem]" style={{ fontFamily: f.stack || "inherit" }}>
                    {f.name}
                  </span>
                  <span className="block text-xs text-[var(--muted)]">{f.note}</span>
                </button>
              ))}
            </div>
          </Group>

          <Group label="Size">
            <div className="flex items-center gap-3">
              <Step onClick={() => setSettings({ fontSize: Math.max(FONT_SIZES.min, s.fontSize - 1) })} label="Smaller text">
                <span className="font-serif text-sm">A</span>
              </Step>
              <input
                type="range"
                min={FONT_SIZES.min}
                max={FONT_SIZES.max}
                value={s.fontSize}
                onChange={(e) => setSettings({ fontSize: Number(e.target.value) })}
                className="flex-1"
                aria-label="Text size"
              />
              <Step onClick={() => setSettings({ fontSize: Math.min(FONT_SIZES.max, s.fontSize + 1) })} label="Larger text">
                <span className="font-serif text-xl">A</span>
              </Step>
            </div>
          </Group>

          <Slider
            label="Line spacing"
            min={1.1}
            max={2.2}
            step={0.05}
            value={s.lineHeight}
            show={(v) => v.toFixed(2)}
            onChange={(lineHeight) => setSettings({ lineHeight })}
          />
          <Slider
            label="Page width"
            min={420}
            max={1100}
            step={20}
            value={s.width}
            show={(v) => `${Math.round(v / 10)} em`}
            onChange={(width) => setSettings({ width })}
          />

          <Group label="Layout">
            <Segmented
              value={s.flow}
              options={[
                ["paginated", "Pages"],
                ["scrolled", "Scroll"],
              ]}
              onChange={(flow) => setSettings({ flow })}
            />
            <Toggle label="Justify text" value={s.justify} onChange={(justify) => setSettings({ justify })} />
            <Toggle label="Hyphenate" value={s.hyphenate} onChange={(hyphenate) => setSettings({ hyphenate })} />
            <Toggle label="Two pages on wide screens" value={s.spread} onChange={(spread) => setSettings({ spread })} />
            <Toggle label="Slide when turning pages" value={s.animated} onChange={(animated) => setSettings({ animated })} />
            <Toggle label="Keep the book’s own colours" value={s.publisherColors} onChange={(publisherColors) => setSettings({ publisherColors })} />
          </Group>
        </>
      )}

      {fixed && (
        <Group label="Page fit">
          <Segmented
            value={s.pdfZoom}
            options={[
              ["fit-page", "Whole page"],
              ["fit-width", "Full width"],
            ]}
            onChange={(pdfZoom) => setSettings({ pdfZoom })}
          />
        </Group>
      )}

      <Slider
        label="Dim the screen"
        min={0}
        max={0.6}
        step={0.05}
        value={s.dim}
        show={(v) => (v ? `${Math.round(v * 100)}%` : "Off")}
        onChange={(dim) => setSettings({ dim })}
      />

      <button onClick={resetTextAndLayout} className="text-sm text-[var(--muted)] underline underline-offset-4 hover:text-[var(--fg)]">
        Reset text and layout
      </button>
    </Sheet>
  );
}

function Swatches({ themes, value, onPick }: { themes: Theme[]; value: string; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {themes.map((t) => (
        <button
          key={t.id}
          onClick={() => onPick(t.id)}
          aria-pressed={value === t.id}
          className="group flex flex-col items-center gap-1.5"
          aria-label={`${t.name} theme`}
        >
          <span
            className="relative grid aspect-[4/5] w-full place-items-center overflow-hidden rounded-lg border font-serif text-lg ring-offset-2 ring-offset-[var(--surface)] group-aria-pressed:ring-2 group-aria-pressed:ring-[var(--fg)]"
            style={{ background: t.bg, color: t.fg, borderColor: t.line }}
          >
            Aa
            <span className="absolute top-0 right-1.5 h-3 w-1.5" style={{ background: t.ribbon, clipPath: "polygon(0 0,100% 0,100% 100%,50% 75%,0 100%)" }} />
          </span>
          <span className="text-xs text-[var(--muted)] group-aria-pressed:text-[var(--fg)]">{t.name}</span>
        </button>
      ))}
    </div>
  );
}
