import { describe, expect, test } from "vitest";
import {
  CANDLE_PRESETS,
  DEFAULT_CANDLE_COLORS,
  PALETTE_HUES,
  PALETTE_SHADES,
  THEMES,
  TV_PALETTE,
  allowedColors,
  contrast,
  presetsFor,
  readableOn,
  resolveCandleColors,
} from "../shared/candleColors";
import { DEFAULT_SETTINGS } from "../src/chartSettings";

describe("candle colours", () => {
  test("palette grid is complete (10 hues × 10 shades from tv-palette.json)", () => {
    for (const h of PALETTE_HUES) for (const s of PALETTE_SHADES) expect(TV_PALETTE[`${h.id}-${s}`]).toMatch(/^#[0-9a-f]{6}$/);
    // Spot checks against tradingview/lightweight-charts scripts/plugins/tv-palette.json
    expect(TV_PALETTE["minty-green-500"]).toBe("#089981");
    expect(TV_PALETTE["ripe-red-500"]).toBe("#f23645");
    expect(TV_PALETTE["tv-blue-500"]).toBe("#2962ff");
    expect(TV_PALETTE["banana-yellow-50"]).toBe("#fffde7");
  });

  test("WCAG contrast ratio", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(contrast("#089981", "#ffffff")).toBeCloseTo(3.57, 2);
  });

  test("only colours readable on the background are offered", () => {
    expect(allowedColors("light")).not.toContain("#fffde7"); // pale yellow on white
    expect(allowedColors("dark")).toContain("#fffde7");
    expect(allowedColors("dark")).not.toContain("#311b92"); // deep violet on dark
    expect(allowedColors("light")).toContain("#311b92");
    for (const t of ["dark", "light"] as const) for (const c of allowedColors(t)) expect(contrast(c, THEMES[t].bg)).toBeGreaterThanOrEqual(3);
  });

  test("defaults and presets are readable and allowed", () => {
    for (const t of ["dark", "light"] as const) {
      expect(readableOn(DEFAULT_CANDLE_COLORS[t].up, t)).toBe(true);
      expect(readableOn(DEFAULT_CANDLE_COLORS[t].down, t)).toBe(true);
      expect(presetsFor(t).some((p) => p.id === "tradingview")).toBe(true);
    }
    expect(presetsFor("dark").map((p) => p.id)).toEqual(CANDLE_PRESETS.map((p) => p.id));
    expect(presetsFor("light").map((p) => p.id)).not.toContain("classic");
  });

  test("saved colours per background, invalid ones fall back to the default", () => {
    const saved = { dark: { up: "#2962FF", down: "#ff9800" }, light: { up: "#123456", down: "#f23645" } };
    expect(resolveCandleColors("dark", saved)).toEqual({ up: "#2962ff", down: "#ff9800" });
    expect(resolveCandleColors("light", saved)).toEqual({ up: DEFAULT_CANDLE_COLORS.light.up, down: "#f23645" });
    expect(resolveCandleColors("light", undefined)).toEqual(DEFAULT_CANDLE_COLORS.light);
    // A pale colour saved for dark is not used on light.
    expect(resolveCandleColors("light", { light: { up: "#fffde7", down: "#f23645" } }).up).toBe(DEFAULT_CANDLE_COLORS.light.up);
  });

  test("ChartAI keeps its previous look by default", () => {
    expect(DEFAULT_SETTINGS.chartTheme).toBe("dark");
    expect(resolveCandleColors(DEFAULT_SETTINGS.chartTheme, DEFAULT_SETTINGS.candleColors)).toEqual({ up: "#26a69a", down: "#ef5350" });
  });
});
