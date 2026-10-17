import * as m from "./math.js";
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
  // Plot the value N bars to the right (positive) or left (negative) of its bar.
  offset?: (params: Record<string, number>) => number;
}

export interface IndicatorDef {
  id: string;
  name: string;
  category: "Trend" | "Momentum" | "Volatilität" | "Volumen";
  overlay: boolean;
  description: string;
  params: ParamDef[];
  outputs: OutputDef[];
  levels?: number[];
  // Shade the area between two outputs.
  fills?: { upper: string; lower: string; color: string; colorBelow?: string }[];
  compute: (bars: Bar[], p: Record<string, number>) => Record<string, Series>;
}

const len = (def = 14, label = "Länge"): ParamDef => ({ key: "length", label, default: def, min: 1, max: 500, step: 1 });

export const INDICATORS: IndicatorDef[] = [
  // ---------------- Trend / overlays ----------------
  {
    id: "sma",
    name: "Simple Moving Average (SMA)",
    category: "Trend",
    overlay: true,
    description: "Arithmetischer Durchschnitt der Schlusskurse.",
    params: [len(20)],
    outputs: [{ key: "value", label: "SMA", color: "#2962ff" }],
    compute: (b, p) => ({ value: m.sma(m.closes(b), p.length) }),
  },
  {
    id: "ema",
    name: "Exponential Moving Average (EMA)",
    category: "Trend",
    overlay: true,
    description: "Exponentiell gewichteter Durchschnitt, reagiert schneller als SMA.",
    params: [len(21)],
    outputs: [{ key: "value", label: "EMA", color: "#ff9800" }],
    compute: (b, p) => ({ value: m.ema(m.closes(b), p.length) }),
  },
  {
    id: "wma",
    name: "Weighted Moving Average (WMA)",
    category: "Trend",
    overlay: true,
    description: "Linear gewichteter Durchschnitt.",
    params: [len(20)],
    outputs: [{ key: "value", label: "WMA", color: "#9c27b0" }],
    compute: (b, p) => ({ value: m.wma(m.closes(b), p.length) }),
  },
  {
    id: "hma",
    name: "Hull Moving Average (HMA)",
    category: "Trend",
    overlay: true,
    description: "Glatter, verzögerungsarmer Durchschnitt nach Alan Hull.",
    params: [len(21)],
    outputs: [{ key: "value", label: "HMA", color: "#00bcd4" }],
    compute: (b, p) => ({ value: m.hma(m.closes(b), p.length) }),
  },
  {
    id: "vwma",
    name: "Volume Weighted Moving Average (VWMA)",
    category: "Trend",
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
      { key: "volume", label: "Volumen", color: "#26a69a", style: "histogram" },
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
    params: [len(14)],
    outputs: [{ key: "value", label: "RSI", color: "#7e57c2" }],
    levels: [30, 50, 70],
    compute: (b, p) => ({ value: m.rsi(m.closes(b), p.length) }),
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
      { key: "histogram", label: "Histogramm", color: "#26a69a", style: "histogram" },
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
    outputs: [{ key: "value", label: "AO", color: "#26a69a", style: "histogram" }],
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
  const short = def.name.match(/\(([^)]+)\)/)?.[1] ?? def.name;
  const values = def.params.map((p) => params[p.key]);
  return values.length ? `${short} ${values.join(", ")}` : short;
}
