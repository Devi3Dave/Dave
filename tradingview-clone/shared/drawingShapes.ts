import type { Bar } from "./math.js";

/**
 * Drawing tools beyond the basic lines, after TradingView's drawing toolbar
 * (TradingView Help Center, "Drawing tools available on TradingView": tradingview.com/support/solutions/43000703396).
 * Every tool is a list of tapped points; the geometry below says what is drawn from them.
 */

export interface ShapePoint {
  time: number;
  price: number;
}

export type ShapeGroup = "Linien" | "Fibonacci & Gann" | "Muster" | "Prognose & Messen" | "Formen" | "Beschriftung";

export const SHAPE_KINDS = [
  "hray",
  "crossline",
  "trendangle",
  "arrowline",
  "pitchfork",
  "schiff",
  "modschiff",
  "regression",
  "fibchannel",
  "fibtimezone",
  "fibfan",
  "fibcircles",
  "fibarcs",
  "gannbox",
  "gannfan",
  "xabcd",
  "cypher",
  "abcd",
  "headshoulders",
  "trianglepattern",
  "threedrives",
  "elliott5",
  "elliottabc",
  "elliotttri",
  "elliottwxy",
  "pricerange",
  "daterange",
  "avwap",
  "circle",
  "ellipse",
  "triangle",
  "callout",
  "note",
  "pricelabel",
  "arrowup",
  "arrowdown",
  "emoji",
] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

export interface ShapeDef {
  id: ShapeKind;
  name: string;
  group: ShapeGroup;
  icon: string;
  /** Taps needed to place it. */
  points: number;
  /** What to tap next, one entry per point (shown under the chart). */
  hints: string[];
  /** Asks for a text after the last tap. */
  text?: "text" | "emoji";
  color: string;
  tip: string;
}

const pts = (...names: string[]) => names.map((n) => `${n} antippen`);

export const SHAPES: ShapeDef[] = [
  { id: "hray", name: "Horizontaler Strahl", group: "Linien", icon: "⊢", points: 1, hints: pts("Startpunkt"), color: "#ff9800", tip: "Waagrechte Linie ab einem Punkt nach rechts" },
  { id: "crossline", name: "Fadenkreuzlinie", group: "Linien", icon: "┼", points: 1, hints: pts("Punkt"), color: "#787b86", tip: "Waagrechte und senkrechte Linie durch einen Punkt" },
  { id: "trendangle", name: "Trendwinkel", group: "Linien", icon: "∠", points: 2, hints: pts("Start", "Ende"), color: "#2962ff", tip: "Trendlinie mit Winkel in Grad (auf dem Bildschirm)" },
  { id: "arrowline", name: "Pfeil", group: "Linien", icon: "➚", points: 2, hints: pts("Start", "Pfeilspitze"), color: "#2962ff", tip: "Linie mit Pfeilspitze" },
  { id: "pitchfork", name: "Pitchfork (Andrews)", group: "Linien", icon: "⋔", points: 3, hints: pts("Startpunkt (Pivot)", "erstes Reaktionshoch/-tief", "zweites Reaktionstief/-hoch"), color: "#2962ff", tip: "Mittellinie vom Pivot zur Mitte von Punkt 2 und 3, Parallelen durch 2 und 3" },
  { id: "schiff", name: "Schiff-Pitchfork", group: "Linien", icon: "⋔", points: 3, hints: pts("Startpunkt (Pivot)", "erstes Reaktionshoch/-tief", "zweites Reaktionstief/-hoch"), color: "#00bcd4", tip: "Wie Pitchfork, Start auf halber Preishöhe zwischen Punkt 1 und 2" },
  { id: "modschiff", name: "Modifizierte Schiff-Pitchfork", group: "Linien", icon: "⋔", points: 3, hints: pts("Startpunkt (Pivot)", "erstes Reaktionshoch/-tief", "zweites Reaktionstief/-hoch"), color: "#9c27b0", tip: "Wie Pitchfork, Start in der Mitte zwischen Punkt 1 und 2 (Zeit und Preis)" },
  { id: "regression", name: "Regressionstrend", group: "Linien", icon: "⫽", points: 2, hints: pts("Startkerze", "Endkerze"), color: "#2962ff", tip: "Lineare Regression der Schlusskurse mit ±2 Standardabweichungen und Pearson-r" },
  { id: "fibchannel", name: "Fibonacci-Kanal", group: "Fibonacci & Gann", icon: "≋", points: 3, hints: pts("Start der Basislinie", "Ende der Basislinie", "Breite (Level 1)"), color: "auto", tip: "Parallele Linien im Fibonacci-Abstand zur Basislinie" },
  { id: "fibtimezone", name: "Fibonacci-Zeitzonen", group: "Fibonacci & Gann", icon: "⦀", points: 2, hints: pts("Start", "Einheit (Abstand zur Linie 1)"), color: "auto", tip: "Senkrechte Linien nach 1, 2, 3, 5, 8, 13, 21 … Einheiten" },
  { id: "fibfan", name: "Fibonacci-Fächer", group: "Fibonacci & Gann", icon: "⟀", points: 2, hints: pts("Start", "Ende"), color: "auto", tip: "Speed-Resistance-Fächer: Linien vom Start zu 38,2 / 50 / 61,8 % von Preis und Zeit" },
  { id: "fibcircles", name: "Fibonacci-Kreise", group: "Fibonacci & Gann", icon: "◎", points: 2, hints: pts("Start", "Ende"), color: "auto", tip: "Kreise um die Mitte der Strecke, Radius = halbe Strecke × Fibonacci-Level" },
  { id: "fibarcs", name: "Fibonacci-Bögen", group: "Fibonacci & Gann", icon: "◠", points: 2, hints: pts("Start", "Ende"), color: "auto", tip: "Bögen um den Endpunkt mit 38,2 / 50 / 61,8 / 100 % der Streckenlänge" },
  { id: "gannbox", name: "Gann-Box", group: "Fibonacci & Gann", icon: "⊞", points: 2, hints: pts("Ecke", "gegenüberliegende Ecke"), color: "auto", tip: "Rechteck mit Preis- und Zeitlevels 0,25 / 0,382 / 0,5 / 0,618 / 0,75 und Diagonalen" },
  { id: "gannfan", name: "Gann-Fächer", group: "Fibonacci & Gann", icon: "⋇", points: 2, hints: pts("Start", "Punkt auf der 1×1-Linie"), color: "auto", tip: "Gann-Winkel 1×8 bis 8×1; die 1×1-Linie geht durch den zweiten Punkt" },
  { id: "xabcd", name: "XABCD-Muster", group: "Muster", icon: "Ⓧ", points: 5, hints: pts("X", "A", "B", "C", "D"), color: "#2962ff", tip: "Harmonisches Muster mit Verhältnissen AB/XA, BC/AB, CD/BC, AD/XA" },
  { id: "cypher", name: "Cypher-Muster", group: "Muster", icon: "Ⓒ", points: 5, hints: pts("X", "A", "B", "C", "D"), color: "#9c27b0", tip: "Harmonisches Muster mit Verhältnissen AB/XA, XC/XA, CD/XC" },
  { id: "abcd", name: "ABCD-Muster", group: "Muster", icon: "Ⓐ", points: 4, hints: pts("A", "B", "C", "D"), color: "#089981", tip: "Zwei gleichlaufende Bewegungen mit BC/AB und CD/BC" },
  { id: "headshoulders", name: "Kopf-Schulter", group: "Muster", icon: "⩙", points: 7, hints: pts("Start", "linke Schulter", "erster Tiefpunkt (Nackenlinie)", "Kopf", "zweiter Tiefpunkt (Nackenlinie)", "rechte Schulter", "Ende"), color: "#089981", tip: "Kopf-Schulter-Formation mit Nackenlinie" },
  { id: "trianglepattern", name: "Dreiecksmuster", group: "Muster", icon: "◁", points: 4, hints: pts("A", "B", "C", "D"), color: "#ff9800", tip: "Zickzack A-B-C-D mit den zusammenlaufenden Begrenzungslinien A-C und B-D" },
  { id: "threedrives", name: "Three Drives", group: "Muster", icon: "⩘", points: 7, hints: pts("Start", "Drive 1", "Korrektur A", "Drive 2", "Korrektur B", "Drive 3", "Ende"), color: "#e91e63", tip: "Drei Antriebe mit Korrekturen" },
  { id: "elliott5", name: "Elliott-Impulswelle (12345)", group: "Muster", icon: "⑤", points: 6, hints: pts("Ursprung", "Welle 1", "Welle 2", "Welle 3", "Welle 4", "Welle 5"), color: "#2962ff", tip: "Fünf Wellen mit Beschriftung (1)–(5)" },
  { id: "elliottabc", name: "Elliott-Korrektur (ABC)", group: "Muster", icon: "Ⓑ", points: 4, hints: pts("Ursprung", "Welle A", "Welle B", "Welle C"), color: "#f23645", tip: "Korrekturwelle (A)(B)(C)" },
  { id: "elliotttri", name: "Elliott-Dreieck (ABCDE)", group: "Muster", icon: "Ⓔ", points: 6, hints: pts("Ursprung", "Welle A", "Welle B", "Welle C", "Welle D", "Welle E"), color: "#ff9800", tip: "Dreieckskorrektur (A)–(E)" },
  { id: "elliottwxy", name: "Elliott-Doppelkombination (WXY)", group: "Muster", icon: "Ⓦ", points: 4, hints: pts("Ursprung", "Welle W", "Welle X", "Welle Y"), color: "#00bcd4", tip: "Kombinierte Korrektur (W)(X)(Y)" },
  { id: "pricerange", name: "Preisbereich", group: "Prognose & Messen", icon: "↕", points: 2, hints: pts("Startpreis", "Endpreis"), color: "#2962ff", tip: "Preisdifferenz absolut und in Prozent" },
  { id: "daterange", name: "Datumsbereich", group: "Prognose & Messen", icon: "↔", points: 2, hints: pts("Startkerze", "Endkerze"), color: "#2962ff", tip: "Anzahl Kerzen, Zeitspanne und Volumen dazwischen" },
  { id: "avwap", name: "Verankerter VWAP", group: "Prognose & Messen", icon: "⚓", points: 1, hints: pts("Ankerkerze"), color: "#f7c948", tip: "VWAP (hlc3 × Volumen) ab der angetippten Kerze" },
  { id: "circle", name: "Kreis", group: "Formen", icon: "○", points: 2, hints: pts("Mittelpunkt", "Rand"), color: "#9c27b0", tip: "Kreis um einen Mittelpunkt" },
  { id: "ellipse", name: "Ellipse", group: "Formen", icon: "⬭", points: 2, hints: pts("Ecke", "gegenüberliegende Ecke"), color: "#9c27b0", tip: "Ellipse in einem Rechteck" },
  { id: "triangle", name: "Dreieck", group: "Formen", icon: "△", points: 3, hints: pts("erste Ecke", "zweite Ecke", "dritte Ecke"), color: "#ff9800", tip: "Gefülltes Dreieck" },
  { id: "callout", name: "Sprechblase", group: "Beschriftung", icon: "💬", points: 2, hints: pts("Zielpunkt", "Position der Blase"), text: "text", color: "#2962ff", tip: "Text in einer Blase mit Zeiger auf einen Punkt" },
  { id: "note", name: "Notiz", group: "Beschriftung", icon: "📌", points: 1, hints: pts("Punkt"), text: "text", color: "#f7c948", tip: "Stecknadel mit Notiztext" },
  { id: "pricelabel", name: "Preisbeschriftung", group: "Beschriftung", icon: "🏷", points: 1, hints: pts("Punkt"), color: "#2962ff", tip: "Zeigt den Preis an einem Punkt" },
  { id: "arrowup", name: "Pfeil nach oben", group: "Beschriftung", icon: "⬆", points: 1, hints: pts("Punkt"), color: "#089981", tip: "Markierungspfeil nach oben" },
  { id: "arrowdown", name: "Pfeil nach unten", group: "Beschriftung", icon: "⬇", points: 1, hints: pts("Punkt"), color: "#f23645", tip: "Markierungspfeil nach unten" },
  { id: "emoji", name: "Emoji / Symbol", group: "Beschriftung", icon: "😀", points: 1, hints: pts("Punkt"), text: "emoji", color: "#d1d4dc", tip: "Emoji oder Symbol in den Chart setzen" },
];

const BY_ID = new Map(SHAPES.map((s) => [s.id, s]));

export function shapeDef(kind: ShapeKind): ShapeDef {
  return BY_ID.get(kind)!;
}

export function isShapeKind(v: string): v is ShapeKind {
  return BY_ID.has(v as ShapeKind);
}

// ---------------- Levels ----------------

/** Fibonacci channel levels (TradingView defaults). */
export const FIB_CHANNEL_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618];
/** Fibonacci time zones: lines after these many units (Fibonacci numbers). */
export const FIB_TIME_ZONES = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
/** Speed resistance fan levels; 1 is the trend line itself. */
export const FIB_FAN_LEVELS = [0.382, 0.5, 0.618, 1];
export const FIB_CIRCLE_LEVELS = [0.382, 0.5, 0.618, 1, 1.618, 2.618];
export const FIB_ARC_LEVELS = [0.382, 0.5, 0.618, 1];
export const GANN_BOX_LEVELS = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];
/** Gann angles as [time units, price units]; 1×1 runs through the second point. */
export const GANN_FAN_ANGLES: [number, number][] = [
  [1, 8],
  [1, 4],
  [1, 3],
  [1, 2],
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [8, 1],
];

// ---------------- Geometry in time/price ----------------

/**
 * Andrews pitchfork: the median line runs from the pivot to the midpoint of points 2 and 3,
 * the outer lines are parallel to it through points 2 and 3. Schiff moves the pivot halfway
 * towards point 2 in price, the modified Schiff halfway in time and price.
 */
export function pitchforkOrigin(kind: "pitchfork" | "schiff" | "modschiff", p: ShapePoint[]): ShapePoint {
  const [a, b] = p;
  if (kind === "schiff") return { time: a.time, price: (a.price + b.price) / 2 };
  if (kind === "modschiff") return { time: (a.time + b.time) / 2, price: (a.price + b.price) / 2 };
  return a;
}

export function midpoint(a: ShapePoint, b: ShapePoint): ShapePoint {
  return { time: (a.time + b.time) / 2, price: (a.price + b.price) / 2 };
}

/** Times of the Fibonacci time zone lines: start + n × (second − start). */
export function fibTimeZones(a: ShapePoint, b: ShapePoint): number[] {
  const unit = b.time - a.time;
  return FIB_TIME_ZONES.map((n) => a.time + n * unit);
}

/** End point of a Gann angle drawn from `a`, with b − a as one 1×1 unit. */
export function gannAngleEnd(a: ShapePoint, b: ShapePoint, [t, p]: [number, number]): ShapePoint {
  return { time: a.time + (b.time - a.time) * t, price: a.price + (b.price - a.price) * p };
}

/** Ratio |leg2| / |leg1| of the price moves, as shown on harmonic patterns. */
export function legRatio(from1: ShapePoint, to1: ShapePoint, from2: ShapePoint, to2: ShapePoint): number {
  const d1 = Math.abs(to1.price - from1.price);
  return d1 === 0 ? 0 : Math.abs(to2.price - from2.price) / d1;
}

/** Bars whose time lies within [from, to] (either order). */
function barsBetween(bars: Bar[], t1: number, t2: number): Bar[] {
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  return bars.filter((b) => b.time >= lo && b.time <= hi);
}

export interface RegressionTrend {
  /** Price of the regression line at the first and last bar. */
  from: ShapePoint;
  to: ShapePoint;
  /** Standard deviation of the closes around the line. */
  deviation: number;
  /** Pearson correlation of close and bar index. */
  pearson: number;
  count: number;
}

/** Least-squares line through the closes between two times (linear regression channel after Gilbert Raff). */
export function regressionTrend(bars: Bar[], t1: number, t2: number): RegressionTrend | null {
  const sel = barsBetween(bars, t1, t2);
  const n = sel.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  sel.forEach((b, i) => {
    sx += i;
    sy += b.close;
    sxx += i * i;
    sxy += i * b.close;
    syy += b.close * b.close;
  });
  const den = n * sxx - sx * sx;
  const slope = den === 0 ? 0 : (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  let ss = 0;
  sel.forEach((b, i) => {
    const r = b.close - (intercept + slope * i);
    ss += r * r;
  });
  const varY = n * syy - sy * sy;
  const pearson = den <= 0 || varY <= 0 ? 0 : (n * sxy - sx * sy) / Math.sqrt(den * varY);
  return {
    from: { time: sel[0].time, price: intercept },
    to: { time: sel[n - 1].time, price: intercept + slope * (n - 1) },
    deviation: Math.sqrt(ss / n),
    pearson,
    count: n,
  };
}

/** VWAP from the anchor bar on: cumulative (hlc3 × volume) / cumulative volume, TradingView's default source. */
export function anchoredVwapLine(bars: Bar[], anchor: number): ShapePoint[] {
  const out: ShapePoint[] = [];
  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    if (b.time < anchor) continue;
    const v = b.volume ?? 0;
    const tp = (b.high + b.low + b.close) / 3;
    pv += tp * v;
    vol += v;
    out.push({ time: b.time, price: vol > 0 ? pv / vol : tp });
  }
  return out;
}

export interface RangeStats {
  bars: number;
  seconds: number;
  volume: number;
}

/** Candles, duration and volume between two times (date range tool). */
export function dateRangeStats(bars: Bar[], t1: number, t2: number): RangeStats {
  const sel = barsBetween(bars, t1, t2);
  return { bars: Math.max(0, sel.length - 1), seconds: Math.abs(t2 - t1), volume: sel.reduce((s, b) => s + (b.volume ?? 0), 0) };
}

/** Labels written at the points of a pattern; empty string = no label. */
export function patternLabels(kind: ShapeKind): string[] {
  switch (kind) {
    case "xabcd":
    case "cypher":
      return ["X", "A", "B", "C", "D"];
    case "abcd":
    case "trianglepattern":
      return ["A", "B", "C", "D"];
    case "headshoulders":
      return ["", "Linke Schulter", "", "Kopf", "", "Rechte Schulter", ""];
    case "threedrives":
      return ["", "1", "A", "2", "B", "3", ""];
    case "elliott5":
      return ["", "(1)", "(2)", "(3)", "(4)", "(5)"];
    case "elliottabc":
      return ["", "(A)", "(B)", "(C)"];
    case "elliotttri":
      return ["", "(A)", "(B)", "(C)", "(D)", "(E)"];
    case "elliottwxy":
      return ["", "(W)", "(X)", "(Y)"];
    default:
      return [];
  }
}

/** Ratio labels of harmonic patterns: [index of the point it sits between (from, to), text]. */
export function harmonicRatios(kind: ShapeKind, p: ShapePoint[]): { from: number; to: number; value: number }[] {
  const r = (a: number, b: number, c: number, d: number) => legRatio(p[a], p[b], p[c], p[d]);
  if ((kind === "xabcd" || kind === "cypher") && p.length >= 5) {
    if (kind === "cypher") return [
      { from: 0, to: 2, value: r(0, 1, 1, 2) },
      { from: 0, to: 3, value: r(0, 1, 0, 3) },
      { from: 0, to: 4, value: r(0, 3, 3, 4) },
    ];
    return [
      { from: 0, to: 2, value: r(0, 1, 1, 2) },
      { from: 1, to: 3, value: r(1, 2, 2, 3) },
      { from: 2, to: 4, value: r(2, 3, 3, 4) },
      { from: 0, to: 4, value: r(0, 1, 1, 4) },
    ];
  }
  if (kind === "abcd" && p.length >= 4) return [
    { from: 0, to: 2, value: r(0, 1, 1, 2) },
    { from: 1, to: 3, value: r(1, 2, 2, 3) },
  ];
  return [];
}
