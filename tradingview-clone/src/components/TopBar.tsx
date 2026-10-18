import { useEffect, useState } from "react";
import { INDICATORS, getIndicator, resolveParams } from "../../shared/indicators";
import { CHART_TYPES, INTERVALS } from "../../shared/tools";
import { formatPrice } from "../chart/DrawingsPrimitive";
import { toggleFavorite, useFavorites } from "../favorites";
import { LAYOUTS, addIndicator, loadChart, setLayout, store, useChartState, useWorkspace, workspace, type ChartType } from "../store";
import { APP_VERSION, BUILD_SHA, BUILD_TIME, formatBuildTime, reloadToLatest, useUpdateCheck } from "../version";
import { Menu } from "./Menu";
import { TemplatesMenu } from "./TemplatesMenu";

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
  heatmapOpen: boolean;
  onToggleHeatmap: () => void;
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

function VersionBadge() {
  const { state, latest, check } = useUpdateCheck();
  const [flash, setFlash] = useState<string | null>(null);
  const tip = [
    `ChartAI Version ${APP_VERSION}`,
    `Build ${BUILD_SHA} vom ${formatBuildTime(BUILD_TIME)}`,
    state === "available" && latest ? `Neu online: ${latest.version} (${latest.sha}) – antippen zum Aktualisieren` : "Antippen: nach Updates suchen",
  ].join("\n");
  return (
    <button
      className={`version-badge ${state === "available" ? "update" : ""}`}
      data-tip={tip}
      aria-label={`Version ${APP_VERSION}`}
      onClick={async () => {
        if (state === "available" || (await check())) return void reloadToLatest();
        setFlash(import.meta.env.PROD ? "aktuell ✓" : "dev");
        window.setTimeout(() => setFlash(null), 2000);
      }}
    >
      {flash ?? `v${APP_VERSION}`}
      {state === "available" && !flash && <span className="update-dot">Update</span>}
    </button>
  );
}

function LayoutMenu() {
  const layout = useWorkspace((w) => w.layout);
  const sync = useWorkspace((w) => w.syncInterval);
  const current = LAYOUTS.find((l) => l.id === layout) ?? LAYOUTS[0];
  return (
    <Menu label={current.icon} className="layout-button" ariaLabel="Chart-Layout" tip={"Chart-Layout\nMehrere Charts gleichzeitig (bis zu 4)\nDer angetippte Chart ist aktiv"}>
      {(close) => (
        <>
          <div className="menu-title">Layout</div>
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              className={`menu-item ${l.id === layout ? "active" : ""}`}
              onClick={() => {
                setLayout(l.id);
                close();
              }}
            >
              <span className="menu-icon">{l.icon}</span>
              {l.label}
            </button>
          ))}
          <label className="menu-check">
            <input type="checkbox" checked={sync} onChange={(e) => workspace.set({ syncInterval: e.target.checked })} />
            Zeiteinheit in allen Charts synchron
          </label>
        </>
      )}
    </Menu>
  );
}

function FavoritesMenu() {
  const favorites = useFavorites();
  return (
    <Menu label="★" className="fav-button" ariaLabel="Favoriten" tip={"Favorisierte Indikatoren\nMit einem Tipp hinzufügen"}>
      {(close) => (
        <>
          <div className="menu-title">Favoriten</div>
          {favorites.length === 0 && <div className="menu-empty">Noch keine Favoriten. Im Indikator-Dialog mit ☆ markieren.</div>}
          {favorites.map((id) => {
            const def = getIndicator(id);
            if (!def) return null;
            return (
              <div className="menu-row" key={id}>
                <button
                  className="menu-item"
                  onClick={() => {
                    addIndicator(id, resolveParams(def), "user");
                    close();
                  }}
                >
                  {def.name}
                </button>
                <button className="fav-star on" onClick={() => toggleFavorite(id)} data-tip="Aus Favoriten entfernen" aria-label="Aus Favoriten entfernen">
                  ★
                </button>
              </div>
            );
          })}
        </>
      )}
    </Menu>
  );
}

export function TopBar({ onOpenIndicators, onOpenSettings, heatmapOpen, onToggleHeatmap, claudeOpen, onToggleClaude }: Props) {
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
        <span className="logo">◢</span> <span className="brand-name">ChartAI</span>
        <VersionBadge />
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
      <FavoritesMenu />
      <TemplatesMenu />
      <LayoutMenu />
      <button className="pill" onClick={onOpenSettings} aria-label="Chart-Einstellungen" data-tip={"Chart-Einstellungen\nAchsen, Kurslabel, Countdown, Zeitzone, Gitter"}>
        ⚙
      </button>
      <button className={`pill ${heatmapOpen ? "active" : ""}`} onClick={onToggleHeatmap} data-tip={"Liquidations-Heatmap im CoinGlass-Stil\nVollbild mit Zeiträumen von 12 h bis 1 Jahr"}>
        🔥 Heatmap
      </button>
      <div className="spacer" />
      <button className={`pill claude-toggle ${claudeOpen ? "active" : ""}`} onClick={onToggleClaude} data-tip={"Seitenleiste ein-/ausblenden\nClaude, Orderbuch, Liquidationen"}>
        ✦ Claude
      </button>
    </header>
  );
}
