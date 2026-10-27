import { useEffect, useMemo, useState } from "react";
import { DEFAULT_TESTER, STRATEGIES, defaultParams, getStrategy, runStrategy, type Report, type TesterSettings } from "../../shared/strategyTester";
import { formatPrice } from "../chart/DrawingsPrimitive";
import { charts, useChart, useWorkspace, type ChartMarker, type ChartStore } from "../store";

const KEY = "chartai.strategy.v1";

interface Saved {
  id: string;
  params: Record<string, Record<string, number>>;
  settings: TesterSettings;
  showTrades: boolean;
}

function load(): Saved {
  const empty: Saved = { id: STRATEGIES[0].id, params: {}, settings: DEFAULT_TESTER, showTrades: true };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!v || typeof v !== "object") return empty;
    return { id: getStrategy(v.id) ? v.id : empty.id, params: v.params ?? {}, settings: { ...DEFAULT_TESTER, ...v.settings }, showTrades: v.showTrades !== false };
  } catch {
    return empty;
  }
}

const MARKER_PREFIX = "strategy-";

/** Entry and exit arrows of the test in the chart (removed again when the panel closes). */
function showTradeMarkers(chart: ChartStore, report: Report | null) {
  chart.set((s) => {
    const kept = s.markers.filter((m) => !m.id.startsWith(MARKER_PREFIX));
    if (!report) return kept.length === s.markers.length ? {} : { markers: kept };
    const marks: ChartMarker[] = report.trades.flatMap((t, k) => {
      const long = t.dir === 1;
      const entry: ChartMarker = { id: `${MARKER_PREFIX}e${k}`, author: "user", time: t.entryTime, position: long ? "below" : "above", shape: long ? "arrowUp" : "arrowDown", color: long ? "#2962ff" : "#f23645", text: long ? "Long" : "Short" };
      if (t.open) return [entry];
      const exit: ChartMarker = { id: `${MARKER_PREFIX}x${k}`, author: "user", time: t.exitTime, position: long ? "above" : "below", shape: "circle", color: t.pnl >= 0 ? "#089981" : "#f23645", text: `${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(0)}` };
      return [entry, exit];
    });
    return { markers: [...kept, ...marks] };
  });
}

export const isStrategyMarker = (m: ChartMarker) => m.id.startsWith(MARKER_PREFIX);

const money = (v: number) => `${v < 0 ? "−" : v > 0 ? "+" : ""}${Math.abs(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) => `${v < 0 ? "−" : v > 0 ? "+" : ""}${Math.abs(v).toLocaleString("de-DE", { maximumFractionDigits: 2 })} %`;
const tone = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "");

/** TradingView's strategy tester for the built-in strategies on the active chart's candles. */
export function StrategyPanel() {
  const slot = useWorkspace((w) => w.active);
  const chart = charts[slot];
  const bars = useChart(chart, (s) => s.bars);
  const symbol = useChart(chart, (s) => s.symbol);
  const interval = useChart(chart, (s) => s.interval);
  const [saved, setSaved] = useState(load);
  const [tab, setTab] = useState<"summary" | "trades">("summary");
  const def = getStrategy(saved.id) ?? STRATEGIES[0];
  const params = { ...defaultParams(def), ...saved.params[def.id] };

  const update = (patch: Partial<Saved>) =>
    setSaved((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // not remembered
      }
      return next;
    });

  const report = useMemo(() => (bars.length > 2 ? runStrategy(bars, def, params, saved.settings) : null), [bars, def, JSON.stringify(params), saved.settings]);

  useEffect(() => {
    showTradeMarkers(chart, saved.showTrades ? report : null);
  }, [chart, report, saved.showTrades]);
  useEffect(() => () => showTradeMarkers(chart, null), [chart]);

  const setting = <K extends keyof TesterSettings>(k: K, v: TesterSettings[K]) => update({ settings: { ...saved.settings, [k]: v } });

  return (
    <div className="strategy-panel">
      <div className="strategy-head">
        <select value={def.id} onChange={(e) => update({ id: e.target.value })} aria-label="Strategie">
          {STRATEGIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="strategy-symbol">
          {symbol} · {interval} · {bars.length} Kerzen
        </span>
      </div>
      <p className="strategy-desc">{def.description}</p>

      <details className="strategy-settings">
        <summary>Eingaben und Eigenschaften</summary>
        <div className="strategy-grid">
          {def.params.map((p) => (
            <label key={p.key}>
              {p.label}
              <input
                type="number"
                value={params[p.key]}
                min={p.min}
                step={p.step ?? 1}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) update({ params: { ...saved.params, [def.id]: { ...params, [p.key]: v } } });
                }}
              />
            </label>
          ))}
          <label>
            Startkapital
            <input type="number" value={saved.settings.capital} min={1} onChange={(e) => Number(e.target.value) > 0 && setting("capital", Number(e.target.value))} />
          </label>
          <label>
            Ordergröße (% vom Kapital)
            <input type="number" value={saved.settings.sizePct} min={1} max={1000} onChange={(e) => Number(e.target.value) > 0 && setting("sizePct", Number(e.target.value))} />
          </label>
          <label>
            Kommission (% je Seite)
            <input type="number" value={saved.settings.commissionPct} min={0} step={0.01} onChange={(e) => Number(e.target.value) >= 0 && setting("commissionPct", Number(e.target.value))} />
          </label>
          <label>
            Richtung
            <select value={saved.settings.direction} onChange={(e) => setting("direction", e.target.value as TesterSettings["direction"])}>
              <option value="both">Long und Short</option>
              <option value="long">Nur Long</option>
              <option value="short">Nur Short</option>
            </select>
          </label>
        </div>
        <button className="strategy-reset" onClick={() => update({ params: { ...saved.params, [def.id]: defaultParams(def) }, settings: DEFAULT_TESTER })}>
          Standardwerte
        </button>
      </details>

      <label className="settings-toggle strategy-toggle">
        <input type="checkbox" checked={saved.showTrades} onChange={(e) => update({ showTrades: e.target.checked })} /> Trades im Chart zeigen
      </label>

      {!report ? (
        <div className="object-empty">Keine Kursdaten</div>
      ) : (
        <>
          <EquityCurve report={report} capital={saved.settings.capital} />
          <div className="segmented strategy-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "summary"} className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")}>
              Übersicht
            </button>
            <button role="tab" aria-selected={tab === "trades"} className={tab === "trades" ? "active" : ""} onClick={() => setTab("trades")}>
              Trades ({report.trades.length})
            </button>
          </div>
          {tab === "summary" ? <Summary r={report} /> : <TradeList r={report} />}
          <p className="object-hint">
            Signal auf dem Schluss, Ausführung zur Eröffnung der nächsten Kerze (wie TradingViews Broker-Emulator). Getestet nur auf den geladenen
            Kerzen; vergangene Ergebnisse sind keine Garantie.
          </p>
        </>
      )}
    </div>
  );
}

function Summary({ r }: { r: Report }) {
  const rows: [string, string, string?][] = [
    ["Nettogewinn", `${money(r.netProfit)} (${pct(r.netProfitPct)})`, tone(r.netProfit)],
    ["Bruttogewinn", money(r.grossProfit), "pos"],
    ["Bruttoverlust", money(r.grossLoss), "neg"],
    ["Profit-Faktor", r.profitFactor === null ? "–" : r.profitFactor.toLocaleString("de-DE", { maximumFractionDigits: 3 })],
    ["Max. Drawdown", `${money(-r.maxDrawdown)} (${pct(-r.maxDrawdownPct)})`, "neg"],
    ["Buy & Hold", `${money(r.buyHold)} (${pct(r.buyHoldPct)})`, tone(r.buyHold)],
    ["Abgeschlossene Trades", String(r.closedTrades)],
    ["Gewinner / Verlierer", `${r.winners} / ${r.losers}`],
    ["Trefferquote", `${r.winRate.toLocaleString("de-DE", { maximumFractionDigits: 2 })} %`],
    ["Ø Trade", money(r.avgTrade), tone(r.avgTrade)],
    ["Ø Gewinn / Ø Verlust", `${money(r.avgWin)} / ${money(r.avgLoss)}`],
    ["Verhältnis Ø Gewinn / Ø Verlust", r.ratioWinLoss === null ? "–" : r.ratioWinLoss.toLocaleString("de-DE", { maximumFractionDigits: 3 })],
    ["Größter Gewinn / Verlust", `${money(r.largestWin)} / ${money(r.largestLoss)}`],
    ["Ø Kerzen im Trade", r.avgBars.toLocaleString("de-DE", { maximumFractionDigits: 1 })],
    ["Offener Gewinn/Verlust", money(r.openPnl), tone(r.openPnl)],
    ["Kommission bezahlt", money(-r.commission)],
  ];
  return (
    <div className="strategy-summary">
      {rows.map(([k, v, t]) => (
        <div className="data-row" key={k}>
          <span>{k}</span>
          <span className={t ?? ""}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function TradeList({ r }: { r: Report }) {
  const date = (t: number) => new Date(t * 1000).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="strategy-trades">
      {r.trades
        .map((t, i) => ({ t, n: i + 1 }))
        .reverse()
        .map(({ t, n }) => (
          <div className="strategy-trade" key={n}>
            <div className="strategy-trade-head">
              <span>
                #{n} {t.dir === 1 ? "Long" : "Short"}
                {t.open ? " · offen" : ""}
              </span>
              <span className={tone(t.pnl)}>
                {money(t.pnl)} ({pct(t.pnlPct)})
              </span>
            </div>
            <div className="strategy-trade-sub">
              {date(t.entryTime)} @ {formatPrice(t.entryPrice)} → {date(t.exitTime)} @ {formatPrice(t.exitPrice)} · {t.exitIndex - t.entryIndex} Kerzen
            </div>
          </div>
        ))}
    </div>
  );
}

/** Equity curve with the capital as a dashed line (TradingView's equity chart in the strategy tester). */
function EquityCurve({ report, capital }: { report: Report; capital: number }) {
  const w = 320;
  const h = 110;
  const eq = report.equity;
  if (eq.length < 2) return null;
  const lo = Math.min(capital, ...eq);
  const hi = Math.max(capital, ...eq);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (eq.length - 1)) * w;
  const y = (v: number) => h - 4 - ((v - lo) / span) * (h - 8);
  const path = eq.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const up = eq[eq.length - 1] >= capital;
  return (
    <svg className="strategy-equity" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`Equity-Kurve von ${capital} auf ${eq[eq.length - 1].toFixed(2)}`}>
      <path d={`${path}L${w},${h}L0,${h}Z`} fill={up ? "rgba(8,153,129,0.15)" : "rgba(242,54,69,0.15)"} />
      <path d={path} fill="none" stroke={up ? "#089981" : "#f23645"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <line x1="0" x2={w} y1={y(capital)} y2={y(capital)} stroke="#787b86" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
