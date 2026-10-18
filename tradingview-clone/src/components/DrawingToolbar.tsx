import { autoFibonacci } from "../../shared/patterns";
import type { ChartEngine } from "../chart/ChartEngine";
import { DEFAULT_FIB_LEVELS } from "../chart/DrawingsPrimitive";
import { addDrawing, clearDrawings, newId, store, useChartState, type Tool } from "../store";

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: "cursor", icon: "↖", label: "Cursor (Esc)" },
  { id: "trendline", icon: "╱", label: "Trendlinie\nZwei Punkte antippen" },
  { id: "ray", icon: "⟋", label: "Strahl\nTrendlinie, nach rechts verlängert" },
  { id: "hline", icon: "―", label: "Horizontale Linie" },
  { id: "vline", icon: "│", label: "Vertikale Linie" },
  { id: "zone", icon: "▭", label: "Rechteck / Zone\nZwei Ecken antippen" },
  { id: "fib", icon: "≣", label: "Fibonacci-Retracement\nVon Swing-Tief zu Swing-Hoch ziehen" },
  { id: "fibext", icon: "⋰", label: "Fibonacci-Extension (trendbasiert)\nStart, Ende der Bewegung, dann Ende des Rücksetzers antippen" },
  { id: "channel", icon: "▱", label: "Paralleler Kanal\nZwei Punkte für die Linie, dritter für die Breite" },
  { id: "measure", icon: "⇲", label: "Messen\nΔ Preis, Δ %, Anzahl Kerzen und Δ Zeit zwischen zwei Punkten" },
  { id: "brush", icon: "✎", label: "Pinsel\nFreihand zeichnen; Esc oder Cursor beendet" },
  { id: "text", icon: "T", label: "Text" },
  { id: "long", icon: "▲", label: "Long-Position\nEinstieg, dann Stop-Loss, dann Take-Profit antippen\nAntippen der Position öffnet die Einstellungen" },
  { id: "short", icon: "▼", label: "Short-Position\nEinstieg, dann Stop-Loss, dann Take-Profit antippen\nAntippen der Position öffnet die Einstellungen" },
  { id: "erase", icon: "⌫", label: "Radierer\nZeichnung anklicken zum Löschen" },
];

interface Props {
  magnet: boolean;
  onToggleMagnet: () => void;
  getEngine: () => ChartEngine | null;
}

/** Fibonacci retracement over the dominant swing of the visible candles. */
function drawAutoFib(engine: ChartEngine | null) {
  const range = engine?.chart.timeScale().getVisibleLogicalRange();
  const swing = range ? autoFibonacci(store.get().bars, range.from, range.to) : null;
  if (!swing) return;
  addDrawing({ id: newId("user-autofib"), author: "user", kind: "fib", a: swing.a, b: swing.b, levels: DEFAULT_FIB_LEVELS, color: "auto", label: "Auto-Fib" });
}

export function DrawingToolbar({ magnet, onToggleMagnet, getEngine }: Props) {
  const tool = useChartState((s) => s.tool);
  return (
    <nav className="toolbar">
      {TOOLS.map((t) => (
        <button key={t.id} data-tip={t.label} aria-label={t.label} className={`${tool === t.id ? "active" : ""} tool-${t.id}`} onClick={() => store.set({ tool: t.id })}>
          {t.icon}
        </button>
      ))}
      <button data-tip={"Auto-Fibonacci\nRetracement über den größten Swing im sichtbaren Bereich"} aria-label="Auto-Fibonacci" className="auto-fib" onClick={() => drawAutoFib(getEngine())}>
        ≣<sup>A</sup>
      </button>
      <div className="toolbar-sep" />
      <button data-tip={"Magnet\nZeichenpunkte rasten an Open/High/Low/Close ein"} aria-label="Magnet" className={magnet ? "active" : ""} onClick={onToggleMagnet}>
        🧲
      </button>
      <button
        data-tip="Alle Zeichnungen und Marker löschen"
        aria-label="Alle Zeichnungen löschen"
        onClick={() => {
          if (window.confirm("Alle Zeichnungen und Marker löschen?")) clearDrawings("all");
        }}
      >
        🗑
      </button>
    </nav>
  );
}
