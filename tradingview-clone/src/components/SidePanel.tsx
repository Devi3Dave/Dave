import type { ChartEngine } from "../chart/ChartEngine";
import { AlertsPanel } from "./AlertsPanel";
import { ClaudePanel } from "./ClaudePanel";
import { DemoPanel } from "./DemoPanel";
import { LiquidationsPanel } from "./LiquidationsPanel";
import { OrderBookPanel } from "./OrderBookPanel";

export type SideTab = "claude" | "demo" | "alerts" | "book" | "liq";

const TABS: { id: SideTab; label: string; tip: string }[] = [
  { id: "claude", label: "✦ Claude", tip: "Chart-Analyse mit Claude" },
  { id: "demo", label: "💰 Demo", tip: "Demo-Trading mit Spielgeld\nKaufen, verkaufen, Long/Short mit Hebel, SL/TP" },
  { id: "alerts", label: "🔔 Alarme", tip: "Alarme auf Preis, Indikatoren, Linien und Zonen" },
  { id: "book", label: "Orderbuch", tip: "Live-Orderbuch von Binance (Spot oder Futures)" },
  { id: "liq", label: "Liquidationen", tip: "Liquidations-Heatmap und Live-Liquidationen" },
];

interface Props {
  tab: SideTab;
  onTab: (t: SideTab) => void;
  getEngine: () => ChartEngine | null;
  onOpenHeatmap: () => void;
}

export function SidePanel({ tab, onTab, getEngine, onOpenHeatmap }: Props) {
  return (
    <div className="side-panel">
      <div className="side-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => onTab(t.id)} data-tip={t.tip}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="side-body">
        {/* Claude stays mounted so the conversation survives switching tabs. */}
        <div className="side-page" hidden={tab !== "claude"}>
          <ClaudePanel getEngine={getEngine} />
        </div>
        {tab === "demo" && (
          <div className="side-page">
            <DemoPanel />
          </div>
        )}
        {tab === "alerts" && (
          <div className="side-page">
            <AlertsPanel />
          </div>
        )}
        {tab === "book" && (
          <div className="side-page">
            <OrderBookPanel />
          </div>
        )}
        {tab === "liq" && (
          <div className="side-page">
            <LiquidationsPanel onOpenHeatmap={onOpenHeatmap} />
          </div>
        )}
      </div>
    </div>
  );
}
