import { useCallback, useEffect, useRef, useState } from "react";
import type { ChartEngine } from "./chart/ChartEngine";
import { ChartArea } from "./components/ChartArea";
import { ChartSettingsDialog } from "./components/ChartSettingsDialog";
import { ClaudePanel } from "./components/ClaudePanel";
import { DrawingToolbar } from "./components/DrawingToolbar";
import { IndicatorDialog, IndicatorSettings } from "./components/IndicatorDialog";
import { TooltipLayer } from "./components/Tooltip";
import { TopBar } from "./components/TopBar";
import { loadChart, store } from "./store";

export default function App() {
  const engineRef = useRef<ChartEngine | null>(null);
  const [showIndicators, setShowIndicators] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [claudeOpen, setClaudeOpen] = useState(true);
  const [magnet, setMagnet] = useState(true);

  useEffect(() => {
    const { symbol, interval } = store.get();
    void loadChart(symbol, interval);
  }, []);

  const onEngine = useCallback((e: ChartEngine | null) => {
    engineRef.current = e;
  }, []);
  const getEngine = useCallback(() => engineRef.current, []);

  return (
    <div className={`app ${claudeOpen ? "with-claude" : ""}`}>
      <TopBar onOpenIndicators={() => setShowIndicators(true)} onOpenSettings={() => setShowSettings(true)} claudeOpen={claudeOpen} onToggleClaude={() => setClaudeOpen((o) => !o)} />
      <DrawingToolbar magnet={magnet} onToggleMagnet={() => setMagnet((m) => !m)} />
      <ChartArea onEngine={onEngine} magnet={magnet} onEditIndicator={setEditing} />
      {/* Kept mounted while hidden so the conversation survives toggling. */}
      <div className="claude-slot" hidden={!claudeOpen}>
        <ClaudePanel getEngine={getEngine} />
      </div>
      {showIndicators && <IndicatorDialog onClose={() => setShowIndicators(false)} />}
      {editing && <IndicatorSettings id={editing} onClose={() => setEditing(null)} />}
      {showSettings && <ChartSettingsDialog onClose={() => setShowSettings(false)} />}
      <TooltipLayer />
    </div>
  );
}
