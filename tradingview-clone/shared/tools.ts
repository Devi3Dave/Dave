// Claude tool definitions. The Zod schemas are the single source of truth:
// the server turns them into JSON Schema for the API, the browser uses them to
// validate tool inputs before touching the chart.
import { z } from "zod";
import { INDICATOR_IDS } from "./indicators.js";

export const INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
export const CHART_TYPES = ["candles", "bars", "heikin_ashi", "line", "area"] as const;

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
    }),
  },
  remove_indicator: {
    description: "Entfernt einen Indikator per Instanz-ID oder alle mit id='all'.",
    schema: z.object({ id: z.string() }),
  },
  set_chart: {
    description: "Wechselt Symbol, Zeiteinheit oder Charttyp. Danach sind neue Kerzen geladen.",
    schema: z.object({
      symbol: z.string().optional().describe("z. B. BTCUSDT, ETHUSDT (Binance) oder AAPL, ^GDAXI, EURUSD=X (Yahoo)."),
      interval: z.enum(INTERVALS).optional(),
      chart_type: z.enum(CHART_TYPES).optional(),
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
