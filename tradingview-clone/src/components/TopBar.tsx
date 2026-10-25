import { useEffect, useState } from "react";
import { INDICATORS, getIndicator, resolveParams } from "../../shared/indicators";
import { CHART_TYPES, INTERVALS } from "../../shared/tools";
import { formatPrice } from "../chart/DrawingsPrimitive";
import { toggleFavorite, useFavorites } from "../favorites";
import { LAYOUTS, addIndicator, exitReplay, loadChart, setLayout, startReplay, store, useChartState, useWorkspace, workspace, type ChartType } from "../store";
import { APP_VERSION, BUILD_SHA, BUILD_TIME, formatBuildTime, reloadToLatest, useUpdateCheck } from "../version";
import { AssetMenu, AssetSearchDialog } from "./AssetPicker";
import { DemoButton } from "./DemoToasts";
import { Menu } from "./Menu";
import { TemplatesMenu } from "./TemplatesMenu";

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
  "1M": "1 Monat",
  "3M": "1 Quartal",
  "1y": "1 Jahr",
  all: "Alles (gesamte Historie in Wochenkerzen)",
};

/** Button text where the key would be ambiguous (1m minute vs. 1M month). */
const INTERVAL_SHORT: Record<string, string> = { "1M": "1Mo", "3M": "1Q", "1y": "1J", all: "Alles" };

interface Props {
  onOpenIndicators: () => void;
  onOpenSettings: () => void;
  heatmapOpen: boolean;
  onToggleHeatmap: () => void;
  calcOpen: boolean;
  onToggleCalc: () => void;
  journalOpen: boolean;
  onToggleJournal: () => void;
  exchangesOpen: boolean;
  onToggleExchanges: () => void;
  demoOpen: boolean;
  onToggleDemo: () => void;
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

export function TopBar({ onOpenIndicators, onOpenSettings, heatmapOpen, onToggleHeatmap, calcOpen, onToggleCalc, journalOpen, onToggleJournal, exchangesOpen, onToggleExchanges, demoOpen, onToggleDemo, claudeOpen, onToggleClaude }: Props) {
  const { symbol, interval, chartType } = useChartState((s) => s);
  const showPrice = useChartState((s) => s.settings.headerPrice);
  const { last, change } = useHeaderPrice();
  const replaying = useChartState((s) => s.replay !== null);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">◢</span> <span className="brand-name">ChartAI</span>
        <VersionBadge />
      </div>
      <div className="symbol-picker">
        <AssetMenu onOpenSearch={() => setSearchOpen(true)} />
        <button className="pill" onClick={() => setSearchOpen(true)} aria-label="Assets suchen" data-tip={"Assets suchen\nNach Rubriken, mit Favoriten"}>
          🔍
        </button>
      </div>
      {searchOpen && <AssetSearchDialog onClose={() => setSearchOpen(false)} />}
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
            {INTERVAL_SHORT[iv] ?? iv}
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
      <button
        className={`pill ${replaying ? "active" : ""}`}
        onClick={() => (replaying ? exitReplay() : startReplay())}
        data-tip={replaying ? "Replay beenden, zurück zum Live-Chart" : "Bar-Replay\nStartkerze wählen und den Chart Kerze für Kerze abspielen\nMit eigenem Replay-Konto zum Üben"}
      >
        ⏪ Replay
      </button>
      <FavoritesMenu />
      <TemplatesMenu />
      <LayoutMenu />
      <button className="pill" onClick={onOpenSettings} aria-label="Chart-Einstellungen" data-tip={"Chart-Einstellungen\nAchsen, Kurslabel, Countdown, Zeitzone, Gitter"}>
        ⚙
      </button>
      <DemoButton active={demoOpen} onClick={onToggleDemo} />
      <button className={`pill ${heatmapOpen ? "active" : ""}`} onClick={onToggleHeatmap} data-tip={"Liquidations-Heatmap im CoinGlass-Stil\nVollbild mit Zeiträumen von 12 h bis 1 Jahr"}>
        🔥 Heatmap
      </button>
      <button className={`pill ${calcOpen ? "active" : ""}`} onClick={onToggleCalc} data-tip={"Trading-Rechner\nPositionsgröße, Erwartungswert, R-Multiple, Fibonacci, Hebel"}>
        🧮 Rechner
      </button>
      <button className={`pill ${journalOpen ? "active" : ""}`} onClick={onToggleJournal} data-tip={"Trading-Journal\nTrades eintragen, Equity-Kurve: bin ich profitabel?"}>
        📒 Journal
      </button>
      <button className={`pill ${exchangesOpen ? "active" : ""}`} onClick={onToggleExchanges} data-tip={"Börsenzeiten\nÖffnungszeiten der großen Börsen in deiner Zeitzone\nAusgewählte Börsen erscheinen im Chart"}>
        🕐 Börsen
      </button>
      <div className="spacer" />
      <button className={`pill claude-toggle ${claudeOpen ? "active" : ""}`} onClick={onToggleClaude} data-tip={"Seitenleiste ein-/ausblenden\nClaude, Orderbuch, Liquidationen"}>
        ✦ Claude
      </button>
    </header>
  );
}
