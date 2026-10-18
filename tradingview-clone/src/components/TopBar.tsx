import { useEffect, useState } from "react";
import { INDICATORS } from "../../shared/indicators";
import { CHART_TYPES, INTERVALS } from "../../shared/tools";
import { formatPrice } from "../chart/DrawingsPrimitive";
import { loadChart, store, useChartState, type ChartType } from "../store";

const POPULAR = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "AAPL", "MSFT", "NVDA", "TSLA", "^GSPC", "^GDAXI", "EURUSD=X", "GC=F"];

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  candles: "Kerzen",
  bars: "Balken",
  heikin_ashi: "Heikin Ashi",
  line: "Linie",
  area: "Fläche",
};

const INTERVAL_LABELS: Record<string, string> = {
  "1m": "1 Minute",
  "5m": "5 Minuten",
  "15m": "15 Minuten",
  "30m": "30 Minuten",
  "1h": "1 Stunde",
  "4h": "4 Stunden",
  "1d": "1 Tag",
  "1w": "1 Woche",
};

interface Props {
  onOpenIndicators: () => void;
  onOpenSettings: () => void;
  claudeOpen: boolean;
  onToggleClaude: () => void;
}

/** Last price and change over the last 24 hours (or vs. the previous candle on daily+ charts). */
function useHeaderPrice() {
  const bars = useChartState((s) => s.bars);
  const symbol = useChartState((s) => s.symbol);
  const last = bars[bars.length - 1];
  let ref = bars[bars.length - 2];
  if (last) {
    for (let i = bars.length - 1; i >= 0; i--) {
      if (bars[i].time <= last.time - 86400) {
        ref = bars[i];
        break;
      }
    }
  }
  const change = last && ref ? ((last.close - ref.close) / ref.close) * 100 : null;
  useEffect(() => {
    document.title = last ? `${symbol} ${formatPrice(last.close)} – ChartAI` : "ChartAI – TradingView-Klon mit Claude";
  }, [symbol, last]);
  return { last, change };
}

export function TopBar({ onOpenIndicators, onOpenSettings, claudeOpen, onToggleClaude }: Props) {
  const { symbol, interval, chartType } = useChartState((s) => s);
  const showPrice = useChartState((s) => s.settings.headerPrice);
  const { last, change } = useHeaderPrice();
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
        <input
          list="symbols"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onBlur={submit}
          spellCheck={false}
          aria-label="Symbol"
          data-tip={"Symbol suchen, z. B. BTCUSDT, ETHUSDT\noder AAPL, ^GDAXI (Enter zum Laden)"}
        />
        <datalist id="symbols">
          {POPULAR.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </form>
      {showPrice && last && (
        <div className="header-price" data-tip={"Aktueller Kurs\nVeränderung über 24 Stunden (bei Tages-/Wochenchart zur Vorkerze)"}>
          <strong className={change !== null && change < 0 ? "down" : "up"}>{formatPrice(last.close)}</strong>
          {change !== null && (
            <span className={change < 0 ? "down" : "up"}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}%
            </span>
          )}
        </div>
      )}
      <div className="group">
        {INTERVALS.map((iv) => (
          <button key={iv} className={iv === interval ? "active" : ""} onClick={() => loadChart(symbol, iv)} data-tip={`Zeiteinheit: ${INTERVAL_LABELS[iv]}`}>
            {iv}
          </button>
        ))}
      </div>
      <select value={chartType} onChange={(e) => store.set({ chartType: e.target.value as ChartType })} aria-label="Charttyp" data-tip="Charttyp">
        {CHART_TYPES.map((t) => (
          <option key={t} value={t}>
            {CHART_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <button className="pill" onClick={onOpenIndicators} data-tip={`Indikatoren hinzufügen (${INDICATORS.length} verfügbar)`}>
        ƒx Indikatoren
      </button>
      <button className="pill" onClick={onOpenSettings} aria-label="Chart-Einstellungen" data-tip={"Chart-Einstellungen\nAchsen, Kurslabel, Countdown, Zeitzone, Gitter"}>
        ⚙
      </button>
      <div className="spacer" />
      <button className={`pill claude-toggle ${claudeOpen ? "active" : ""}`} onClick={onToggleClaude} data-tip="Claude-Panel ein-/ausblenden">
        ✦ Claude
      </button>
    </header>
  );
}
