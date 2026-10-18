import { clearDrawings, store, useChartState, type Tool } from "../store";

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: "cursor", icon: "↖", label: "Cursor (Esc)" },
  { id: "trendline", icon: "╱", label: "Trendlinie\nZwei Punkte antippen" },
  { id: "ray", icon: "⟋", label: "Strahl\nTrendlinie, nach rechts verlängert" },
  { id: "hline", icon: "―", label: "Horizontale Linie" },
  { id: "vline", icon: "│", label: "Vertikale Linie" },
  { id: "zone", icon: "▭", label: "Rechteck / Zone\nZwei Ecken antippen" },
  { id: "fib", icon: "≣", label: "Fibonacci-Retracement\nVon Swing-Tief zu Swing-Hoch ziehen" },
  { id: "text", icon: "T", label: "Text" },
  { id: "erase", icon: "⌫", label: "Radierer\nZeichnung anklicken zum Löschen" },
];

interface Props {
  magnet: boolean;
  onToggleMagnet: () => void;
}

export function DrawingToolbar({ magnet, onToggleMagnet }: Props) {
  const tool = useChartState((s) => s.tool);
  return (
    <nav className="toolbar">
      {TOOLS.map((t) => (
        <button key={t.id} data-tip={t.label} aria-label={t.label} className={tool === t.id ? "active" : ""} onClick={() => store.set({ tool: t.id })}>
          {t.icon}
        </button>
      ))}
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
