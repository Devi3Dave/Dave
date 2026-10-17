import { useEffect, useState } from "react";
import { CHART_TYPES, INTERVALS } from "../../shared/tools";
import { loadChart, store, useChartState, type ChartType } from "../store";

const POPULAR = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "AAPL", "MSFT", "NVDA", "TSLA", "^GSPC", "^GDAXI", "EURUSD=X", "GC=F"];

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  candles: "Kerzen",
  bars: "Balken",
  heikin_ashi: "Heikin Ashi",
  line: "Linie",
  area: "Fläche",
};

interface Props {
  onOpenIndicators: () => void;
  claudeOpen: boolean;
  onToggleClaude: () => void;
}

export function TopBar({ onOpenIndicators, claudeOpen, onToggleClaude }: Props) {
  const { symbol, interval, chartType } = useChartState((s) => s);
  const [input, setInput] = useState(symbol);
  useEffect(() => setInput(symbol), [symbol]);

  const submit = () => {
    const next = input.trim().toUpperCase();
    if (next && next !== symbol) void loadChart(next, interval);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">◢</span> ChartAI
      </div>
      <form
        className="symbol-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input list="symbols" value={input} onChange={(e) => setInput(e.target.value)} onBlur={submit} spellCheck={false} aria-label="Symbol" />
        <datalist id="symbols">
          {POPULAR.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </form>
      <div className="group">
        {INTERVALS.map((iv) => (
          <button key={iv} className={iv === interval ? "active" : ""} onClick={() => loadChart(symbol, iv)}>
            {iv}
          </button>
        ))}
      </div>
      <select value={chartType} onChange={(e) => store.set({ chartType: e.target.value as ChartType })} aria-label="Charttyp">
        {CHART_TYPES.map((t) => (
          <option key={t} value={t}>
            {CHART_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <button className="pill" onClick={onOpenIndicators}>
        ƒx Indikatoren
      </button>
      <div className="spacer" />
      <button className={`pill claude-toggle ${claudeOpen ? "active" : ""}`} onClick={onToggleClaude}>
        ✦ Claude
      </button>
    </header>
  );
}
