import type { ChartEngine } from "../chart/ChartEngine";
import { ClaudePanel } from "./ClaudePanel";
import { LiquidationsPanel } from "./LiquidationsPanel";
import { OrderBookPanel } from "./OrderBookPanel";

export type SideTab = "claude" | "book" | "liq";

const TABS: { id: SideTab; label: string; tip: string }[] = [
  { id: "claude", label: "✦ Claude", tip: "Chart-Analyse mit Claude" },
  { id: "book", label: "Orderbuch", tip: "Live-Orderbuch von Binance (Spot oder Futures)" },
  { id: "liq", label: "Liquidationen", tip: "Liquidations-Heatmap und Live-Liquidationen" },
];

export function SidePanel({ tab, onTab, getEngine }: { tab: SideTab; onTab: (t: SideTab) => void; getEngine: () => ChartEngine | null }) {
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
        {tab === "book" && (
          <div className="side-page">
            <OrderBookPanel />
          </div>
        )}
        {tab === "liq" && (
          <div className="side-page">
            <LiquidationsPanel />
          </div>
        )}
      </div>
    </div>
  );
}
