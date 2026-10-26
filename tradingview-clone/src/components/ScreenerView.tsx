import { useEffect, useMemo, useState } from "react";
import { DEFAULT_FILTER, screen, technicals, type ScreenerFilter, type ScreenerRow, type ScreenerSort, type ScreenerTechnicals } from "../../shared/screener";
import { formatPrice } from "../chart/DrawingsPrimitive";
import { fetchMarketData, loadChart, useChartState } from "../store";
import { fetchTickers, toggleInWatchlist, useWatchlists } from "../watchlists";

const FILTER_KEY = "chartai.screener.v1";
/** Pairs whose daily candles are loaded for the technical columns. */
const TECH_LIMIT = 60;

function readFilter(): ScreenerFilter {
  try {
    return { ...DEFAULT_FILTER, ...(JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}") as Partial<ScreenerFilter>) };
  } catch {
    return DEFAULT_FILTER;
  }
}

const pct = (v: number | null | undefined, digits = 2) => (v == null ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(digits).replace(".", ",")} %`);
const tone = (v: number | null | undefined) => (v == null ? "" : v >= 0 ? "up" : "down");
const volume = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)} Mrd` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} Mio` : `${Math.round(v / 1e3)} Tsd`).replace(".", ",");

const COLUMNS: { key: ScreenerSort; label: string; tip: string; tech?: boolean }[] = [
  { key: "symbol", label: "Paar", tip: "Binance-Spot-Paar gegen USDT" },
  { key: "price", label: "Kurs", tip: "Letzter Kurs" },
  { key: "changePct", label: "24 h", tip: "Veränderung über 24 Stunden" },
  { key: "quoteVolume", label: "Volumen", tip: "Umsatz der letzten 24 Stunden in USDT" },
  { key: "rangePct", label: "Spanne", tip: "Lage im 24-h-Bereich: 0 % am Tief, 100 % am Hoch" },
  { key: "week", label: "7 T", tip: "Veränderung über 7 Tage (Tageskerzen)", tech: true },
  { key: "month", label: "30 T", tip: "Veränderung über 30 Tage (Tageskerzen)", tech: true },
  { key: "rsi", label: "RSI", tip: "RSI(14) auf Tageskerzen (Wilder)", tech: true },
  { key: "sma50Pct", label: "SMA 50", tip: "Abstand zum 50-Tage-Durchschnitt", tech: true },
  { key: "sma200Pct", label: "SMA 200", tip: "Abstand zum 200-Tage-Durchschnitt", tech: true },
];

/** Full-screen crypto screener over every Binance USDT pair, like TradingView's crypto screener. */
export function ScreenerView({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [tech, setTech] = useState<Record<string, ScreenerTechnicals>>({});
  const [techLoading, setTechLoading] = useState(false);
  const [filter, setFilter] = useState<ScreenerFilter>(readFilter);
  const [sort, setSort] = useState<ScreenerSort>("quoteVolume");
  const [desc, setDesc] = useState(true);
  const interval = useChartState((s) => s.interval);
  const watch = useWatchlists((s) => s.lists.find((l) => l.id === s.active) ?? s.lists[0]);

  useEffect(() => {
    let alive = true;
    const run = () =>
      fetchTickers()
        .then((r) => {
          if (!alive) return;
          setRows(r);
          setError(null);
          setLoadedAt(Date.now());
        })
        .catch((err: Error) => alive && setError(`Binance nicht erreichbar: ${err.message}`));
    void run();
    const t = window.setInterval(run, 30_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
    } catch {
      // not remembered
    }
  }, [filter]);

  const list = useMemo(() => screen(rows, tech, filter, sort, desc), [rows, tech, filter, sort, desc]);
  const patch = (p: Partial<ScreenerFilter>) => setFilter((f) => ({ ...f, ...p }));
  const sortBy = (key: ScreenerSort) => {
    if (key === sort) setDesc((d) => !d);
    else {
      setSort(key);
      setDesc(key !== "symbol");
    }
  };

  /** Daily candles for the first pairs of the current list (without technical filters, so they can be filled). */
  const loadTech = async () => {
    setTechLoading(true);
    const targets = screen(rows, tech, { ...filter, rsi: "all", trend: "all" }, sort, desc)
      .filter((r) => !tech[r.symbol])
      .slice(0, TECH_LIMIT);
    for (let i = 0; i < targets.length; i += 6) {
      const batch = await Promise.all(
        targets.slice(i, i + 6).map(async (r) => {
          try {
            const d = await fetchMarketData(r.symbol, "1d", 250);
            return d.source === "demo" ? null : ([r.symbol, technicals(d.bars)] as const);
          } catch {
            return null;
          }
        }),
      );
      setTech((t) => ({ ...t, ...Object.fromEntries(batch.filter((b) => b !== null)) }));
    }
    setTechLoading(false);
  };
  const techCount = Object.keys(tech).length;
  const techFilter = filter.rsi !== "all" || filter.trend !== "all";

  return (
    <div className="heatmap-view calc-view sc-view">
      <div className="heatmap-head">
        <strong>Krypto-Screener</strong>
        <span className="heatmap-symbol">
          {list.length} von {rows.length} Binance-USDT-Paaren
          {loadedAt && ` · Stand ${new Date(loadedAt).toLocaleTimeString("de-DE")}`}
        </span>
        <div className="spacer" />
        <button className="pill" onClick={onClose} data-tip="Zurück zum Chart">
          ✕ Chart
        </button>
      </div>
      <div className="sc-filters">
        <div className="calc-input sc-search">
          <input placeholder="Suchen, z. B. SOL" value={filter.query} onChange={(e) => patch({ query: e.target.value })} aria-label="Suchen" />
        </div>
        <label>
          Volumen ab{" "}
          <select value={filter.minVolume} onChange={(e) => patch({ minVolume: Number(e.target.value) })}>
            {[0, 100_000, 1_000_000, 10_000_000, 100_000_000].map((v) => (
              <option key={v} value={v}>
                {v ? `${volume(v)} $` : "alle"}
              </option>
            ))}
          </select>
        </label>
        <div className="jr-seg">
          {(
            [
              ["all", "Alle"],
              ["gainers", "Gewinner"],
              ["losers", "Verlierer"],
            ] as const
          ).map(([v, l]) => (
            <button key={v} className={filter.direction === v ? "active" : ""} onClick={() => patch({ direction: v })}>
              {l}
            </button>
          ))}
        </div>
        <label>
          RSI{" "}
          <select value={filter.rsi} onChange={(e) => patch({ rsi: e.target.value as ScreenerFilter["rsi"] })}>
            <option value="all">alle</option>
            <option value="oversold">überverkauft (&lt; 30)</option>
            <option value="overbought">überkauft (&gt; 70)</option>
          </select>
        </label>
        <label>
          Trend{" "}
          <select value={filter.trend} onChange={(e) => patch({ trend: e.target.value as ScreenerFilter["trend"] })}>
            <option value="all">alle</option>
            <option value="above200">über SMA 200</option>
            <option value="below200">unter SMA 200</option>
          </select>
        </label>
        <button className="pill" onClick={() => void loadTech()} disabled={techLoading || !rows.length} data-tip={`Tageskerzen der ersten ${TECH_LIMIT} Paare laden: 7 T, 30 T, RSI, SMA 50/200`}>
          {techLoading ? "Lade Technik …" : `📈 Technik laden (${techCount ? `${techCount} geladen, ` : ""}nächste ${TECH_LIMIT})`}
        </button>
      </div>
      <div className="calc-body">
        {error && <div className="chart-overlay error sc-error">{error}</div>}
        {techFilter && techCount === 0 && <div className="dm-muted">RSI- und Trendfilter brauchen die Technik-Spalten: „📈 Technik laden“.</div>}
        <table className="calc-table sc-table">
          <thead>
            <tr>
              <th />
              {COLUMNS.map((c) => (
                <th key={c.key} className={`${c.key === sort ? "sorted" : ""} ${c.tech ? "tech" : ""}`} onClick={() => sortBy(c.key)} data-tip={c.tip}>
                  {c.label}
                  {c.key === sort ? (desc ? " ▾" : " ▴") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 300).map((r) => {
              const t = tech[r.symbol];
              const starred = watch.symbols.includes(r.symbol);
              return (
                <tr key={r.symbol}>
                  <td>
                    <button className={`fav-star ${starred ? "on" : ""}`} onClick={() => toggleInWatchlist(r.symbol)} aria-label={starred ? "Aus Watchlist entfernen" : "Zur Watchlist"} data-tip={`${starred ? "Aus" : "Zu"} „${watch.name}“`}>
                      {starred ? "★" : "☆"}
                    </button>
                  </td>
                  <td>
                    <button
                      className="dm-sym"
                      onClick={() => {
                        void loadChart(r.symbol, interval);
                        onClose();
                      }}
                      data-tip="Im Chart öffnen"
                    >
                      {r.base}
                    </button>
                  </td>
                  <td>{formatPrice(r.price)}</td>
                  <td className={tone(r.changePct)}>{pct(r.changePct)}</td>
                  <td>{volume(r.quoteVolume)}</td>
                  <td>
                    <span className="sc-range">
                      <span style={{ left: `${Math.max(0, Math.min(100, r.rangePct))}%` }} />
                    </span>
                  </td>
                  <td className={`tech ${tone(t?.week)}`}>{pct(t?.week, 1)}</td>
                  <td className={`tech ${tone(t?.month)}`}>{pct(t?.month, 1)}</td>
                  <td className={`tech ${t?.rsi == null ? "" : t.rsi < 30 ? "up" : t.rsi > 70 ? "down" : ""}`}>{t?.rsi == null ? "–" : t.rsi.toFixed(0)}</td>
                  <td className={`tech ${tone(t?.sma50Pct)}`}>{pct(t?.sma50Pct, 1)}</td>
                  <td className={`tech ${tone(t?.sma200Pct)}`}>{pct(t?.sma200Pct, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length > 300 && <div className="dm-muted">… {list.length - 300} weitere, Filter verfeinern</div>}
        <p className="hint">
          Quelle: Binance Spot (24-h-Statistik, alle 30 s neu). Ohne Hebel-Token und Stablecoin-Paare. Technik aus Tageskerzen: RSI(14) nach Wilder, Abstand zu SMA 50/200.
        </p>
      </div>
    </div>
  );
}
