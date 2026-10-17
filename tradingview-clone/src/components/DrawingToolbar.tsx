import { clearDrawings, store, useChartState, type Tool } from "../store";

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: "cursor", icon: "↖", label: "Cursor" },
  { id: "trendline", icon: "╱", label: "Trendlinie" },
  { id: "ray", icon: "⟋", label: "Strahl (nach rechts verlängert)" },
  { id: "hline", icon: "―", label: "Horizontale Linie" },
  { id: "vline", icon: "│", label: "Vertikale Linie" },
  { id: "zone", icon: "▭", label: "Rechteck / Zone" },
  { id: "fib", icon: "≣", label: "Fibonacci-Retracement" },
  { id: "text", icon: "T", label: "Text" },
  { id: "erase", icon: "⌫", label: "Radierer (Zeichnung anklicken)" },
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
        <button key={t.id} title={t.label} className={tool === t.id ? "active" : ""} onClick={() => store.set({ tool: t.id })}>
          {t.icon}
        </button>
      ))}
      <div className="toolbar-sep" />
      <button title="Magnet: an OHLC-Werten einrasten" className={magnet ? "active" : ""} onClick={onToggleMagnet}>
        🧲
      </button>
      <button
        title="Alle Zeichnungen löschen"
        onClick={() => {
          if (window.confirm("Alle Zeichnungen und Marker löschen?")) clearDrawings("all");
        }}
      >
        🗑
      </button>
    </nav>
  );
}
