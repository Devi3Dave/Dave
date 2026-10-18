import { liquidationHeatmap, strongestLevels, type Heatmap } from "./liquidations.js";
import * as m from "./math.js";
import { detectCandlePatterns, detectFormations, type CandlePattern, type Formation } from "./patterns.js";
import type { Bar, Series } from "./math.js";

export type { Bar, Series };

export interface ParamDef {
  key: string;
  label: string;
  default: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface OutputDef {
  key: string;
  label: string;
  color: string;
  style?: "line" | "histogram" | "dots" | "area";
  lineWidth?: number;
  dashed?: boolean;
  // Keep the price scale fitted to the candles even when this line is far away.
  noAutoscale?: boolean;
  // Plot the value N bars to the right (positive) or left (negative) of its bar.
  offset?: (params: Record<string, number>) => number;
  // Per-point color (histogram bars, dots, line segments); `base` is the configured color.
  pointColor?: (ctx: { values: Series; i: number; bar: Bar; outputs: Record<string, Series>; base: string }) => string;
}

export type IndicatorCategory = "Gleitende Durchschnitte" | "Trend" | "Momentum" | "Volatilität" | "Volumen" | "Krypto" | "Muster";

export interface IndicatorDef {
  id: string;
  name: string;
  // Legend label; defaults to the abbreviation in parentheses in `name`.
  short?: string;
  category: IndicatorCategory;
  overlay: boolean;
  description: string;
  params: ParamDef[];
  outputs: OutputDef[];
  levels?: number[];
  // Shade the area between two outputs.
  fills?: { upper: string; lower: string; color: string; colorBelow?: string }[];
  compute: (bars: Bar[], p: Record<string, number>) => Record<string, Series>;
  // Horizontal volume histogram drawn next to the price axis.
  profile?: (bars: Bar[], p: Record<string, number>) => m.VolumeProfile | null;
  // Time × price intensity grid drawn behind the candles.
  heatmap?: (bars: Bar[], p: Record<string, number>) => Heatmap | null;
  // Contrast exponent for the heatmap colors (param key).
  heatmapContrastKey?: string;
  // Candle patterns (as markers) and chart formations (as lines) found in the data.
  patterns?: (bars: Bar[], p: Record<string, number>) => PatternResult;
}

export interface PatternResult {
  candles: CandlePattern[];
  formations: Formation[];
}

// Rising/falling coloring shared by momentum histograms.
const prevOf = (values: Series, i: number) => (i > 0 ? values[i - 1] : null);
const risingFalling =
  (upStrong: string, upWeak: string, downWeak: string, downStrong: string) =>
  ({ values, i }: { values: Series; i: number }) => {
    const v = values[i] as number;
    const prev = prevOf(values, i);
    const rising = prev === null || prev === undefined || v >= prev;
    if (v >= 0) return rising ? upStrong : upWeak;
    return rising ? downWeak : downStrong;
  };

const len = (def = 14, label = "Länge"): ParamDef => ({ key: "length", label, default: def, min: 1, max: 500, step: 1 });

export const INDICATORS: IndicatorDef[] = [
  {
    id: "candlepatterns",
    name: "Kerzenmuster",
    category: "Muster",
    overlay: true,
    description:
      "Erkennt Engulfing, Hammer, Hanging Man, (Inverted) Hammer, Shooting Star, Morning/Evening Star, Harami, Piercing Line, Dark Cloud Cover, Three White Soldiers/Black Crows und optional Doji – als Marker an der Kerze.",
    params: [
      { key: "lookback", label: "Kerzen durchsuchen", default: 150, min: 20, max: 1000 },
      { key: "doji", label: "Doji zeigen (0/1)", default: 0, min: 0, max: 1 },
    ],
    outputs: [],
    compute: () => ({}),
    patterns: (b, p) => ({ candles: detectCandlePatterns(b, p.lookback, p.doji >= 1), formations: [] }),
  },
  {
    id: "chartpatterns",
    name: "Chartformationen",
    category: "Muster",
    overlay: true,
    description:
      "Erkennt Doppeltop/-boden, Schulter-Kopf-Schulter (auch invers) und das aktuelle Dreieck (aufsteigend, absteigend, symmetrisch) aus Swing-Hochs/-Tiefs. Durchgezogen = Nackenlinie gebrochen, gestrichelt = noch unbestätigt; mit Kursziel.",
    params: [
      { key: "pivot", label: "Swing-Länge", default: 5, min: 2, max: 30 },
      { key: "tolerance", label: "Toleranz %", default: 1.5, min: 0.2, max: 10, step: 0.1 },
    ],
    outputs: [],
    compute: () => ({}),
    patterns: (b, p) => ({ candles: [], formations: detectFormations(b, p.pivot, p.tolerance) }),
  },
  // ---------------- Trend / overlays ----------------
  {
    id: "sma",
    name: "Simple Moving Average (SMA)",
    category: "Gleitende Durchschnitte",
    overlay: true,
    description: "Arithmetischer Durchschnitt der Schlusskurse.",
    params: [len(20)],
    outputs: [{ key: "value", label: "SMA", color: "#2962ff" }],
    compute: (b, p) => ({ value: m.sma(m.closes(b), p.length) }),
  },
  {
    id: "ema",
    name: "Exponential Moving Average (EMA)",
    category: "Gleitende Durchschnitte",
    overlay: true,
    description: "Exponentiell gewichteter Durchschnitt, reagiert schneller als SMA.",
    params: [len(21)],
    outputs: [{ key: "value", label: "EMA", color: "#ff9800" }],
    compute: (b, p) => ({ value: m.ema(m.closes(b), p.length) }),
  },
  {
    id: "wma",
    name: "Weighted Moving Average (WMA)",
    category: "Gleitende Durchschnitte",
    overlay: true,
    description: "Linear gewichteter Durchschnitt.",
    params: [len(20)],
    outputs: [{ key: "value", label: "WMA", color: "#9c27b0" }],
    compute: (b, p) => ({ value: m.wma(m.closes(b), p.length) }),
  },
  {
    id: "hma",
    name: "Hull Moving Average (HMA)",
    category: "Gleitende Durchschnitte",
    overlay: true,
    description: "Glatter, verzögerungsarmer Durchschnitt nach Alan Hull.",
    params: [len(21)],
    outputs: [{ key: "value", label: "HMA", color: "#00bcd4" }],
    compute: (b, p) => ({ value: m.hma(m.closes(b), p.length) }),
  },
  {
    id: "vwma",
    name: "Volume Weighted Moving Average (VWMA)",
    category: "Gleitende Durchschnitte",
    overlay: true,
    description: "Volumengewichteter gleitender Durchschnitt.",
    params: [len(20)],
    outputs: [{ key: "value", label: "VWMA", color: "#795548" }],
    compute: (b, p) => ({ value: m.vwma(b, p.length) }),
  },
  {
    id: "vwap",
    name: "VWAP",
    category: "Volumen",
    overlay: true,
    description: "Volume Weighted Average Price, täglich (UTC) zurückgesetzt.",
    params: [],
    outputs: [{ key: "value", label: "VWAP", color: "#e91e63", lineWidth: 2 }],
    compute: (b) => ({ value: m.vwap(b) }),
  },
  {
    id: "bb",
    name: "Bollinger Bands",
    category: "Volatilität",
    overlay: true,
    description: "SMA ± n Standardabweichungen.",
    params: [len(20), { key: "mult", label: "StdAbw", default: 2, min: 0.1, max: 10, step: 0.1 }],
    outputs: [
      { key: "upper", label: "Oben", color: "#2962ff" },
      { key: "basis", label: "Basis", color: "#ff6d00" },
      { key: "lower", label: "Unten", color: "#2962ff" },
    ],
    fills: [{ upper: "upper", lower: "lower", color: "rgba(41,98,255,0.08)" }],
    compute: (b, p) => m.bollinger(m.closes(b), p.length, p.mult),
  },
  {
    id: "keltner",
    name: "Keltner Channels",
    category: "Volatilität",
    overlay: true,
    description: "EMA ± n × ATR.",
    params: [len(20), { key: "mult", label: "Multiplikator", default: 2, min: 0.1, max: 10, step: 0.1 }, { key: "atrLength", label: "ATR-Länge", default: 10, min: 1, max: 200 }],
    outputs: [
      { key: "upper", label: "Oben", color: "#26a69a" },
      { key: "basis", label: "Basis", color: "#26a69a", dashed: true },
      { key: "lower", label: "Unten", color: "#26a69a" },
    ],
    fills: [{ upper: "upper", lower: "lower", color: "rgba(38,166,154,0.07)" }],
    compute: (b, p) => m.keltner(b, p.length, p.mult, p.atrLength),
  },
  {
    id: "donchian",
    name: "Donchian Channels",
    category: "Volatilität",
    overlay: true,
    description: "Höchstes Hoch / tiefstes Tief der letzten n Kerzen.",
    params: [len(20)],
    outputs: [
      { key: "upper", label: "Oben", color: "#1e88e5" },
      { key: "basis", label: "Basis", color: "#ff6d00" },
      { key: "lower", label: "Unten", color: "#1e88e5" },
    ],
    fills: [{ upper: "upper", lower: "lower", color: "rgba(30,136,229,0.06)" }],
    compute: (b, p) => m.donchian(b, p.length),
  },
  {
    id: "envelope",
    name: "Envelope",
    category: "Trend",
    overlay: true,
    description: "SMA ± prozentualer Abstand.",
    params: [len(20), { key: "percent", label: "Prozent", default: 2.5, min: 0.1, max: 50, step: 0.1 }],
    outputs: [
      { key: "upper", label: "Oben", color: "#8e24aa" },
      { key: "basis", label: "Basis", color: "#8e24aa", dashed: true },
      { key: "lower", label: "Unten", color: "#8e24aa" },
    ],
    compute: (b, p) => m.envelope(m.closes(b), p.length, p.percent),
  },
  {
    id: "ichimoku",
    name: "Ichimoku Cloud",
    category: "Trend",
    overlay: true,
    description: "Tenkan, Kijun, Senkou A/B (Wolke) und Chikou.",
    params: [
      { key: "conversion", label: "Tenkan", default: 9, min: 1, max: 200 },
      { key: "base", label: "Kijun", default: 26, min: 1, max: 200 },
      { key: "spanB", label: "Senkou B", default: 52, min: 1, max: 400 },
    ],
    outputs: [
      { key: "tenkan", label: "Tenkan", color: "#2962ff" },
      { key: "kijun", label: "Kijun", color: "#b71c1c" },
      { key: "spanA", label: "Senkou A", color: "#43a047", offset: (p) => p.base - 1 },
      { key: "spanB", label: "Senkou B", color: "#e53935", offset: (p) => p.base - 1 },
      { key: "chikou", label: "Chikou", color: "#7e57c2", offset: (p) => -(p.base - 1) },
    ],
    fills: [{ upper: "spanA", lower: "spanB", color: "rgba(67,160,71,0.12)", colorBelow: "rgba(229,57,53,0.12)" }],
    compute: (b, p) => m.ichimoku(b, p.conversion, p.base, p.spanB),
  },
  {
    id: "psar",
    name: "Parabolic SAR",
    category: "Trend",
    overlay: true,
    description: "Stop-and-Reverse-Punkte nach Wilder.",
    params: [
      { key: "start", label: "Start", default: 0.02, min: 0.001, max: 1, step: 0.001 },
      { key: "increment", label: "Schritt", default: 0.02, min: 0.001, max: 1, step: 0.001 },
      { key: "maximum", label: "Maximum", default: 0.2, min: 0.01, max: 1, step: 0.01 },
    ],
    outputs: [{ key: "value", label: "SAR", color: "#2196f3", style: "dots" }],
    compute: (b, p) => ({ value: m.parabolicSar(b, p.start, p.increment, p.maximum) }),
  },
  {
    id: "supertrend",
    name: "Supertrend",
    category: "Trend",
    overlay: true,
    description: "ATR-basierter Trendfolger.",
    params: [len(10, "ATR-Länge"), { key: "mult", label: "Faktor", default: 3, min: 0.1, max: 20, step: 0.1 }],
    outputs: [
      { key: "up", label: "Aufwärts", color: "#26a69a", lineWidth: 2 },
      { key: "down", label: "Abwärts", color: "#ef5350", lineWidth: 2 },
    ],
    compute: (b, p) => m.supertrend(b, p.length, p.mult),
  },
  {
    id: "pivots",
    name: "Pivot Points (Classic)",
    short: "Pivots",
    category: "Trend",
    overlay: true,
    description: "Klassische Pivot-Punkte vom Vortag (bzw. Vorwoche bei Tageskerzen).",
    params: [],
    outputs: [
      { key: "r3", label: "R3", color: "#ef5350", dashed: true, lineWidth: 1 },
      { key: "r2", label: "R2", color: "#ef5350", dashed: true, lineWidth: 1 },
      { key: "r1", label: "R1", color: "#ef5350", dashed: true, lineWidth: 1 },
      { key: "p", label: "P", color: "#ff9800", lineWidth: 1 },
      { key: "s1", label: "S1", color: "#26a69a", dashed: true, lineWidth: 1 },
      { key: "s2", label: "S2", color: "#26a69a", dashed: true, lineWidth: 1 },
      { key: "s3", label: "S3", color: "#26a69a", dashed: true, lineWidth: 1 },
    ],
    compute: (b) => m.pivotPoints(b),
  },

  // ---------------- Volume ----------------
  {
    id: "volume",
    name: "Volumen",
    category: "Volumen",
    overlay: false,
    description: "Handelsvolumen je Kerze mit gleitendem Durchschnitt.",
    params: [len(20, "MA-Länge")],
    outputs: [
      {
        key: "volume",
        label: "Volumen",
        color: "#26a69a",
        style: "histogram",
        pointColor: ({ bar }) => (bar.close >= bar.open ? "rgba(38,166,154,0.5)" : "rgba(239,83,80,0.5)"),
      },
      { key: "ma", label: "MA", color: "#2962ff" },
    ],
    compute: (b, p) => {
      const v = b.map((x) => x.volume);
      return { volume: v, ma: m.sma(v, p.length) };
    },
  },
  {
    id: "obv",
    name: "On Balance Volume (OBV)",
    category: "Volumen",
    overlay: false,
    description: "Kumuliertes Volumen nach Kursrichtung.",
    params: [],
    outputs: [{ key: "value", label: "OBV", color: "#2962ff" }],
    compute: (b) => ({ value: m.obv(b) }),
  },
  {
    id: "mfi",
    name: "Money Flow Index (MFI)",
    category: "Volumen",
    overlay: false,
    description: "Volumengewichteter RSI.",
    params: [len(14)],
    outputs: [{ key: "value", label: "MFI", color: "#7e57c2" }],
    levels: [20, 80],
    compute: (b, p) => ({ value: m.mfi(b, p.length) }),
  },
  {
    id: "cmf",
    name: "Chaikin Money Flow (CMF)",
    category: "Volumen",
    overlay: false,
    description: "Kauf-/Verkaufsdruck über n Kerzen.",
    params: [len(20)],
    outputs: [{ key: "value", label: "CMF", color: "#43a047" }],
    levels: [0],
    compute: (b, p) => ({ value: m.cmf(b, p.length) }),
  },

  // ---------------- Momentum ----------------
  {
    id: "rsi",
    name: "Relative Strength Index (RSI)",
    category: "Momentum",
    overlay: false,
    description: "Momentum-Oszillator 0–100, überkauft >70, überverkauft <30.",
    params: [len(14), { key: "maLength", label: "MA-Länge", default: 14, min: 1, max: 200 }],
    outputs: [
      { key: "value", label: "RSI", color: "#7e57c2" },
      { key: "ma", label: "MA", color: "#ffeb3b", lineWidth: 1 },
    ],
    levels: [30, 50, 70],
    compute: (b, p) => {
      const value = m.rsi(m.closes(b), p.length);
      return { value, ma: m.sma(value, p.maLength) };
    },
  },
  {
    id: "macd",
    name: "MACD",
    category: "Momentum",
    overlay: false,
    description: "Differenz zweier EMAs mit Signallinie und Histogramm.",
    params: [
      { key: "fast", label: "Schnell", default: 12, min: 1, max: 200 },
      { key: "slow", label: "Langsam", default: 26, min: 1, max: 400 },
      { key: "signal", label: "Signal", default: 9, min: 1, max: 200 },
    ],
    outputs: [
      { key: "histogram", label: "Histogramm", color: "#26a69a", style: "histogram", pointColor: risingFalling("#26a69a", "#b2dfdb", "#ffcdd2", "#ef5350") },
      { key: "macd", label: "MACD", color: "#2962ff" },
      { key: "signal", label: "Signal", color: "#ff6d00" },
    ],
    levels: [0],
    compute: (b, p) => m.macd(m.closes(b), p.fast, p.slow, p.signal),
  },
  {
    id: "stoch",
    name: "Stochastic",
    category: "Momentum",
    overlay: false,
    description: "Position des Schlusskurses in der Spanne der letzten n Kerzen.",
    params: [
      { key: "k", label: "%K Länge", default: 14, min: 1, max: 200 },
      { key: "smooth", label: "%K Glättung", default: 3, min: 1, max: 50 },
      { key: "d", label: "%D Länge", default: 3, min: 1, max: 50 },
    ],
    outputs: [
      { key: "k", label: "%K", color: "#2962ff" },
      { key: "d", label: "%D", color: "#ff6d00" },
    ],
    levels: [20, 80],
    compute: (b, p) => m.stochastic(b, p.k, p.smooth, p.d),
  },
  {
    id: "stochrsi",
    name: "Stochastic RSI",
    category: "Momentum",
    overlay: false,
    description: "Stochastik angewendet auf den RSI.",
    params: [
      { key: "rsiLength", label: "RSI-Länge", default: 14, min: 1, max: 200 },
      { key: "stochLength", label: "Stoch-Länge", default: 14, min: 1, max: 200 },
      { key: "k", label: "%K", default: 3, min: 1, max: 50 },
      { key: "d", label: "%D", default: 3, min: 1, max: 50 },
    ],
    outputs: [
      { key: "k", label: "%K", color: "#2962ff" },
      { key: "d", label: "%D", color: "#ff6d00" },
    ],
    levels: [20, 80],
    compute: (b, p) => m.stochRsi(m.closes(b), p.rsiLength, p.stochLength, p.k, p.d),
  },
  {
    id: "cci",
    name: "Commodity Channel Index (CCI)",
    category: "Momentum",
    overlay: false,
    description: "Abweichung des Typical Price vom Mittel.",
    params: [len(20)],
    outputs: [{ key: "value", label: "CCI", color: "#00897b" }],
    levels: [-100, 0, 100],
    compute: (b, p) => ({ value: m.cci(b, p.length) }),
  },
  {
    id: "willr",
    name: "Williams %R",
    category: "Momentum",
    overlay: false,
    description: "Wie Stochastik, Skala 0 bis -100.",
    params: [len(14)],
    outputs: [{ key: "value", label: "%R", color: "#8e24aa" }],
    levels: [-80, -20],
    compute: (b, p) => ({ value: m.williamsR(b, p.length) }),
  },
  {
    id: "roc",
    name: "Rate of Change (ROC)",
    category: "Momentum",
    overlay: false,
    description: "Prozentuale Veränderung gegenüber vor n Kerzen.",
    params: [len(9)],
    outputs: [{ key: "value", label: "ROC", color: "#1e88e5" }],
    levels: [0],
    compute: (b, p) => ({ value: m.roc(m.closes(b), p.length) }),
  },
  {
    id: "mom",
    name: "Momentum",
    category: "Momentum",
    overlay: false,
    description: "Kursdifferenz zu vor n Kerzen.",
    params: [len(10)],
    outputs: [{ key: "value", label: "MOM", color: "#3949ab" }],
    levels: [0],
    compute: (b, p) => ({ value: m.momentum(m.closes(b), p.length) }),
  },
  {
    id: "ao",
    name: "Awesome Oscillator",
    category: "Momentum",
    overlay: false,
    description: "SMA(5) − SMA(34) des Medianpreises.",
    params: [
      { key: "fast", label: "Schnell", default: 5, min: 1, max: 100 },
      { key: "slow", label: "Langsam", default: 34, min: 1, max: 300 },
    ],
    outputs: [
      {
        key: "value",
        label: "AO",
        color: "#26a69a",
        style: "histogram",
        pointColor: ({ values, i }) => {
          const prev = prevOf(values, i);
          return prev === null || prev === undefined || (values[i] as number) >= prev ? "#26a69a" : "#ef5350";
        },
      },
    ],
    levels: [0],
    compute: (b, p) => ({ value: m.awesomeOscillator(b, p.fast, p.slow) }),
  },
  {
    id: "trix",
    name: "TRIX",
    category: "Momentum",
    overlay: false,
    description: "Änderungsrate einer dreifach geglätteten EMA.",
    params: [len(18)],
    outputs: [{ key: "value", label: "TRIX", color: "#d81b60" }],
    levels: [0],
    compute: (b, p) => ({ value: m.trix(m.closes(b), p.length) }),
  },
  {
    id: "adx",
    name: "ADX / DMI",
    category: "Trend",
    overlay: false,
    description: "Trendstärke (ADX) mit +DI / −DI.",
    params: [len(14)],
    outputs: [
      { key: "adx", label: "ADX", color: "#ff6d00", lineWidth: 2 },
      { key: "plusDI", label: "+DI", color: "#26a69a" },
      { key: "minusDI", label: "−DI", color: "#ef5350" },
    ],
    levels: [20, 25],
    compute: (b, p) => m.adx(b, p.length),
  },

  // ---------------- Volatility ----------------
  {
    id: "atr",
    name: "Average True Range (ATR)",
    category: "Volatilität",
    overlay: false,
    description: "Durchschnittliche Schwankungsbreite (Wilder).",
    params: [len(14)],
    outputs: [{ key: "value", label: "ATR", color: "#b71c1c" }],
    compute: (b, p) => ({ value: m.atr(b, p.length) }),
  },
  {
    id: "bbw",
    name: "Bollinger Band Width",
    category: "Volatilität",
    overlay: false,
    description: "Relative Breite der Bollinger Bänder (Squeeze-Erkennung).",
    params: [len(20), { key: "mult", label: "StdAbw", default: 2, min: 0.1, max: 10, step: 0.1 }],
    outputs: [{ key: "value", label: "BBW", color: "#2962ff" }],
    compute: (b, p) => {
      const bb = m.bollinger(m.closes(b), p.length, p.mult);
      return { value: bb.basis.map((x, i) => (x === null || x === 0 ? null : ((bb.upper[i] as number) - (bb.lower[i] as number)) / x)) };
    },
  },
  {
    id: "stdev",
    name: "Standardabweichung",
    category: "Volatilität",
    overlay: false,
    description: "Standardabweichung der Schlusskurse.",
    params: [len(20)],
    outputs: [{ key: "value", label: "StdAbw", color: "#6d4c41" }],
    compute: (b, p) => ({ value: m.stdev(m.closes(b), p.length) }),
  },
  // ---------------- More moving averages ----------------
  {
    id: "dema",
    name: "Double EMA (DEMA)",
    category: "Gleitende Durchschnitte",
    overlay: true,
    description: "Doppelt exponentieller Durchschnitt mit weniger Verzögerung.",
    params: [len(21)],
    outputs: [{ key: "value", label: "DEMA", color: "#00e676" }],
    compute: (b, p) => ({ value: m.dema(m.closes(b), p.length) }),
  },
  {
    id: "tema",
    name: "Triple EMA (TEMA)",
    category: "Gleitende Durchschnitte",
    overlay: true,
    description: "Dreifach exponentieller Durchschnitt, sehr reaktionsschnell.",
    params: [len(21)],
    outputs: [{ key: "value", label: "TEMA", color: "#ff4081" }],
    compute: (b, p) => ({ value: m.tema(m.closes(b), p.length) }),
  },
  {
    id: "smma",
    name: "Smoothed MA (SMMA / RMA)",
    short: "SMMA",
    category: "Gleitende Durchschnitte",
    overlay: true,
    description: "Geglätteter Durchschnitt nach Wilder.",
    params: [len(14)],
    outputs: [{ key: "value", label: "SMMA", color: "#8d6e63" }],
    compute: (b, p) => ({ value: m.rma(m.closes(b), p.length) }),
  },
  {
    id: "kama",
    name: "Kaufman Adaptive MA (KAMA)",
    category: "Gleitende Durchschnitte",
    overlay: true,
    description: "Passt die Glättung an die Effizienz der Bewegung an; flach in Seitwärtsphasen.",
    params: [len(10), { key: "fast", label: "Schnell", default: 2, min: 1, max: 50 }, { key: "slow", label: "Langsam", default: 30, min: 2, max: 200 }],
    outputs: [{ key: "value", label: "KAMA", color: "#ab47bc" }],
    compute: (b, p) => ({ value: m.kama(m.closes(b), p.length, p.fast, p.slow) }),
  },
  {
    id: "alma",
    name: "Arnaud Legoux MA (ALMA)",
    category: "Gleitende Durchschnitte",
    overlay: true,
    description: "Gauß-gewichteter Durchschnitt mit wenig Verzögerung und Rauschen.",
    params: [
      len(9),
      { key: "offset", label: "Offset", default: 0.85, min: 0, max: 1, step: 0.01 },
      { key: "sigma", label: "Sigma", default: 6, min: 0.5, max: 20, step: 0.5 },
    ],
    outputs: [{ key: "value", label: "ALMA", color: "#26c6da" }],
    compute: (b, p) => ({ value: m.alma(m.closes(b), p.length, p.offset, p.sigma) }),
  },
  {
    id: "lsma",
    name: "Least Squares MA (LSMA)",
    category: "Gleitende Durchschnitte",
    overlay: true,
    description: "Endpunkt der linearen Regression über n Kerzen.",
    params: [len(25)],
    outputs: [{ key: "value", label: "LSMA", color: "#ffa726" }],
    compute: (b, p) => ({ value: m.linreg(m.closes(b), p.length) }),
  },
  {
    id: "mcginley",
    name: "McGinley Dynamic",
    category: "Gleitende Durchschnitte",
    overlay: true,
    description: "Selbstanpassender Durchschnitt, der dem Kurs eng folgt.",
    params: [len(14)],
    outputs: [{ key: "value", label: "McGinley", color: "#7cb342" }],
    compute: (b, p) => ({ value: m.mcginley(m.closes(b), p.length) }),
  },
  {
    id: "emaribbon",
    name: "EMA Ribbon (8/13/21/34/55)",
    short: "EMA Ribbon",
    category: "Gleitende Durchschnitte",
    overlay: true,
    description: "Fächer aus fünf Fibonacci-EMAs; geordnete Fächer zeigen starke Trends.",
    params: [],
    outputs: [
      { key: "e8", label: "EMA 8", color: "#00e676", lineWidth: 1 },
      { key: "e13", label: "EMA 13", color: "#76ff03", lineWidth: 1 },
      { key: "e21", label: "EMA 21", color: "#ffeb3b", lineWidth: 1 },
      { key: "e34", label: "EMA 34", color: "#ff9100", lineWidth: 1 },
      { key: "e55", label: "EMA 55", color: "#ff1744", lineWidth: 1 },
    ],
    compute: (b) => {
      const c = m.closes(b);
      return { e8: m.ema(c, 8), e13: m.ema(c, 13), e21: m.ema(c, 21), e34: m.ema(c, 34), e55: m.ema(c, 55) };
    },
  },
  {
    id: "macross",
    name: "MA Cross (Golden / Death Cross)",
    short: "MA Cross",
    category: "Gleitende Durchschnitte",
    overlay: true,
    description: "SMA 50 und SMA 200; Kreuzung nach oben = Golden Cross, nach unten = Death Cross.",
    params: [
      { key: "fast", label: "Schnell", default: 50, min: 1, max: 500 },
      { key: "slow", label: "Langsam", default: 200, min: 2, max: 1000 },
    ],
    outputs: [
      { key: "fast", label: "Schnell", color: "#ffeb3b", lineWidth: 2 },
      { key: "slow", label: "Langsam", color: "#e040fb", lineWidth: 2 },
    ],
    compute: (b, p) => ({ fast: m.sma(m.closes(b), p.fast), slow: m.sma(m.closes(b), p.slow) }),
  },

  // ---------------- Bands, stops, structure ----------------
  {
    id: "vwapbands",
    name: "VWAP mit Bändern",
    category: "Volumen",
    overlay: true,
    description: "Tages-VWAP (UTC) mit volumengewichteten Standardabweichungsbändern.",
    params: [
      { key: "mult1", label: "Band 1", default: 1, min: 0.1, max: 5, step: 0.1 },
      { key: "mult2", label: "Band 2", default: 2, min: 0.1, max: 5, step: 0.1 },
    ],
    outputs: [
      { key: "upper2", label: "+2σ", color: "#ef5350", dashed: true, lineWidth: 1 },
      { key: "upper1", label: "+1σ", color: "#ff9800", lineWidth: 1 },
      { key: "vwap", label: "VWAP", color: "#e91e63", lineWidth: 2 },
      { key: "lower1", label: "−1σ", color: "#26a69a", lineWidth: 1 },
      { key: "lower2", label: "−2σ", color: "#2962ff", dashed: true, lineWidth: 1 },
    ],
    fills: [{ upper: "upper1", lower: "lower1", color: "rgba(233,30,99,0.06)" }],
    compute: (b, p) => m.vwapBands(b, p.mult1, p.mult2),
  },
  {
    id: "avwap",
    name: "Anchored VWAP",
    category: "Volumen",
    overlay: true,
    description: "VWAP ab einem Ankerpunkt n Kerzen vor der letzten Kerze (z. B. Swing-Tief oder Ereignis).",
    params: [{ key: "barsBack", label: "Anker (Kerzen zurück)", default: 100, min: 2, max: 1000 }],
    outputs: [{ key: "value", label: "AVWAP", color: "#ff6d00", lineWidth: 2 }],
    compute: (b, p) => ({ value: m.anchoredVwap(b, p.barsBack) }),
  },
  {
    id: "chandelier",
    name: "Chandelier Exit",
    category: "Trend",
    overlay: true,
    description: "ATR-Trailing-Stop vom höchsten/tiefsten Schlusskurs; Wechsel signalisiert Trendumkehr.",
    params: [len(22, "ATR-Länge"), { key: "mult", label: "Faktor", default: 3, min: 0.1, max: 10, step: 0.1 }],
    outputs: [
      { key: "long", label: "Long-Stop", color: "#26a69a", style: "dots" },
      { key: "short", label: "Short-Stop", color: "#ef5350", style: "dots" },
    ],
    compute: (b, p) => m.chandelierExit(b, p.length, p.mult),
  },
  {
    id: "alligator",
    name: "Williams Alligator",
    category: "Trend",
    overlay: true,
    description: "Drei verschobene SMMAs (Kiefer, Zähne, Lippen); verschlungen = Seitwärts, gefächert = Trend.",
    params: [
      { key: "jaw", label: "Kiefer", default: 13, min: 1, max: 100 },
      { key: "teeth", label: "Zähne", default: 8, min: 1, max: 100 },
      { key: "lips", label: "Lippen", default: 5, min: 1, max: 100 },
    ],
    outputs: [
      { key: "jaw", label: "Kiefer", color: "#2962ff", offset: () => 8 },
      { key: "teeth", label: "Zähne", color: "#e91e63", offset: () => 5 },
      { key: "lips", label: "Lippen", color: "#66bb6a", offset: () => 3 },
    ],
    compute: (b, p) => m.alligator(b, p.jaw, p.teeth, p.lips),
  },
  {
    id: "fractals",
    name: "Williams Fractals",
    category: "Trend",
    overlay: true,
    description: "Lokale Hochs/Tiefs mit n niedrigeren Hochs bzw. höheren Tiefs auf beiden Seiten.",
    params: [{ key: "n", label: "Perioden", default: 2, min: 1, max: 10 }],
    outputs: [
      { key: "up", label: "Hoch", color: "#ef5350", style: "dots" },
      { key: "down", label: "Tief", color: "#26a69a", style: "dots" },
    ],
    compute: (b, p) => m.fractals(b, p.n),
  },
  {
    id: "zigzag",
    name: "ZigZag",
    category: "Trend",
    overlay: true,
    description: "Verbindet Swing-Hochs und -Tiefs, die sich um mindestens x % umkehren.",
    params: [{ key: "pct", label: "Abweichung %", default: 5, min: 0.1, max: 50, step: 0.1 }],
    outputs: [{ key: "value", label: "ZigZag", color: "#ffeb3b", lineWidth: 2 }],
    compute: (b, p) => ({ value: m.zigzag(b, p.pct) }),
  },
  {
    id: "linregchannel",
    name: "Lineare Regression (Kanal)",
    short: "LinReg-Kanal",
    category: "Trend",
    overlay: true,
    description: "Regressionsgerade über die letzten n Kerzen mit ± n Standardabweichungen.",
    params: [len(100), { key: "dev", label: "StdAbw", default: 2, min: 0.1, max: 5, step: 0.1 }],
    outputs: [
      { key: "upper", label: "Oben", color: "#2962ff" },
      { key: "basis", label: "Basis", color: "#ef5350", dashed: true },
      { key: "lower", label: "Unten", color: "#2962ff" },
    ],
    fills: [{ upper: "upper", lower: "lower", color: "rgba(41,98,255,0.07)" }],
    compute: (b, p) => m.linRegChannel(m.closes(b), p.length, p.dev),
  },
  {
    id: "vpvr",
    name: "Volume Profile (Fixed Range)",
    short: "VP",
    category: "Volumen",
    overlay: true,
    description: "Volumen je Preisniveau der letzten n Kerzen mit POC und Value Area (VAH/VAL).",
    params: [
      { key: "lookback", label: "Kerzen", default: 300, min: 20, max: 1000 },
      { key: "rows", label: "Zeilen", default: 30, min: 5, max: 100 },
      { key: "valueArea", label: "Value Area %", default: 70, min: 10, max: 95 },
    ],
    outputs: [
      { key: "vah", label: "VAH", color: "#2962ff", dashed: true, lineWidth: 1 },
      { key: "poc", label: "POC", color: "#ff9800", lineWidth: 2 },
      { key: "val", label: "VAL", color: "#2962ff", dashed: true, lineWidth: 1 },
    ],
    profile: (b, p) => m.volumeProfile(b, p.lookback, p.rows, p.valueArea),
    compute: (b, p) => {
      const vp = m.volumeProfile(b, p.lookback, p.rows, p.valueArea);
      const line = (v: number) => b.map((_, i) => (vp && i >= vp.fromIndex ? v : null));
      return vp ? { poc: line(vp.poc), vah: line(vp.vah), val: line(vp.val) } : { poc: line(0), vah: line(0), val: line(0) };
    },
  },

  // ---------------- Crypto cycle indicators ----------------
  {
    id: "bmsb",
    name: "Bull Market Support Band",
    category: "Krypto",
    overlay: true,
    description: "20-Wochen-SMA und 21-Wochen-EMA (aus Wochenkerzen berechnet). Halten darüber gilt als Bullenmarkt. Am besten auf 1D/1W.",
    params: [],
    outputs: [
      { key: "sma", label: "20W SMA", color: "#f44336", lineWidth: 2 },
      { key: "ema", label: "21W EMA", color: "#4caf50", lineWidth: 2 },
    ],
    fills: [{ upper: "sma", lower: "ema", color: "rgba(255,152,0,0.18)" }],
    compute: (b) => ({
      sma: m.onHigherTimeframe(b, 604800, (c) => m.smaLast(c, 20)),
      ema: m.onHigherTimeframe(b, 604800, (c) => m.emaLast(c, 21)),
    }),
  },
  {
    id: "picycle",
    name: "Pi Cycle Top",
    category: "Krypto",
    overlay: true,
    description: "111-Tage-SMA und 2 × 350-Tage-SMA (aus Tageskerzen). Ein Kreuzen der 111er nach oben fiel historisch mit BTC-Zyklushochs zusammen. Am besten auf 1D.",
    params: [],
    outputs: [
      { key: "fast", label: "111D SMA", color: "#ff9800", lineWidth: 2 },
      { key: "slow", label: "350D SMA × 2", color: "#26a69a", lineWidth: 2, noAutoscale: true },
    ],
    compute: (b) => ({
      fast: m.onHigherTimeframe(b, 86400, (c) => m.smaLast(c, 111)),
      slow: m.onHigherTimeframe(b, 86400, (c) => {
        const v = m.smaLast(c, 350);
        return v === null ? null : 2 * v;
      }),
    }),
  },
  {
    id: "mayer",
    name: "Mayer Multiple",
    category: "Krypto",
    overlay: false,
    description: "Kurs geteilt durch die 200-Tage-SMA. Unter 1 historisch günstig, über 2,4 überhitzt.",
    params: [],
    outputs: [{ key: "value", label: "Mayer", color: "#ff9800", lineWidth: 2 }],
    levels: [0.8, 1, 2.4],
    compute: (b) => {
      const ma = m.onHigherTimeframe(b, 86400, (c) => m.smaLast(c, 200));
      return { value: b.map((x, i) => (ma[i] ? x.close / (ma[i] as number) : null)) };
    },
  },
  {
    id: "liqheatmap",
    name: "Liquidations-Heatmap (geschätzt)",
    short: "Liq-Heatmap",
    category: "Krypto",
    overlay: true,
    description:
      "Geschätzte Liquidationsniveaus wie bei CoinGlass: aus Volumen, Taker-Käufen und 10×–100× Hebel. Helle Zonen = viele offene Liquidationen; Linien = stärkster Cluster unter (Longs) und über (Shorts) dem Kurs.",
    params: [
      { key: "lookback", label: "Kerzen", default: 300, min: 50, max: 1000 },
      { key: "rows", label: "Preisstufen", default: 120, min: 30, max: 300 },
      { key: "contrast", label: "Kontrast", default: 0.6, min: 0.2, max: 2, step: 0.1 },
    ],
    outputs: [
      { key: "below", label: "Long-Liq-Cluster", color: "#26a69a", dashed: true, lineWidth: 1, noAutoscale: true },
      { key: "above", label: "Short-Liq-Cluster", color: "#ef5350", dashed: true, lineWidth: 1, noAutoscale: true },
    ],
    heatmap: (b, p) => liquidationHeatmap(b, p.lookback, p.rows),
    heatmapContrastKey: "contrast",
    compute: (b, p) => {
      const hm = liquidationHeatmap(b, p.lookback, p.rows);
      if (!hm) return { below: b.map(() => null), above: b.map(() => null) };
      return strongestLevels(b, hm);
    },
  },
  {
    id: "cvd",
    name: "Cumulative Volume Delta (CVD)",
    category: "Krypto",
    overlay: false,
    description: "Kumulierte Differenz aus Kauf- und Verkaufsvolumen (Binance-Taker-Volumen, sonst geschätzt).",
    params: [{ key: "daily", label: "Täglich zurücksetzen (0/1)", default: 0, min: 0, max: 1 }],
    outputs: [{ key: "value", label: "CVD", color: "#00bcd4", lineWidth: 2 }],
    levels: [0],
    compute: (b, p) => ({ value: m.cvd(b, p.daily >= 1) }),
  },
  {
    id: "delta",
    name: "Volume Delta",
    category: "Krypto",
    overlay: false,
    description: "Kauf- minus Verkaufsvolumen je Kerze (Binance-Taker-Volumen, sonst geschätzt).",
    params: [],
    outputs: [
      {
        key: "value",
        label: "Delta",
        color: "#26a69a",
        style: "histogram",
        pointColor: ({ values, i }) => ((values[i] as number) >= 0 ? "rgba(38,166,154,0.8)" : "rgba(239,83,80,0.8)"),
      },
    ],
    compute: (b) => ({ value: m.volumeDelta(b) }),
  },

  // ---------------- Momentum ----------------
  {
    id: "wavetrend",
    name: "WaveTrend Oscillator (LazyBear)",
    short: "WaveTrend",
    category: "Momentum",
    overlay: false,
    description: "Beliebter Krypto-Oszillator; Kreuzungen in den Extremzonen (±60) gelten als Signale.",
    params: [
      { key: "channel", label: "Kanal", default: 10, min: 1, max: 100 },
      { key: "average", label: "Durchschnitt", default: 21, min: 1, max: 100 },
    ],
    outputs: [
      { key: "diff", label: "Differenz", color: "rgba(41,98,255,0.5)", style: "histogram" },
      { key: "wt1", label: "WT1", color: "#26a69a", lineWidth: 2 },
      { key: "wt2", label: "WT2", color: "#ef5350", lineWidth: 1 },
    ],
    levels: [-60, -53, 0, 53, 60],
    compute: (b, p) => m.waveTrend(b, p.channel, p.average),
  },
  {
    id: "squeeze",
    name: "Squeeze Momentum (LazyBear)",
    short: "SQZMOM",
    category: "Momentum",
    overlay: false,
    description: "Bollinger in Keltner = Squeeze (graue Punkte). Histogramm zeigt Richtung und Stärke des Ausbruchs.",
    params: [
      len(20),
      { key: "bbMult", label: "BB-Faktor", default: 2, min: 0.1, max: 5, step: 0.1 },
      { key: "kcMult", label: "KC-Faktor", default: 1.5, min: 0.1, max: 5, step: 0.1 },
    ],
    outputs: [
      { key: "momentum", label: "Momentum", color: "#26a69a", style: "histogram", pointColor: risingFalling("#00e676", "#1b5e20", "#b71c1c", "#ff1744") },
      {
        key: "squeeze",
        label: "Squeeze",
        color: "#787b86",
        style: "dots",
        pointColor: ({ outputs, i }) => (outputs.state[i] === 1 ? "#d1d4dc" : "#2962ff"),
      },
    ],
    compute: (b, p) => {
      const r = m.squeezeMomentum(b, p.length, p.bbMult, p.kcMult);
      // Dots sit on the zero line; `state` (1 = squeeze on) only drives their color.
      return { momentum: r.momentum, squeeze: r.squeeze.map((v) => (v === null ? null : 0)), state: r.squeeze };
    },
  },
  {
    id: "uo",
    name: "Ultimate Oscillator",
    category: "Momentum",
    overlay: false,
    description: "Gewichtetes Kaufdruck-Verhältnis über drei Zeiträume.",
    params: [
      { key: "fast", label: "Schnell", default: 7, min: 1, max: 100 },
      { key: "mid", label: "Mittel", default: 14, min: 1, max: 100 },
      { key: "slow", label: "Langsam", default: 28, min: 1, max: 200 },
    ],
    outputs: [{ key: "value", label: "UO", color: "#f44336" }],
    levels: [30, 50, 70],
    compute: (b, p) => ({ value: m.ultimateOscillator(b, p.fast, p.mid, p.slow) }),
  },
  {
    id: "kdj",
    name: "KDJ",
    category: "Momentum",
    overlay: false,
    description: "Stochastik-Variante mit J-Linie (3K − 2D), verbreitet bei Binance & Co.",
    params: [len(9), { key: "m1", label: "K-Glättung", default: 3, min: 1, max: 20 }, { key: "m2", label: "D-Glättung", default: 3, min: 1, max: 20 }],
    outputs: [
      { key: "k", label: "K", color: "#ffffff" },
      { key: "d", label: "D", color: "#ffeb3b" },
      { key: "j", label: "J", color: "#e040fb" },
    ],
    levels: [20, 80],
    compute: (b, p) => m.kdj(b, p.length, p.m1, p.m2),
  },
  {
    id: "aroon",
    name: "Aroon",
    category: "Trend",
    overlay: false,
    description: "Wie lange das letzte Hoch/Tief zurückliegt; Kreuzungen zeigen Trendwechsel.",
    params: [len(14)],
    outputs: [
      { key: "up", label: "Aroon Up", color: "#ff9800" },
      { key: "down", label: "Aroon Down", color: "#2962ff" },
    ],
    levels: [30, 70],
    compute: (b, p) => m.aroon(b, p.length),
  },
  {
    id: "vortex",
    name: "Vortex Indicator",
    category: "Trend",
    overlay: false,
    description: "VI+ über VI− = Aufwärtstrend und umgekehrt.",
    params: [len(14)],
    outputs: [
      { key: "plus", label: "VI+", color: "#26a69a" },
      { key: "minus", label: "VI−", color: "#ef5350" },
    ],
    levels: [1],
    compute: (b, p) => m.vortex(b, p.length),
  },
  {
    id: "fisher",
    name: "Fisher Transform",
    category: "Momentum",
    overlay: false,
    description: "Wandelt Kurse in eine annähernde Normalverteilung; scharfe Wendepunkte.",
    params: [len(9)],
    outputs: [
      { key: "fisher", label: "Fisher", color: "#2962ff" },
      { key: "trigger", label: "Trigger", color: "#ff6d00" },
    ],
    levels: [-1.5, 0, 1.5],
    compute: (b, p) => m.fisherTransform(b, p.length),
  },
  {
    id: "crsi",
    name: "Connors RSI",
    category: "Momentum",
    overlay: false,
    description: "Mittel aus RSI, RSI der Serienlänge und Perzentilrang der Tagesrendite.",
    params: [
      { key: "rsi", label: "RSI", default: 3, min: 1, max: 50 },
      { key: "streak", label: "Serie", default: 2, min: 1, max: 50 },
      { key: "rank", label: "Rang", default: 100, min: 5, max: 500 },
    ],
    outputs: [{ key: "value", label: "CRSI", color: "#7e57c2" }],
    levels: [10, 90],
    compute: (b, p) => ({ value: m.connorsRsi(m.closes(b), p.rsi, p.streak, p.rank) }),
  },
  {
    id: "stc",
    name: "Schaff Trend Cycle",
    category: "Momentum",
    overlay: false,
    description: "Zyklusoszillator aus MACD und doppelter Stochastik.",
    params: [
      { key: "cycle", label: "Zyklus", default: 10, min: 1, max: 100 },
      { key: "fast", label: "Schnell", default: 23, min: 1, max: 200 },
      { key: "slow", label: "Langsam", default: 50, min: 2, max: 400 },
    ],
    outputs: [{ key: "value", label: "STC", color: "#26c6da", lineWidth: 2 }],
    levels: [25, 75],
    compute: (b, p) => ({ value: m.schaffTrendCycle(m.closes(b), p.cycle, p.fast, p.slow) }),
  },
  {
    id: "ppo",
    name: "Percentage Price Oscillator (PPO)",
    category: "Momentum",
    overlay: false,
    description: "MACD in Prozent – vergleichbar über Kursniveaus und Coins.",
    params: [
      { key: "fast", label: "Schnell", default: 12, min: 1, max: 200 },
      { key: "slow", label: "Langsam", default: 26, min: 1, max: 400 },
      { key: "signal", label: "Signal", default: 9, min: 1, max: 200 },
    ],
    outputs: [
      { key: "histogram", label: "Histogramm", color: "#26a69a", style: "histogram", pointColor: risingFalling("#26a69a", "#b2dfdb", "#ffcdd2", "#ef5350") },
      { key: "ppo", label: "PPO", color: "#2962ff" },
      { key: "signal", label: "Signal", color: "#ff6d00" },
    ],
    levels: [0],
    compute: (b, p) => m.ppo(m.closes(b), p.fast, p.slow, p.signal),
  },
  {
    id: "kst",
    name: "Know Sure Thing (KST)",
    category: "Momentum",
    overlay: false,
    description: "Gewichtete Summe von vier geglätteten ROCs (Pring).",
    params: [{ key: "signal", label: "Signal", default: 9, min: 1, max: 100 }],
    outputs: [
      { key: "kst", label: "KST", color: "#26a69a" },
      { key: "signal", label: "Signal", color: "#ef5350" },
    ],
    levels: [0],
    compute: (b, p) => m.kst(m.closes(b), p.signal),
  },
  {
    id: "coppock",
    name: "Coppock Curve",
    category: "Momentum",
    overlay: false,
    description: "Langfristiges Momentum; Drehen über null gilt als Kaufsignal (Tages-/Wochenchart).",
    params: [
      { key: "wma", label: "WMA", default: 10, min: 1, max: 100 },
      { key: "long", label: "ROC lang", default: 14, min: 1, max: 100 },
      { key: "short", label: "ROC kurz", default: 11, min: 1, max: 100 },
    ],
    outputs: [{ key: "value", label: "Coppock", color: "#2962ff", style: "histogram", pointColor: risingFalling("#26a69a", "#b2dfdb", "#ffcdd2", "#ef5350") }],
    levels: [0],
    compute: (b, p) => ({ value: m.coppock(m.closes(b), p.wma, p.long, p.short) }),
  },
  {
    id: "dpo",
    name: "Detrended Price Oscillator (DPO)",
    category: "Momentum",
    overlay: false,
    description: "Entfernt den Trend, um Zyklen sichtbar zu machen (zentriert, letzte Kerzen leer).",
    params: [len(21)],
    outputs: [{ key: "value", label: "DPO", color: "#43a047" }],
    levels: [0],
    compute: (b, p) => ({ value: m.dpo(m.closes(b), p.length) }),
  },
  {
    id: "choppiness",
    name: "Choppiness Index",
    category: "Volatilität",
    overlay: false,
    description: "Über 61,8 seitwärts/choppy, unter 38,2 trendstark.",
    params: [len(14)],
    outputs: [{ key: "value", label: "CHOP", color: "#2962ff" }],
    levels: [38.2, 61.8],
    compute: (b, p) => ({ value: m.choppiness(b, p.length) }),
  },
  {
    id: "percentb",
    name: "Bollinger Bands %B",
    category: "Volatilität",
    overlay: false,
    description: "Position des Kurses innerhalb der Bollinger Bänder (0 = unteres, 1 = oberes Band).",
    params: [len(20), { key: "mult", label: "StdAbw", default: 2, min: 0.1, max: 10, step: 0.1 }],
    outputs: [{ key: "value", label: "%B", color: "#26a69a" }],
    levels: [0, 0.5, 1],
    compute: (b, p) => ({ value: m.percentB(m.closes(b), p.length, p.mult) }),
  },
  {
    id: "hv",
    name: "Historische Volatilität",
    category: "Volatilität",
    overlay: false,
    description: "Annualisierte Standardabweichung der Log-Renditen in % (365 Handelstage).",
    params: [len(20)],
    outputs: [{ key: "value", label: "HV %", color: "#ff7043" }],
    compute: (b, p) => ({ value: m.historicalVolatility(b, p.length) }),
  },

  // ---------------- Volume ----------------
  {
    id: "adl",
    name: "Accumulation/Distribution",
    category: "Volumen",
    overlay: false,
    description: "Kumuliertes Volumen gewichtet nach Schlusskurs-Lage in der Spanne.",
    params: [],
    outputs: [{ key: "value", label: "A/D", color: "#2962ff" }],
    compute: (b) => ({ value: m.adl(b) }),
  },
  {
    id: "chaikinosc",
    name: "Chaikin Oscillator",
    category: "Volumen",
    overlay: false,
    description: "EMA(3) − EMA(10) der A/D-Linie.",
    params: [
      { key: "fast", label: "Schnell", default: 3, min: 1, max: 50 },
      { key: "slow", label: "Langsam", default: 10, min: 1, max: 100 },
    ],
    outputs: [{ key: "value", label: "Chaikin", color: "#ec407a" }],
    levels: [0],
    compute: (b, p) => ({ value: m.chaikinOscillator(b, p.fast, p.slow) }),
  },
  {
    id: "efi",
    name: "Elder Force Index",
    category: "Volumen",
    overlay: false,
    description: "Kursänderung × Volumen, geglättet.",
    params: [len(13)],
    outputs: [{ key: "value", label: "EFI", color: "#ef5350" }],
    levels: [0],
    compute: (b, p) => ({ value: m.forceIndex(b, p.length) }),
  },
  {
    id: "klinger",
    name: "Klinger Oscillator",
    category: "Volumen",
    overlay: false,
    description: "Volumenfluss-Oszillator mit Signallinie.",
    params: [
      { key: "fast", label: "Schnell", default: 34, min: 1, max: 200 },
      { key: "slow", label: "Langsam", default: 55, min: 1, max: 300 },
      { key: "signal", label: "Signal", default: 13, min: 1, max: 100 },
    ],
    outputs: [
      { key: "kvo", label: "KVO", color: "#2962ff" },
      { key: "signal", label: "Signal", color: "#43a047" },
    ],
    levels: [0],
    compute: (b, p) => m.klinger(b, p.fast, p.slow, p.signal),
  },
  {
    id: "eom",
    name: "Ease of Movement",
    category: "Volumen",
    overlay: false,
    description: "Wie leicht sich der Kurs pro Volumeneinheit bewegt.",
    params: [len(14)],
    outputs: [{ key: "value", label: "EOM", color: "#43a047" }],
    levels: [0],
    compute: (b, p) => ({ value: m.easeOfMovement(b, p.length) }),
  },
  {
    id: "vo",
    name: "Volume Oscillator",
    category: "Volumen",
    overlay: false,
    description: "Prozentuale Differenz zweier Volumen-EMAs.",
    params: [
      { key: "fast", label: "Schnell", default: 5, min: 1, max: 100 },
      { key: "slow", label: "Langsam", default: 10, min: 1, max: 200 },
    ],
    outputs: [{ key: "value", label: "VO %", color: "#26a69a" }],
    levels: [0],
    compute: (b, p) => ({ value: m.volumeOscillator(b, p.fast, p.slow) }),
  },
  {
    id: "pvt",
    name: "Price Volume Trend (PVT)",
    category: "Volumen",
    overlay: false,
    description: "Kumuliertes Volumen gewichtet mit der prozentualen Kursänderung.",
    params: [],
    outputs: [{ key: "value", label: "PVT", color: "#2962ff" }],
    compute: (b) => ({ value: m.pvt(b) }),
  },
  {
    id: "rvol",
    name: "Relative Volume (RVOL)",
    category: "Volumen",
    overlay: false,
    description: "Volumen im Verhältnis zum Durchschnitt; über 2 = ungewöhnlich hohe Aktivität.",
    params: [len(20)],
    outputs: [
      {
        key: "value",
        label: "RVOL",
        color: "#26a69a",
        style: "histogram",
        pointColor: ({ values, i }) => ((values[i] as number) >= 2 ? "#ff9800" : (values[i] as number) >= 1 ? "rgba(38,166,154,0.7)" : "rgba(120,123,134,0.6)"),
      },
    ],
    levels: [1, 2],
    compute: (b, p) => ({ value: m.relativeVolume(b, p.length) }),
  },
];

export const INDICATOR_IDS = INDICATORS.map((d) => d.id) as [string, ...string[]];

export function getIndicator(id: string): IndicatorDef | undefined {
  return INDICATORS.find((d) => d.id === id);
}

export function resolveParams(def: IndicatorDef, params: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params) {
    let v = Number(params[p.key] ?? p.default);
    if (!Number.isFinite(v)) v = p.default;
    if (p.min !== undefined) v = Math.max(p.min, v);
    if (p.max !== undefined) v = Math.min(p.max, v);
    if ((p.step ?? 1) >= 1) v = Math.round(v);
    out[p.key] = v;
  }
  return out;
}

export function indicatorLabel(def: IndicatorDef, params: Record<string, number>): string {
  const short = def.short ?? def.name.match(/\(([^)]+)\)/)?.[1] ?? def.name;
  const values = def.params.map((p) => params[p.key]);
  return values.length ? `${short} ${values.join(", ")}` : short;
}
