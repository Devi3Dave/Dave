import { useMemo } from "react";
import { getIndicator, resolveParams } from "../../shared/indicators";
import { liquidationClusters, liquidationHeatmap } from "../../shared/liquidations";
import { isCryptoSymbol } from "../../shared/marketData";
import { formatPrice } from "../chart/DrawingsPrimitive";
import { liquidationTotals, useLiquidationFeed } from "../market/liquidationFeed";
import { addIndicator, removeIndicator, updateSettings, useChartState } from "../store";

const usd = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)} Mrd. $` : v >= 1e6 ? `${(v / 1e6).toFixed(2)} Mio. $` : v >= 1e3 ? `${(v / 1e3).toFixed(1)} Tsd. $` : `${v.toFixed(0)} $`);
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Estimated liquidation clusters (heatmap model) plus the live Binance liquidation feed. */
export function LiquidationsPanel() {
  const symbol = useChartState((s) => s.symbol);
  const bars = useChartState((s) => s.bars);
  const indicators = useChartState((s) => s.indicators);
  const showLive = useChartState((s) => s.settings.liveLiquidations);
  const feed = useLiquidationFeed();
  const crypto = isCryptoSymbol(symbol);

  const heatmapInstance = indicators.find((i) => i.type === "liqheatmap");
  const def = getIndicator("liqheatmap")!;
  const params = resolveParams(def, heatmapInstance?.params);

  const clusters = useMemo(() => {
    const hm = liquidationHeatmap(bars, params.lookback, params.rows);
    return hm ? liquidationClusters(bars, hm, 5) : null;
  }, [bars, params.lookback, params.rows]);

  const t5 = liquidationTotals(feed.items, 300);
  const t60 = liquidationTotals(feed.items, 3600);

  return (
    <div className="liq">
      <section>
        <div className="liq-head">
          <h3>Liquidations-Heatmap (geschätzt)</h3>
          <button
            className={`pill ${heatmapInstance ? "active" : ""}`}
            onClick={() => (heatmapInstance ? removeIndicator(heatmapInstance.id) : addIndicator("liqheatmap", resolveParams(def), "user"))}
            data-tip={"Heatmap im Chart ein-/ausblenden\nSchätzung aus Volumen, Taker-Käufen und 10×–100× Hebel"}
          >
            {heatmapInstance ? "Im Chart ✓" : "Im Chart zeigen"}
          </button>
        </div>
        {clusters && (
          <table className="liq-table">
            <thead>
              <tr>
                <th>Preis</th>
                <th>Abstand</th>
                <th>geschätzt</th>
              </tr>
            </thead>
            <tbody>
              {[...clusters.above].reverse().map((c) => (
                <tr key={`a${c.price}`} className="down" data-tip="Short-Liquidationen über dem Kurs – Kurs wird oft dorthin gezogen">
                  <td>{formatPrice(c.price)}</td>
                  <td>+{c.distancePct.toFixed(2)} %</td>
                  <td>{usd(c.value)}</td>
                </tr>
              ))}
              <tr className="liq-now">
                <td colSpan={3}>Kurs {bars.length ? formatPrice(bars[bars.length - 1].close) : "–"}</td>
              </tr>
              {clusters.below.map((c) => (
                <tr key={`b${c.price}`} className="up" data-tip="Long-Liquidationen unter dem Kurs">
                  <td>{formatPrice(c.price)}</td>
                  <td>{c.distancePct.toFixed(2)} %</td>
                  <td>{usd(c.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">
          Modell wie bei CoinGlass: Je Kerze werden neue Positionen mit 10×, 25×, 50× und 100× Hebel angenommen; ein Niveau verschwindet, sobald der Kurs es erreicht. Werte sind
          Schätzungen.
        </p>
      </section>

      <section>
        <div className="liq-head">
          <h3>Live-Liquidationen</h3>
          <label className="settings-toggle" data-tip="Echte Liquidationen als Blasen im Chart zeigen (rot = Longs, grün = Shorts)">
            <input type="checkbox" checked={showLive} onChange={(e) => updateSettings({ liveLiquidations: e.target.checked })} /> im Chart
          </label>
        </div>
        {!crypto ? (
          <div className="panel-empty">Nur für Binance-Futures-Paare (z. B. BTCUSDT).</div>
        ) : (
          <>
            <div className="liq-totals">
              <div data-tip="Liquidierte Long-Positionen">
                <span className="down">Longs</span> 5 min {usd(t5.long)} · 1 h {usd(t60.long)}
              </div>
              <div data-tip="Liquidierte Short-Positionen">
                <span className="up">Shorts</span> 5 min {usd(t5.short)} · 1 h {usd(t60.short)}
              </div>
            </div>
            <div className="liq-list">
              {feed.items.length === 0 && (
                <div className="panel-empty">{feed.status === "live" ? "Verbunden – warte auf Liquidationen …" : feed.status === "error" ? "Verbindung getrennt, neuer Versuch …" : "Verbinde mit Binance Futures …"}</div>
              )}
              {[...feed.items].reverse().slice(0, 80).map((l, i) => (
                <div key={`${l.time}-${i}`} className={`liq-item ${l.side}`}>
                  <span>{clock(l.time)}</span>
                  <span>{l.side === "long" ? "Long liq." : "Short liq."}</span>
                  <span>{formatPrice(l.price)}</span>
                  <strong>{usd(l.notional)}</strong>
                </div>
              ))}
            </div>
            <p className="hint">Binance meldet höchstens eine Liquidation pro Sekunde und Symbol – die Liste ist eine Stichprobe, ab dem Öffnen der App.</p>
          </>
        )}
      </section>
    </div>
  );
}
