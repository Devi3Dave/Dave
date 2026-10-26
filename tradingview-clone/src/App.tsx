import { useCallback, useEffect, useRef, useState } from "react";
import type { ChartEngine } from "./chart/ChartEngine";
import { CalculatorView } from "./components/CalculatorView";
import { AlertToasts } from "./components/AlertsPanel";
import { ChartGrid } from "./components/ChartGrid";
import { ChartSettingsDialog } from "./components/ChartSettingsDialog";
import { DemoToasts } from "./components/DemoToasts";
import { DrawingToolbar } from "./components/DrawingToolbar";
import { ExchangesView } from "./components/ExchangesView";
import { JournalView } from "./components/JournalView";
import { IndicatorDialog, IndicatorSettings } from "./components/IndicatorDialog";
import { LiqHeatmapView } from "./components/LiqHeatmapView";
import { PositionDialog } from "./components/PositionDialog";
import { SidePanel, type SideTab } from "./components/SidePanel";
import { TooltipLayer } from "./components/Tooltip";
import { TopBar } from "./components/TopBar";
import { isCryptoSymbol } from "../shared/marketData";
import { OPEN_ALERTS_EVENT, startAlertFeed } from "./alerts";
import { startDemoFeed } from "./demoAccount";
import { liquidationFeed } from "./market/liquidationFeed";
import { MAX_CHARTS, useChartState, workspace } from "./store";

export default function App() {
  const enginesRef = useRef<(ChartEngine | null)[]>(Array(MAX_CHARTS).fill(null));
  const [showIndicators, setShowIndicators] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editingPosition, setEditingPosition] = useState<string | null>(null);
  const [claudeOpen, setClaudeOpen] = useState(true);
  const [magnet, setMagnet] = useState(true);
  const [sideTab, setSideTab] = useState<SideTab>("claude");
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [exchangesOpen, setExchangesOpen] = useState(false);
  const symbol = useChartState((s) => s.symbol);
  const liveLiquidations = useChartState((s) => s.settings.liveLiquidations);

  // The liquidation stream runs while bubbles are shown or its tab is open (crypto only).
  const wantLiquidations = isCryptoSymbol(symbol) && (liveLiquidations || (claudeOpen && sideTab === "liq"));
  useEffect(() => {
    if (wantLiquidations) liquidationFeed.start(symbol);
    else liquidationFeed.stop();
  }, [wantLiquidations, symbol]);

  // Demo positions are watched (stop, target, liquidation) whether or not their tab is open.
  useEffect(() => startDemoFeed(), []);
  // Alerts are checked on every price, whatever is open.
  useEffect(() => startAlertFeed(), []);

  const closePages = () => {
    setHeatmapOpen(false);
    setCalcOpen(false);
    setJournalOpen(false);
    setExchangesOpen(false);
  };
  const openAlerts = useCallback(() => {
    setClaudeOpen(true);
    setSideTab("alerts");
  }, []);
  // Drawing menu ("Alarm hinzufügen") and Alt + A, as in TradingView.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.altKey && e.code === "KeyA") {
        e.preventDefault();
        openAlerts();
      }
    };
    window.addEventListener(OPEN_ALERTS_EVENT, openAlerts);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_ALERTS_EVENT, openAlerts);
      window.removeEventListener("keydown", onKey);
    };
  }, [openAlerts]);

  const onEngine = useCallback((slot: number, e: ChartEngine | null) => {
    enginesRef.current[slot] = e;
  }, []);
  // Claude always works with the active chart.
  const getEngine = useCallback(() => enginesRef.current[workspace.get().active] ?? null, []);

  return (
    <div className={`app ${claudeOpen ? "with-claude" : ""}`}>
      <TopBar
        onOpenIndicators={() => setShowIndicators(true)}
        onOpenSettings={() => setShowSettings(true)}
        heatmapOpen={heatmapOpen}
        onToggleHeatmap={() => {
          setCalcOpen(false);
          setJournalOpen(false);
          setExchangesOpen(false);
          setHeatmapOpen((o) => !o);
        }}
        calcOpen={calcOpen}
        onToggleCalc={() => {
          setHeatmapOpen(false);
          setJournalOpen(false);
          setExchangesOpen(false);
          setCalcOpen((o) => !o);
        }}
        journalOpen={journalOpen}
        onToggleJournal={() => {
          setHeatmapOpen(false);
          setCalcOpen(false);
          setExchangesOpen(false);
          setJournalOpen((o) => !o);
        }}
        exchangesOpen={exchangesOpen}
        onToggleExchanges={() => {
          setHeatmapOpen(false);
          setCalcOpen(false);
          setJournalOpen(false);
          setExchangesOpen((o) => !o);
        }}
        demoOpen={claudeOpen && sideTab === "demo"}
        onToggleDemo={() => {
          if (claudeOpen && sideTab === "demo" && !(heatmapOpen || calcOpen || journalOpen || exchangesOpen)) return setSideTab("claude");
          // Trading needs the chart, so full-screen pages close.
          setHeatmapOpen(false);
          setCalcOpen(false);
          setJournalOpen(false);
          setExchangesOpen(false);
          setClaudeOpen(true);
          setSideTab("demo");
        }}
        alertsOpen={claudeOpen && sideTab === "alerts"}
        onToggleAlerts={() => {
          if (claudeOpen && sideTab === "alerts") return setSideTab("claude");
          openAlerts();
        }}
        claudeOpen={claudeOpen} onToggleClaude={() => setClaudeOpen((o) => !o)} />
      <DrawingToolbar magnet={magnet} onToggleMagnet={() => setMagnet((m) => !m)} getEngine={getEngine} />
      <ChartGrid onEngine={onEngine} magnet={magnet} onEditIndicator={setEditing} onEditPosition={setEditingPosition} />
      {/* Drawn over the chart (same grid cell) so the chart engine stays alive for Claude. */}
      {heatmapOpen && <LiqHeatmapView onClose={() => setHeatmapOpen(false)} />}
      {calcOpen && <CalculatorView onClose={() => setCalcOpen(false)} />}
      {journalOpen && <JournalView onClose={() => setJournalOpen(false)} />}
      {exchangesOpen && <ExchangesView onClose={() => setExchangesOpen(false)} />}
      {/* Kept mounted while hidden so the conversation survives toggling. */}
      <div className="claude-slot" hidden={!claudeOpen}>
        <SidePanel tab={sideTab} onTab={setSideTab} getEngine={getEngine} onOpenHeatmap={() => {
          setCalcOpen(false);
          setJournalOpen(false);
          setExchangesOpen(false);
          setHeatmapOpen(true);
        }} />
      </div>
      {showIndicators && <IndicatorDialog onClose={() => setShowIndicators(false)} />}
      {editing && <IndicatorSettings id={editing} onClose={() => setEditing(null)} />}
      {editingPosition && <PositionDialog id={editingPosition} onClose={() => setEditingPosition(null)} />}
      {showSettings && <ChartSettingsDialog onClose={() => setShowSettings(false)} />}
      <AlertToasts onOpen={() => {
        closePages();
        openAlerts();
      }} />
      <DemoToasts onOpen={() => {
        setClaudeOpen(true);
        setSideTab("demo");
      }} />
      <TooltipLayer />
    </div>
  );
}
