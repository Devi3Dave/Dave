import { useCallback, useEffect, useRef, useState } from "react";
import type { ChartEngine } from "./chart/ChartEngine";
import { CalculatorView } from "./components/CalculatorView";
import { ScreenerView } from "./components/ScreenerView";
import { AlertToasts } from "./components/AlertsPanel";
import { ChartGrid } from "./components/ChartGrid";
import { ChartSettingsDialog } from "./components/ChartSettingsDialog";
import { DemoToasts } from "./components/DemoToasts";
import { DrawingToolbar, FavoritesBar } from "./components/DrawingToolbar";
import { ExchangesView } from "./components/ExchangesView";
import { RankingsView } from "./components/RankingsView";
import { JournalView } from "./components/JournalView";
import { IndicatorDialog, IndicatorSettings } from "./components/IndicatorDialog";
import { LiqHeatmapView } from "./components/LiqHeatmapView";
import { PositionDialog } from "./components/PositionDialog";
import { SidePanel, type SideTab } from "./components/SidePanel";
import { TooltipLayer } from "./components/Tooltip";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { GoToDateDialog, OPEN_GOTO_EVENT } from "./components/GoToDateDialog";
import { OPEN_SAVE_LAYOUT_EVENT } from "./components/LayoutMenu";
import { saveLayout, startLayoutWatch } from "./layouts";
import { TopBar } from "./components/TopBar";
import { isCryptoSymbol } from "../shared/marketData";
import { OPEN_ALERTS_EVENT, startAlertFeed } from "./alerts";
import { startDemoFeed } from "./demoAccount";
import { liquidationFeed } from "./market/liquidationFeed";
import { toggleAllDrawingsHidden } from "./drawingEdit";
import { useShortcuts } from "./shortcuts";
import { CHART_TYPES } from "../shared/tools";
import { SHAPE_KINDS } from "../shared/drawingShapes";
import { activeChart, BASIC_TOOLS, exitReplay, loadChart, MAX_CHARTS, startReplay, store, updateSettings, useChartState, workspace, type Interval, type Tool } from "./store";

export default function App() {
  const enginesRef = useRef<(ChartEngine | null)[]>(Array(MAX_CHARTS).fill(null));
  const [showIndicators, setShowIndicators] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editingPosition, setEditingPosition] = useState<string | null>(null);
  const [claudeOpen, setClaudeOpen] = useState(true);
  const [magnet, setMagnet] = useState(true);
  const [sideTab, setSideTab] = useState<SideTab>("claude");
  const [gotoOpen, setGotoOpen] = useState(false);
  useEffect(() => startLayoutWatch(), []);
  useEffect(() => {
    const open = () => setGotoOpen(true);
    window.addEventListener(OPEN_GOTO_EVENT, open);
    return () => window.removeEventListener(OPEN_GOTO_EVENT, open);
  }, []);
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [exchangesOpen, setExchangesOpen] = useState(false);
  const [screenerOpen, setScreenerOpen] = useState(false);
  const [rankingsOpen, setRankingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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
    setScreenerOpen(false);
    setHeatmapOpen(false);
    setCalcOpen(false);
    setJournalOpen(false);
    setExchangesOpen(false);
    setRankingsOpen(false);
  };
  const openAlerts = useCallback(() => {
    setClaudeOpen(true);
    setSideTab("alerts");
  }, []);
  // Drawing menu ("Alarm hinzufügen") opens the alerts tab.
  useEffect(() => {
    window.addEventListener(OPEN_ALERTS_EVENT, openAlerts);
    return () => window.removeEventListener(OPEN_ALERTS_EVENT, openAlerts);
  }, [openAlerts]);

  const onEngine = useCallback((slot: number, e: ChartEngine | null) => {
    enginesRef.current[slot] = e;
  }, []);
  // Claude always works with the active chart.
  const getEngine = useCallback(() => enginesRef.current[workspace.get().active] ?? null, []);

  // Keyboard shortcuts like TradingView; keys are listed and editable in the shortcut list (⌘/).
  const togglePage = (open: boolean, setOpen: (v: boolean) => void) => {
    closePages();
    setOpen(!open);
  };
  const toggleScale = (mode: "log" | "percent") => updateSettings({ scaleMode: store.get().settings.scaleMode === mode ? "normal" : mode });
  const shiftView = (bars: number, zoom = 1) => {
    const ts = getEngine()?.chart.timeScale();
    const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    // Zoom keeps the right edge (newest candles) in place, like TradingView.
    const width = (r.to - r.from) * zoom;
    if (zoom !== 1 && (width < 5 || width > 5000)) return;
    ts.setVisibleLogicalRange({ from: r.to + bars - width, to: r.to + bars });
  };
  const tool = (t: Tool) => () => store.set({ tool: store.get().tool === t && t !== "cursor" ? "cursor" : t });
  useShortcuts({
    ...Object.fromEntries(([...BASIC_TOOLS, ...SHAPE_KINDS] as Tool[]).map((t) => [`tool.${t}`, tool(t)])),
    "drawings.toggleHidden": () => toggleAllDrawingsHidden(activeChart()),
    "chart.reset": () => getEngine()?.resetView(),
    "chart.goto": () => setGotoOpen(true),
    "layout.save": () => {
      if (!saveLayout()) window.dispatchEvent(new Event(OPEN_SAVE_LAYOUT_EVENT));
    },
    "chart.scrollLeft": () => shiftView(-1),
    "chart.scrollRight": () => shiftView(1),
    "chart.zoomIn": () => shiftView(0, 0.8),
    "chart.zoomOut": () => shiftView(0, 1.25),
    "scale.log": () => toggleScale("log"),
    "scale.percent": () => toggleScale("percent"),
    "scale.invert": () => updateSettings({ invertScale: !store.get().settings.invertScale }),
    "panel.alerts": openAlerts,
    "panel.claude": () => setClaudeOpen((o) => !o),
    "panel.demo": () => {
      closePages();
      setClaudeOpen(true);
      setSideTab("demo");
    },
    "panel.objects": () => {
      closePages();
      setClaudeOpen(true);
      setSideTab("objects");
    },
    "panel.notes": () => {
      closePages();
      setClaudeOpen(true);
      setSideTab("notes");
    },
    "panel.strategy": () => {
      closePages();
      setClaudeOpen(true);
      setSideTab("strategy");
    },
    "dialog.indicators": () => setShowIndicators(true),
    "dialog.settings": () => setShowSettings(true),
    "dialog.shortcuts": () => setShortcutsOpen((o) => !o),
    "page.heatmap": () => togglePage(heatmapOpen, setHeatmapOpen),
    "page.calc": () => togglePage(calcOpen, setCalcOpen),
    "page.journal": () => togglePage(journalOpen, setJournalOpen),
    "page.exchanges": () => togglePage(exchangesOpen, setExchangesOpen),
    "page.rankings": () => togglePage(rankingsOpen, setRankingsOpen),
    "replay.toggle": () => (store.get().replay ? exitReplay() : startReplay()),
    ...Object.fromEntries(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"].map((iv) => [`interval.${iv}`, () => void loadChart(store.get().symbol, iv as Interval)])),
    ...Object.fromEntries(CHART_TYPES.map((t) => [`chartType.${t}`, () => store.set({ chartType: t })])),
  });

  return (
    <div className={`app ${claudeOpen ? "with-claude" : ""}`}>
      <TopBar
        onOpenIndicators={() => setShowIndicators(true)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        heatmapOpen={heatmapOpen}
        onToggleHeatmap={() => {
          setScreenerOpen(false);
          setCalcOpen(false);
          setJournalOpen(false);
          setExchangesOpen(false);
          setRankingsOpen(false);
          setHeatmapOpen((o) => !o);
        }}
        calcOpen={calcOpen}
        onToggleCalc={() => {
          setScreenerOpen(false);
          setHeatmapOpen(false);
          setJournalOpen(false);
          setExchangesOpen(false);
          setRankingsOpen(false);
          setCalcOpen((o) => !o);
        }}
        journalOpen={journalOpen}
        onToggleJournal={() => {
          setScreenerOpen(false);
          setHeatmapOpen(false);
          setCalcOpen(false);
          setExchangesOpen(false);
          setRankingsOpen(false);
          setJournalOpen((o) => !o);
        }}
        exchangesOpen={exchangesOpen}
        onToggleExchanges={() => {
          setScreenerOpen(false);
          setHeatmapOpen(false);
          setCalcOpen(false);
          setJournalOpen(false);
          setRankingsOpen(false);
          setExchangesOpen((o) => !o);
        }}
        rankingsOpen={rankingsOpen}
        onToggleRankings={() => {
          closePages();
          setRankingsOpen(!rankingsOpen);
        }}
        demoOpen={claudeOpen && sideTab === "demo"}
        onToggleDemo={() => {
          if (claudeOpen && sideTab === "demo" && !(heatmapOpen || calcOpen || journalOpen || exchangesOpen || screenerOpen || rankingsOpen)) return setSideTab("claude");
          // Trading needs the chart, so full-screen pages close.
          setScreenerOpen(false);
          setHeatmapOpen(false);
          setCalcOpen(false);
          setJournalOpen(false);
          setExchangesOpen(false);
          setRankingsOpen(false);
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
      <FavoritesBar />
      <ChartGrid onEngine={onEngine} magnet={magnet} onEditIndicator={setEditing} onEditPosition={setEditingPosition} />
      {/* Drawn over the chart (same grid cell) so the chart engine stays alive for Claude. */}
      {heatmapOpen && <LiqHeatmapView onClose={() => setHeatmapOpen(false)} />}
      {calcOpen && <CalculatorView onClose={() => setCalcOpen(false)} />}
      {screenerOpen && <ScreenerView onClose={() => setScreenerOpen(false)} />}
      {journalOpen && <JournalView onClose={() => setJournalOpen(false)} getEngine={getEngine} />}
      {exchangesOpen && <ExchangesView onClose={() => setExchangesOpen(false)} />}
      {rankingsOpen && <RankingsView onClose={() => setRankingsOpen(false)} />}
      {/* Kept mounted while hidden so the conversation survives toggling. */}
      <div className="claude-slot" hidden={!claudeOpen}>
        <SidePanel
          tab={sideTab}
          onTab={setSideTab}
          getEngine={getEngine}
          onOpenHeatmap={() => {
            closePages();
            setHeatmapOpen(true);
          }}
          onOpenScreener={() => {
            closePages();
            setScreenerOpen(true);
          }}
          onEditIndicator={setEditing}
        />
      </div>
      {showIndicators && <IndicatorDialog onClose={() => setShowIndicators(false)} />}
      {editing && <IndicatorSettings id={editing} onClose={() => setEditing(null)} />}
      {editingPosition && <PositionDialog id={editingPosition} onClose={() => setEditingPosition(null)} />}
      {showSettings && <ChartSettingsDialog onClose={() => setShowSettings(false)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {gotoOpen && <GoToDateDialog getEngine={getEngine} onClose={() => setGotoOpen(false)} />}
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
