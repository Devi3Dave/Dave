// Chart background (dark or light) and candle colours, chosen only from TradingView's own colours.
//
// Sources (checked 2026-11-03):
// - TradingView colour palette: https://github.com/tradingview/lightweight-charts/blob/master/scripts/plugins/tv-palette.json
//   (TradingView's palette file in its own Lightweight Charts repository; the swatches below are copied from it unchanged).
// - "TradingView" candle pair #089981 / #F23645 (minty-green-500 / ripe-red-500 of that palette), the colours TradingView
//   uses for up/down candles in its own examples, e.g.
//   https://github.com/tradingview/lightweight-charts/blob/master/packages/lwc-plugin-rounded-candles-series/README.md
// - "Klassisch" pair #26a69a / #ef5350: Lightweight Charts' default candle colours,
//   https://github.com/tradingview/lightweight-charts/blob/master/src/model/series/candlestick-series.ts
// - Light chart background, text and pane separator: Lightweight Charts' layout defaults (#FFFFFF, #191919, #E0E3EB),
//   https://github.com/tradingview/lightweight-charts/blob/master/src/api/options/layout-options-defaults.ts,
//   grid lines: its grid default #D6DCDE, .../src/api/options/grid-options-defaults.ts
// - Readability on the background: WCAG 2.1, 1.4.11 Non-text Contrast (at least 3:1),
//   https://www.w3.org/TR/WCAG21/#non-text-contrast, contrast ratio and relative luminance as defined in WCAG 2.1.

export type ChartTheme = "dark" | "light";

export interface CandlePair {
  up: string;
  down: string;
}

export interface ThemeColors {
  bg: string;
  text: string;
  grid: string;
  border: string;
}

/** Chart canvas colours per background. Dark: ChartAI's previous colours (TradingView's classic dark chart). */
export const THEMES: Record<ChartTheme, ThemeColors> = {
  dark: { bg: "#131722", text: "#d1d4dc", grid: "rgba(42,46,57,0.6)", border: "#2a2e39" },
  light: { bg: "#ffffff", text: "#191919", grid: "#d6dcde", border: "#e0e3eb" },
};

/** Hue columns of TradingView's palette (tv-palette.json), in the order of TradingView's colour picker. */
export const PALETTE_HUES: { id: string; label: string }[] = [
  { id: "ripe-red", label: "Rot" },
  { id: "tan-orange", label: "Orange" },
  { id: "banana-yellow", label: "Gelb" },
  { id: "iguana-green", label: "Grün" },
  { id: "minty-green", label: "Mint" },
  { id: "sky-blue", label: "Cyan" },
  { id: "tv-blue", label: "Blau" },
  { id: "deep-blue", label: "Violett" },
  { id: "grapes-purple", label: "Lila" },
  { id: "berry-pink", label: "Pink" },
];

export const PALETTE_SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"] as const;

/** TradingView's palette, copied from tv-palette.json (hue-shade → colour). */
export const TV_PALETTE: Record<string, string> = {
  "ripe-red-50": "#ffebec", "ripe-red-100": "#fccbcd", "ripe-red-200": "#faa1a4", "ripe-red-300": "#f77c80", "ripe-red-400": "#f7525f",
  "ripe-red-500": "#f23645", "ripe-red-600": "#cc2f3c", "ripe-red-700": "#b22833", "ripe-red-800": "#991f29", "ripe-red-900": "#801922",
  "tan-orange-50": "#fff3e0", "tan-orange-100": "#ffe0b2", "tan-orange-200": "#ffcc80", "tan-orange-300": "#ffb74d", "tan-orange-400": "#ffa726",
  "tan-orange-500": "#ff9800", "tan-orange-600": "#fb8c00", "tan-orange-700": "#f57c00", "tan-orange-800": "#ef6c00", "tan-orange-900": "#e65100",
  "banana-yellow-50": "#fffde7", "banana-yellow-100": "#fff9c4", "banana-yellow-200": "#fff59d", "banana-yellow-300": "#fff176", "banana-yellow-400": "#ffee58",
  "banana-yellow-500": "#ffeb3b", "banana-yellow-600": "#fdd835", "banana-yellow-700": "#fbc02d", "banana-yellow-800": "#f9a825", "banana-yellow-900": "#f57f17",
  "iguana-green-50": "#e8f5e9", "iguana-green-100": "#c8e6c9", "iguana-green-200": "#a5d6a7", "iguana-green-300": "#81c784", "iguana-green-400": "#66bb6a",
  "iguana-green-500": "#4caf50", "iguana-green-600": "#43a047", "iguana-green-700": "#388e3c", "iguana-green-800": "#2e7d32", "iguana-green-900": "#1b5e20",
  "minty-green-50": "#daf2ee", "minty-green-100": "#ace5dc", "minty-green-200": "#70ccbd", "minty-green-300": "#42bda8", "minty-green-400": "#22ab94",
  "minty-green-500": "#089981", "minty-green-600": "#06806b", "minty-green-700": "#056656", "minty-green-800": "#004d40", "minty-green-900": "#00332a",
  "sky-blue-50": "#e0f7fa", "sky-blue-100": "#b2ebf2", "sky-blue-200": "#80deea", "sky-blue-300": "#4dd0e1", "sky-blue-400": "#26c6da",
  "sky-blue-500": "#00bcd4", "sky-blue-600": "#00acc1", "sky-blue-700": "#0097a7", "sky-blue-800": "#00838f", "sky-blue-900": "#006064",
  "tv-blue-50": "#e3effd", "tv-blue-100": "#bbd9fb", "tv-blue-200": "#90bff9", "tv-blue-300": "#5b9cf6", "tv-blue-400": "#3179f5",
  "tv-blue-500": "#2962ff", "tv-blue-600": "#1e53e5", "tv-blue-700": "#1848cc", "tv-blue-800": "#143eb2", "tv-blue-900": "#0c3299",
  "deep-blue-50": "#ede7f6", "deep-blue-100": "#d1c4e9", "deep-blue-200": "#b39ddb", "deep-blue-300": "#9575cd", "deep-blue-400": "#7e57c2",
  "deep-blue-500": "#673ab7", "deep-blue-600": "#5e35b1", "deep-blue-700": "#512da8", "deep-blue-800": "#4527a0", "deep-blue-900": "#311b92",
  "grapes-purple-50": "#f3e5f5", "grapes-purple-100": "#e1bee7", "grapes-purple-200": "#ce93d8", "grapes-purple-300": "#ba68c8", "grapes-purple-400": "#ab47bc",
  "grapes-purple-500": "#9c27b0", "grapes-purple-600": "#8e24aa", "grapes-purple-700": "#7b1fa2", "grapes-purple-800": "#6a1b9a", "grapes-purple-900": "#4a148c",
  "berry-pink-50": "#fce4ec", "berry-pink-100": "#f8bbd0", "berry-pink-200": "#f48fb1", "berry-pink-300": "#f06292", "berry-pink-400": "#ec407a",
  "berry-pink-500": "#e91e63", "berry-pink-600": "#d81b60", "berry-pink-700": "#c2185b", "berry-pink-800": "#ad1457", "berry-pink-900": "#880e4f",
};

export interface CandlePreset extends CandlePair {
  id: string;
  label: string;
  tip: string;
}

/** Ready-made up/down pairs; each is shown only on a background it is readable on. */
export const CANDLE_PRESETS: CandlePreset[] = [
  { id: "tradingview", label: "TradingView", up: "#089981", down: "#f23645", tip: "Grün #089981 / Rot #F23645 – TradingViews heutige Kerzenfarben" },
  { id: "classic", label: "Klassisch", up: "#26a69a", down: "#ef5350", tip: "Grün #26A69A / Rot #EF5350 – Standard von TradingViews Lightweight Charts (bisherige ChartAI-Farben)" },
];

/** Defaults per background: dark keeps ChartAI's previous colours, light uses TradingView's (the classic green is too pale on white). */
export const DEFAULT_CANDLE_COLORS: Record<ChartTheme, CandlePair> = {
  dark: { up: "#26a69a", down: "#ef5350" },
  light: { up: "#089981", down: "#f23645" },
};

/** WCAG 2.1 non-text contrast a candle needs against the background. */
export const MIN_CONTRAST = 3;

function channels(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2.1 relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const c = channels(hex);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio (1 … 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function readableOn(color: string, theme: ChartTheme): boolean {
  return contrast(color, THEMES[theme].bg) >= MIN_CONTRAST;
}

/** Every colour that may be picked on a background: TradingView's palette and the presets, if readable there. */
export function allowedColors(theme: ChartTheme): string[] {
  const all = [...Object.values(TV_PALETTE), ...CANDLE_PRESETS.flatMap((p) => [p.up, p.down])];
  return [...new Set(all.map((c) => c.toLowerCase()))].filter((c) => readableOn(c, theme));
}

export function presetsFor(theme: ChartTheme): CandlePreset[] {
  return CANDLE_PRESETS.filter((p) => readableOn(p.up, theme) && readableOn(p.down, theme));
}

export type CandleColorSettings = Record<ChartTheme, CandlePair>;

/** The pair to draw: the saved colours if they are allowed on this background, else that background's default. */
export function resolveCandleColors(theme: ChartTheme, saved: Partial<CandleColorSettings> | undefined): CandlePair {
  const t: ChartTheme = theme === "light" ? "light" : "dark";
  const allowed = new Set(allowedColors(t));
  const pick = (c: string | undefined, fallback: string) => (c && allowed.has(c.toLowerCase()) ? c.toLowerCase() : fallback);
  const s = saved?.[t];
  return { up: pick(s?.up, DEFAULT_CANDLE_COLORS[t].up), down: pick(s?.down, DEFAULT_CANDLE_COLORS[t].down) };
}

/** `rgba()` of a #rrggbb colour, for fills. */
export function withAlpha(hex: string, a: number): string {
  const c = channels(hex);
  return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : hex;
}
