import { useEffect } from "react";
import type { ChartEngine } from "../chart/ChartEngine";
import { charts, layoutCount, setActiveChart, useWorkspace } from "../store";
import { ChartArea } from "./ChartArea";

interface Props {
  onEngine: (slot: number, engine: ChartEngine | null) => void;
  magnet: boolean;
  onEditIndicator: (id: string) => void;
  onEditPosition: (id: string) => void;
}

/** One to eight charts side by side; tapping a chart makes it the active one. */
export function ChartGrid({ onEngine, magnet, onEditIndicator, onEditPosition }: Props) {
  const layout = useWorkspace((w) => w.layout);
  const active = useWorkspace((w) => w.active);
  const count = layoutCount(layout);

  // Visible charts stream live data, hidden ones are stopped.
  useEffect(() => {
    charts.forEach((c, i) => (i < count ? c.ensureLoaded() : c.stop()));
  }, [count]);

  return (
    <div className={`charts layout-${layout}`}>
      {charts.slice(0, count).map((c) => (
        <div
          key={c.slot}
          className={`chart-cell ${count > 1 && c.slot === active ? "active" : ""}`}
          onPointerDownCapture={() => setActiveChart(c.slot)}
        >
          <ChartArea chart={c} onEngine={onEngine} magnet={magnet} onEditIndicator={onEditIndicator} onEditPosition={onEditPosition} />
        </div>
      ))}
    </div>
  );
}
