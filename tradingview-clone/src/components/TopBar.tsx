import { useEffect, useState } from "react";
import { INDICATORS, getIndicator, resolveParams } from "../../shared/indicators";
import { intervalSeconds, isValidInterval, normalizeInterval } from "../../shared/marketData";
import { CHART_TYPES, INTERVALS, MAIN_INTERVALS } from "../../shared/tools";
import { formatPrice } from "../chart/DrawingsPrimitive";
import { toggleFavorite, useFavorites } from "../favorites";
import { LAYOUTS, addIndicator, exitReplay, loadChart, setLayout, startReplay, store, useChartState, useWorkspace, workspace, type ChartType, type Interval } from "../store";
import { APP_VERSION, BUILD_SHA, BUILD_TIME, formatBuildTime, reloadToLatest, useUpdateCheck } from "../version";
import { AssetMenu, AssetSearchDialog } from "./AssetPicker";
import { useAlerts } from "../alerts";
import { DemoButton } from "./DemoToasts";
import { RefreshButton } from "./FreshnessBadge";
import { Menu } from "./Menu";
import { TemplatesMenu } from "./TemplatesMenu";

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  candles: "Kerzen",
  hollow_candles: "Hohle Kerzen",
  bars: "Balken",
  heikin_ashi: "Heikin Ashi",
  line: "Linie",
  step_line: "Stufenlinie",
  area: "Fläche",
  baseline: "Baseline",
  renko: "Renko",
  line_break: "Line Break",
};

const SPECIAL_LABELS: Record<string, string> = {
  "1M": "1 Monat",
  "3M": "1 Quartal",
  "1y": "1 Jahr",
  all: "Alles (gesamte Historie in Wochenkerzen)",
};
const UNIT_NAMES: Record<string, [string, string]> = { s: ["Sekunde", "Sekunden"], m: ["Minute", "Minuten"], h: ["Stunde", "Stunden"], d: ["Tag", "Tage"], w: ["Woche", "Wochen"] };

/** "7 Minuten", "1 Stunde", "1 Quartal" … */
function intervalLabel(iv: string): string {
  if (SPECIAL_LABELS[iv]) return SPECIAL_LABELS[iv];
  const m = /^(\d+)([smhdw])$/.exec(iv);
  if (!m) return iv;
  const [one, many] = UNIT_NAMES[m[2]];
  return `${m[1]} ${m[1] === "1" ? one : many}`;
}

/** Button text where the key would be ambiguous (1m minute vs. 1M month). */
const INTERVAL_SHORT: Record<string, string> = { "1M": "1Mo", "3M": "1Q", "1y": "1J", all: "Alles" };
const shortLabel = (iv: string) => INTERVAL_SHORT[iv] ?? iv.replace(/d$/, "D");

const INTERVAL_GROUPS: { title: string; items: string[] }[] = [
  { title: "Sekunden (nur Binance-Krypto)", items: INTERVALS.filter((i) => i.endsWith("s")) },
  { title: "Minuten", items: INTERVALS.filter((i) => i.endsWith("m")) },
  { title: "Stunden", items: INTERVALS.filter((i) => i.endsWith("h")) },
  { title: "Tage und länger", items: INTERVALS.filter((i) => !/[smh]$/.test(i)) },
];

const CUSTOM_KEY = "chartai.customIntervals.v1";

function readCustom(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && isValidInterval(x)) : [];
  } catch {
    return [];
  }
}

/** All time frames in groups, the user's own ones and a field for a new one (like TradingView's custom intervals). */
function IntervalPanel({ close }: { close: () => void }) {
  const symbol = useChartState((s) => s.symbol);
  const interval = useChartState((s) => s.interval);
  const [custom, setCustom] = useState(readCustom);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pick = (iv: string) => {
    void loadChart(symbol, iv as Interval);
    close();
  };
  const addCustom = () => {
    const iv = normalizeInterval(text);
    if (!iv) return setError("z. B. 7m, 90s, 3h oder 2d (bis 7 Tage)");
    if (!(INTERVALS as readonly string[]).includes(iv) && !custom.includes(iv)) {
      const next = [...custom, iv].sort((a, b) => intervalSeconds(a) - intervalSeconds(b));
      setCustom(next);
      try {
        localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
      } catch {
        // not remembered
      }
    }
    pick(iv);
  };
  const chip = (iv: string, removable = false) => (
    <span key={iv} className="iv-chip-wrap">
      <button className={`iv-chip ${iv === interval ? "active" : ""}`} onClick={() => pick(iv)} data-tip={intervalLabel(iv)}>
        {shortLabel(iv)}
      </button>
      {removable && (
        <button
          className="iv-remove"
          aria-label={`${iv} entfernen`}
          onClick={() => {
            const next = custom.filter((x) => x !== iv);
            setCustom(next);
            try {
              localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
            } catch {
              // not remembered
            }
          }}
        >
          ×
        </button>
      )}
    </span>
  );
  return (
    <>
      {INTERVAL_GROUPS.map((g) => (
        <div key={g.title}>
          <div className="menu-title">{g.title}</div>
          <div className="iv-chips">{g.items.map((iv) => chip(iv))}</div>
        </div>
      ))}
      <div className="menu-title">Eigene Zeiteinheiten</div>
      {custom.length > 0 && <div className="iv-chips">{custom.map((iv) => chip(iv, true))}</div>}
      <div className="iv-custom">
        <input
          value={text}
          placeholder="z. B. 7m, 90s, 3h, 2d"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && addCustom()}
          aria-label="Eigene Zeiteinheit"
        />
        <button onClick={addCustom}>Öffnen</button>
      </div>
      {error && <div className="iv-error">{error}</div>}
    </>
  );
}

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
  alertsOpen: boolean;
  onToggleAlerts: () => void;
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

/** Time frames as one drop-down; replaces the button row when the top bar gets narrow. */
function IntervalMenu({ className, label }: { className: string; label?: string }) {
  const interval = useChartState((s) => s.interval);
  return (
    <Menu
      label={label ?? <>{shortLabel(interval)} <span className="caret">▾</span></>}
      className={className}
      ariaLabel="Zeiteinheit"
      tip={`Zeiteinheit: ${intervalLabel(interval)}\nAuch Sekunden und eigene wie 7m, 90s, 2D`}
    >
      {(close) => <IntervalPanel close={close} />}
    </Menu>
  );
}

export function TopBar({ onOpenIndicators, onOpenSettings, heatmapOpen, onToggleHeatmap, calcOpen, onToggleCalc, journalOpen, onToggleJournal, exchangesOpen, onToggleExchanges, demoOpen, onToggleDemo, alertsOpen, onToggleAlerts, claudeOpen, onToggleClaude }: Props) {
  const activeAlerts = useAlerts((s) => s.alerts.filter((a) => a.active).length);
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
        <RefreshButton />
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
      <div className="group intervals-full">
        {MAIN_INTERVALS.map((iv) => (
          <button key={iv} className={iv === interval ? "active" : ""} onClick={() => loadChart(symbol, iv)} data-tip={`Zeiteinheit: ${intervalLabel(iv)}`}>
            {shortLabel(iv)}
          </button>
        ))}
        {!(MAIN_INTERVALS as readonly string[]).includes(interval) && (
          <button className="active" data-tip={`Zeiteinheit: ${intervalLabel(interval)}`}>
            {shortLabel(interval)}
          </button>
        )}
        <IntervalMenu className="intervals-more" label="▾" />
      </div>
      <IntervalMenu className="intervals-compact" />
      <select value={chartType} onChange={(e) => store.set({ chartType: e.target.value as ChartType })} aria-label="Charttyp" data-tip="Charttyp">
        {CHART_TYPES.map((t) => (
          <option key={t} value={t}>
            {CHART_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <button className="pill" onClick={onOpenIndicators} aria-label="Indikatoren" data-tip={`Indikatoren hinzufügen (${INDICATORS.length} verfügbar)`}>
        <span className="pill-icon">ƒx</span>
        <span className="pill-label"> Indikatoren</span>
      </button>
      <button
        className={`pill ${replaying ? "active" : ""}`}
        onClick={() => (replaying ? exitReplay() : startReplay())}
        aria-label="Replay"
        data-tip={replaying ? "Replay beenden, zurück zum Live-Chart" : "Bar-Replay\nStartkerze wählen und den Chart Kerze für Kerze abspielen\nMit eigenem Replay-Konto zum Üben"}
      >
        <span className="pill-icon">⏪</span>
        <span className="pill-label"> Replay</span>
      </button>
      <FavoritesMenu />
      <TemplatesMenu />
      <LayoutMenu />
      <button className="pill" onClick={onOpenSettings} aria-label="Chart-Einstellungen" data-tip={"Chart-Einstellungen\nAchsen, Kurslabel, Countdown, Zeitzone, Gitter"}>
        ⚙
      </button>
      <DemoButton active={demoOpen} onClick={onToggleDemo} />
      <button className={`pill ${alertsOpen ? "active" : ""}`} onClick={onToggleAlerts} aria-label="Alarme" data-tip={"Alarme (Alt + A)\nPreis, Indikator, Linie oder Zone – mit Ton und Hinweis"}>
        <span className="pill-icon">🔔</span>
        <span className="pill-label"> Alarme</span>
        {activeAlerts > 0 && <span className="al-count">{activeAlerts}</span>}
      </button>
      <button className={`pill ${heatmapOpen ? "active" : ""}`} onClick={onToggleHeatmap} aria-label="Heatmap" data-tip={"Liquidations-Heatmap im CoinGlass-Stil\nVollbild mit Zeiträumen von 12 h bis 1 Jahr"}>
        <span className="pill-icon">🔥</span>
        <span className="pill-label"> Heatmap</span>
      </button>
      <button className={`pill ${calcOpen ? "active" : ""}`} onClick={onToggleCalc} aria-label="Rechner" data-tip={"Trading-Rechner\nPositionsgröße, Erwartungswert, R-Multiple, Fibonacci, Hebel"}>
        <span className="pill-icon">🧮</span>
        <span className="pill-label"> Rechner</span>
      </button>
      <button className={`pill ${journalOpen ? "active" : ""}`} onClick={onToggleJournal} aria-label="Journal" data-tip={"Trading-Journal\nTrades eintragen, Equity-Kurve: bin ich profitabel?"}>
        <span className="pill-icon">📒</span>
        <span className="pill-label"> Journal</span>
      </button>
      <button className={`pill ${exchangesOpen ? "active" : ""}`} onClick={onToggleExchanges} aria-label="Börsen" data-tip={"Börsenzeiten\nÖffnungszeiten der großen Börsen in deiner Zeitzone\nAusgewählte Börsen erscheinen im Chart"}>
        <span className="pill-icon">🕐</span>
        <span className="pill-label"> Börsen</span>
      </button>
      <div className="spacer" />
      <button className={`pill claude-toggle ${claudeOpen ? "active" : ""}`} onClick={onToggleClaude} aria-label="Claude" data-tip={"Seitenleiste ein-/ausblenden\nClaude, Orderbuch, Liquidationen"}>
        <span className="pill-icon">✦</span>
        <span className="pill-label"> Claude</span>
      </button>
    </header>
  );
}
