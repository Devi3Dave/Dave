// Claude tool definitions. The Zod schemas are the single source of truth:
// the server turns them into JSON Schema for the API, the browser uses them to
// validate tool inputs before touching the chart.
import { z } from "zod";
import { INDICATOR_IDS } from "./indicators.js";
import { MAX_COMPARE } from "./compare.js";
import { isValidInterval } from "./marketData.js";
import { SHAPES, SHAPE_KINDS } from "./drawingShapes.js";
import { STRATEGIES } from "./strategyTester.js";

/** Preset time frames (menu); any other like 7m, 90s, 2d works too (see parseInterval). */
export const INTERVALS = ["1s", "5s", "15s", "30s", "1m", "3m", "5m", "15m", "30m", "45m", "1h", "2h", "3h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M", "3M", "1y", "all"] as const;
/** Time frames shown as buttons in the top bar. */
export const MAIN_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M", "3M", "1y", "all"] as const;
export type CustomInterval = `${number}${"s" | "m" | "h" | "d"}`;
/** Bars after a number of trades (100T) or a price range in minimum price changes (10R), see shared/tickBars.ts. */
export const TICK_INTERVALS = ["1T", "10T", "100T", "1000T"] as const;
export const RANGE_INTERVALS = ["1R", "10R", "100R", "1000R"] as const;
export type TradeIntervalCode = `${number}${"T" | "R"}`;
/** In the order of TradingView's chart type menu. */
export const CHART_TYPES = [
  "bars",
  "candles",
  "hollow_candles",
  "volume_candles",
  "line",
  "line_markers",
  "step_line",
  "area",
  "hlc_area",
  "baseline",
  "columns",
  "high_low",
  "volume_footprint",
  "tpo",
  "session_vp",
  "heikin_ashi",
  "renko",
  "line_break",
  "kagi",
  "point_figure",
  "range",
] as const;

/** TradingView's German names, grouped like its menu (the groups are separated by lines there). */
export const CHART_TYPE_GROUPS: [string, [(typeof CHART_TYPES)[number], string][]][] = [
  ["Balken & Kerzen", [["bars", "Balken"], ["candles", "Kerzen"], ["hollow_candles", "Hohlkerzen"], ["volume_candles", "Volumenkerzen"]]],
  ["Linien", [["line", "Linie"], ["line_markers", "Linie mit Markierungen"], ["step_line", "Step-Line"]]],
  ["Flächen", [["area", "Bereich"], ["hlc_area", "HLC-Bereich"], ["baseline", "Baseline"]]],
  ["Säulen", [["columns", "Säulen"], ["high_low", "Hoch-Tief"]]],
  ["Volumen", [["volume_footprint", "Volumen-Fußabdruck"], ["tpo", "Time Price Opportunity"], ["session_vp", "Session-Volumenprofil"]]],
  ["Preisbasiert", [["heikin_ashi", "Heikin Ashi"], ["renko", "Renko"], ["line_break", "Line-Break"], ["kagi", "Kagi"], ["point_figure", "Point & Figure"], ["range", "Range"]]],
];

export const CHART_TYPE_LABELS = Object.fromEntries(CHART_TYPE_GROUPS.flatMap(([, types]) => types)) as Record<(typeof CHART_TYPES)[number], string>;

const time = z
  .union([z.number(), z.string()])
  .describe("Zeitpunkt einer Kerze: Unix-Sekunden (UTC) oder ISO-8601-String. Wird auf die nächste Kerze gerundet.");
const point = z.object({ time, price: z.number() });
const color = z.string().describe("CSS-Farbe, z. B. '#26a69a' oder 'rgba(239,83,80,0.3)'.");
const lineStyle = z.enum(["solid", "dashed", "dotted"]);
const indicator = z.enum(INDICATOR_IDS).describe("Indikator-ID aus der Liste im Systemprompt.");
const params = z
  .record(z.string(), z.number())
  .describe("Parameter des Indikators, z. B. {\"length\": 50}. Fehlende Werte nutzen die Standardwerte.");

export const toolSchemas = {
  get_chart_data: {
    description:
      "Liefert OHLCV-Kerzen des aktuellen Charts (neueste zuletzt). Nutze das für Preisniveaus, Hochs/Tiefs und exakte Zeitstempel bevor du zeichnest.",
    schema: z.object({
      last_n: z.number().int().min(1).max(1000).optional().describe("Anzahl der letzten Kerzen (Standard 150)."),
    }),
  },
  get_indicator_values: {
    description:
      "Berechnet einen Indikator auf den aktuellen Kerzen und liefert die letzten Werte, ohne ihn einzuzeichnen. Ideal für die Analyse.",
    schema: z.object({ indicator, params: params.optional(), last_n: z.number().int().min(1).max(500).optional() }),
  },
  add_indicator: {
    description:
      "Fügt dem Chart einen Indikator hinzu (Overlay oder eigenes Panel, je nach Typ). Gibt die Instanz-ID und die letzten Werte zurück.",
    schema: z.object({
      indicator,
      params: params.optional(),
      colors: z.array(color).optional().describe("Optionale Farben je Ausgabelinie in der Reihenfolge der Ausgaben."),
      source: z
        .object({ id: z.string().describe("Instanz-ID des Quell-Indikators im Chart."), output: z.string().describe("Ausgabe-Key, z. B. value, macd, signal.") })
        .optional()
        .describe(
          "Indikator auf Indikator (wie TradingViews „Quelle“): berechnet z. B. einen SMA oder Bollinger-Bänder auf der RSI-Linie statt auf dem Schlusskurs; wird im Panel der Quelle gezeichnet. Nur für Indikatoren mit einer Kurs-Eingabe (Durchschnitte, BB, RSI, MACD, ROC …).",
        ),
    }),
  },
  remove_indicator: {
    description: "Entfernt einen Indikator per Instanz-ID oder alle mit id='all'.",
    schema: z.object({ id: z.string() }),
  },
  set_chart: {
    description: "Wechselt Symbol, Zeiteinheit oder Charttyp, auch Spread-Charts und Symbolvergleich. Danach sind neue Kerzen geladen.",
    schema: z.object({
      symbol: z
        .string()
        .optional()
        .describe("z. B. BTCUSDT, ETHUSDT (Binance) oder AAPL, ^GDAXI, EURUSD=X (Yahoo). Spread-Chart aus zwei Symbolen: BTCUSDT/ETHUSDT (Verhältnis), BTCUSDT - ETHUSDT, A+B, A*B."),
      interval: z
        .string()
        .refine(isValidInterval, "Zeiteinheit wie 1m, 15m, 4h, 1d, eigene wie 7m, 90s, 2d oder Ticks/Bereiche wie 100T, 10R")
        .optional()
        .describe(
          "Voreinstellungen: " +
            INTERVALS.join(", ") +
            ". 1M = Monat, 3M = Quartal, 1y = Jahr, all = gesamte Historie (Wochenkerzen). Eigene Zeiteinheiten: Zahl + s/m/h/d bis 7 Tage (z. B. 7m, 90s, 2d). Sekunden nur für Binance-Spot-Krypto. Ticks: 1T, 10T, 100T, 1000T (neuer Balken nach so vielen Trades); Bereiche: 1R, 10R, 100R, 1000R (Balken über so viele Mindest-Kursschritte); beide aus Binance-Trades, nur Krypto.",
        ),
      chart_type: z.enum(CHART_TYPES).optional(),
      compare: z
        .array(z.string())
        .max(MAX_COMPARE)
        .optional()
        .describe("Ersetzt die Vergleichssymbole, die als Linien über den Chart gelegt werden (Preisachse dann in Prozent ab der ersten sichtbaren Kerze). [] entfernt alle."),
    }),
  },
  draw_trendline: {
    description: "Zeichnet eine Trendlinie / einen Strahl zwischen zwei Punkten.",
    schema: z.object({
      start: point,
      end: point,
      extend: z.enum(["none", "right", "left", "both"]).optional().describe("Linie über die Punkte hinaus verlängern."),
      color: color.optional(),
      line_style: lineStyle.optional(),
      width: z.number().min(1).max(6).optional(),
      label: z.string().optional(),
    }),
  },
  draw_horizontal_line: {
    description: "Zeichnet eine horizontale Linie (Unterstützung, Widerstand, Ziel, Stop) mit Preisbeschriftung.",
    schema: z.object({ price: z.number(), color: color.optional(), line_style: lineStyle.optional(), label: z.string().optional() }),
  },
  draw_vertical_line: {
    description: "Zeichnet eine vertikale Linie an einer Kerze (z. B. Ereignis, Ausbruch).",
    schema: z.object({ time, color: color.optional(), label: z.string().optional() }),
  },
  draw_zone: {
    description: "Zeichnet eine Preiszone als Rechteck (z. B. Unterstützungszone, Order-Block, Fair-Value-Gap). Ohne Zeiten über den ganzen Chart.",
    schema: z.object({
      top: z.number(),
      bottom: z.number(),
      start_time: time.optional(),
      end_time: time.optional(),
      extend_right: z.boolean().optional(),
      color: color.optional(),
      label: z.string().optional(),
    }),
  },
  draw_fibonacci: {
    description: "Zeichnet ein Fibonacci-Retracement von start (z. B. Swing-Tief) nach end (z. B. Swing-Hoch).",
    schema: z.object({
      start: point,
      end: point,
      levels: z.array(z.number()).optional().describe("Standard: 0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618"),
      color: color.optional(),
    }),
  },
  draw_position: {
    description:
      "Zeichnet ein Long/Short-Positionswerkzeug wie in TradingView: grüne Zone Einstieg→Ziel, rote Zone Einstieg→Stop, mit Chance/Risiko-Verhältnis, Positionsgröße aus Kontogröße und Risiko-% sowie Status (läuft / Ziel / Stop). Stop und Ziel müssen auf der richtigen Seite liegen (Long: Stop < Einstieg < Ziel).",
    schema: z.object({
      side: z.enum(["long", "short"]),
      entry: z.number(),
      stop: z.number(),
      target: z.number(),
      start_time: time.optional().describe("Einstiegszeitpunkt, Standard: letzte Kerze"),
      end_time: time.optional().describe("Ende des Handelsfensters, Standard: 20 Kerzen nach dem Einstieg"),
      account_size: z.number().positive().optional().describe("Standard: letzte Einstellung des Nutzers"),
      risk_percent: z.number().positive().max(100).optional(),
      risk_amount: z.number().positive().optional().describe("Fester Risikobetrag pro Trade (z. B. 500); ersetzt risk_percent"),
      leverage: z.number().min(1).max(125).optional(),
      label: z.string().optional(),
    }),
  },
  draw_fib_extension: {
    description: "Zeichnet eine trendbasierte Fibonacci-Extension: Bewegung start→end, projiziert ab dem Rücksetzer-Punkt retrace (Kursziele 0.618, 1, 1.272, 1.618, 2, 2.618).",
    schema: z.object({
      start: point,
      end: point,
      retrace: point,
      levels: z.array(z.number()).optional(),
      color: color.optional(),
    }),
  },
  draw_auto_fibonacci: {
    description: "Zeichnet automatisch ein Fibonacci-Retracement über den größten Swing (höchstes Hoch / tiefstes Tief) der letzten last_n Kerzen.",
    schema: z.object({ last_n: z.number().int().min(5).max(1000).optional().describe("Standard: 150") }),
  },
  draw_parallel_channel: {
    description: "Zeichnet einen parallelen Kanal: Basislinie start→end und eine parallele Linie durch den Preis width_point (z. B. gegenüberliegendes Swing-Hoch/-Tief).",
    schema: z.object({ start: point, end: point, width_point: point, color: color.optional(), label: z.string().optional() }),
  },
  draw_shape: {
    description:
      "Zeichnet eines der weiteren TradingView-Zeichenwerkzeuge aus Punkten in Tipp-Reihenfolge. Werkzeuge und Punktzahl: " +
      SHAPES.map((s) => `${s.id} (${s.name}, ${s.points} Punkt${s.points > 1 ? "e" : ""}: ${s.hints.map((h) => h.replace(/ antippen$/, "")).join(", ")})`).join("; ") +
      ".",
    schema: z.object({
      shape: z.enum(SHAPE_KINDS),
      points: z.array(point).min(1).max(7),
      text: z.string().optional().describe("Text für callout, note, emoji und Pfeile"),
      color: color.optional(),
      label: z.string().optional(),
    }),
  },
  backtest_strategy: {
    description:
      "Testet eine fertige Strategie (wie TradingViews Strategietester) auf den geladenen Kerzen des aktiven Charts: Signal auf dem Schluss, Ausführung zur nächsten Eröffnung, Gegensignal dreht die Position. Liefert Nettogewinn, Drawdown, Profit-Faktor, Trefferquote, Buy & Hold und die letzten Trades. Strategien: " +
      STRATEGIES.map((s) => `${s.id} (${s.name}; Parameter ${s.params.map((p) => `${p.key}=${p.default}`).join(", ")})`).join("; ") +
      ".",
    schema: z.object({
      strategy: z.enum(STRATEGIES.map((s) => s.id) as [string, ...string[]]),
      params: z.record(z.string(), z.number()).optional(),
      direction: z.enum(["both", "long", "short"]).optional(),
      capital: z.number().positive().optional(),
      size_percent: z.number().positive().max(1000).optional(),
      commission_percent: z.number().min(0).max(5).optional(),
    }),
  },
  get_order_blocks: {
    description:
      "Liefert aktive Smart-Money-Orderblöcke (bullisch = Nachfrage, bärisch = Angebot) auf dem Chart-Zeitrahmen und höheren Zeitrahmen sowie die letzten Buy/Sell-Signale (erster Retest mit Reaktionskerze). Zum Anzeigen den Indikator orderblocks hinzufügen.",
    schema: z.object({
      higher_tf_minutes: z.array(z.number().int().min(1).max(43200)).max(3).optional().describe("Standard [240, 1440]"),
      swing: z.number().int().min(2).max(30).optional().describe("Standard 5"),
    }),
  },
  get_fair_value_gaps: {
    description:
      "Liefert offene Fair Value Gaps (Drei-Kerzen-Imbalance: bullisch, wenn Tief von Kerze 3 über Hoch von Kerze 1 liegt, bärisch umgekehrt) auf dem Chart-Zeitrahmen mit Ober-/Unterkante und Abstand zum Kurs. Zum Anzeigen den Indikator fvg hinzufügen.",
    schema: z.object({
      min_pct: z.number().min(0).max(10).optional().describe("Mindestgröße in % des Kurses, Standard 0"),
      mitigation: z.enum(["touch", "half", "full"]).optional().describe("Wann eine Lücke als erledigt gilt, Standard touch"),
    }),
  },
  get_patterns: {
    description:
      "Erkennt Kerzenmuster (Engulfing, Hammer, Shooting Star, Morning/Evening Star, Harami, …) und Chartformationen (Doppeltop/-boden, Schulter-Kopf-Schulter, Dreiecke) in den geladenen Kerzen. Zum Einzeichnen die Indikatoren candlepatterns bzw. chartpatterns hinzufügen.",
    schema: z.object({
      last_n: z.number().int().min(10).max(1000).optional().describe("Kerzen für Kerzenmuster, Standard 100"),
      pivot: z.number().int().min(2).max(30).optional().describe("Swing-Länge für Formationen, Standard 5"),
      tolerance_pct: z.number().min(0.2).max(10).optional().describe("Standard 1.5"),
    }),
  },
  add_text: {
    description: "Setzt eine Textnotiz an eine Position im Chart.",
    schema: z.object({ time, price: z.number(), text: z.string(), color: color.optional() }),
  },
  add_markers: {
    description: "Setzt Marker (Pfeile/Punkte mit Text) an Kerzen, z. B. Kauf-/Verkaufssignale, Divergenzen, Muster.",
    schema: z.object({
      markers: z.array(
        z.object({
          time,
          position: z.enum(["above", "below"]),
          shape: z.enum(["arrowUp", "arrowDown", "circle", "square"]).optional(),
          color: color.optional(),
          text: z.string().optional(),
        }),
      ),
    }),
  },
  remove_drawing: {
    description: "Entfernt eine Zeichnung oder einen Marker per ID.",
    schema: z.object({ id: z.string() }),
  },
  clear_drawings: {
    description: "Löscht Zeichnungen und Marker. scope='claude' nur deine eigenen, 'all' alle.",
    schema: z.object({ scope: z.enum(["claude", "all"]) }),
  },
  get_orderbook: {
    description:
      "Liest das Live-Orderbuch von Binance (nur Krypto): beste Bids/Asks gruppiert, Spread, Kauf-/Verkaufsverhältnis und die größten Orderwände. Gut für Unterstützungen/Widerstände durch Limit-Orders.",
    schema: z.object({
      market: z.enum(["spot", "futures"]).optional().describe("Standard: spot"),
      levels: z.number().int().min(5).max(100).optional().describe("Stufen je Seite (Standard 20)"),
      group: z.number().positive().optional().describe("Preisstufe zum Zusammenfassen, z. B. 10 für BTC"),
    }),
  },
  get_liquidations: {
    description:
      "Liefert die geschätzten Liquidations-Cluster (Heatmap-Modell aus Volumen und 10×–100× Hebel) über und unter dem Kurs sowie die echten Live-Liquidationen von Binance Futures seit App-Start.",
    schema: z.object({}),
  },
  create_alert: {
    description:
      "Legt einen Alarm für das aktuelle Symbol und die Zeiteinheit an (wie TradingView): Kurs oder eine Indikatorlinie gegen einen Wert bzw. einen Kanal. Der Nutzer bekommt Hinweis und Ton, solange die App offen ist.",
    schema: z.object({
      condition: z.enum(["crossing", "crossing_up", "crossing_down", "greater", "less", "entering", "exiting"]).describe("entering/exiting brauchen value und value2 (Kanal)."),
      value: z.number().describe("Preis bzw. Indikatorwert; beim Kanal eine Kante."),
      value2: z.number().optional().describe("Zweite Kanalkante für entering/exiting."),
      indicator: indicator.optional().describe("Statt des Kurses eine Indikatorlinie überwachen."),
      params: params.optional(),
      output: z.string().optional().describe("Ausgabe des Indikators (z. B. 'rsi'), Standard: erste Linie."),
      frequency: z.enum(["once", "per_bar", "per_bar_close"]).optional().describe("Standard: once"),
      message: z.string().optional(),
    }),
  },
  list_alerts: {
    description: "Listet alle Alarme (aktiv und pausiert) und die zuletzt ausgelösten.",
    schema: z.object({}),
  },
  delete_alert: {
    description: "Löscht einen Alarm per ID.",
    schema: z.object({ id: z.string() }),
  },
  take_screenshot: {
    description: "Macht ein Bild des aktuellen Charts inkl. Indikatoren und Zeichnungen, um das Ergebnis visuell zu prüfen.",
    schema: z.object({}),
  },
} as const;

export type ToolName = keyof typeof toolSchemas;
export type ToolInput<N extends ToolName> = z.infer<(typeof toolSchemas)[N]["schema"]>;

export function toolDefinitions() {
  return (Object.keys(toolSchemas) as ToolName[]).map((name) => {
    const { $schema: _ignored, ...input_schema } = z.toJSONSchema(toolSchemas[name].schema) as Record<string, unknown>;
    return {
      name,
      description: toolSchemas[name].description,
      input_schema: input_schema as { type: "object"; [k: string]: unknown },
      eager_input_streaming: true,
    };
  });
}
