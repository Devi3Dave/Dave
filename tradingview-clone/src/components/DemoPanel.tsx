import { useEffect, useMemo, useState } from "react";
import { findAsset } from "../../shared/assets";
import {
  available,
  demoStats,
  equity,
  journalId,
  liquidationPrice,
  openPnl,
  orderCost,
  qtyFromMargin,
  qtyFromRisk,
  REASON_LABELS,
  START_BALANCES,
  unrealizedPnl,
  usedMargin,
  type DemoPosition,
  type DemoTrade,
  type OrderType,
  type Side,
} from "../../shared/demoTrading";
import { formatPrice } from "../chart/DrawingsPrimitive";
import { addToJournal, cancelOrder, closeAllPositions, closeDemoPart, closeDemoPosition, placeOrder, resetAccount, setFeeRate, setLevels, updateDemoSettings, useDemo, useDemoBook, useReplayBook } from "../demoAccount";
import { loadChart, useChartState } from "../store";
import { AssetSearchDialog } from "./AssetPicker";

type SizeMode = "margin" | "risk" | "qty";

const LEVERAGES = [1, 2, 3, 5, 10, 20, 50, 100];
const FEES = [0, 0.0002, 0.0005, 0.001];
const HISTORY_SHOWN = 30;
const ORDER_TIPS: Record<OrderType, string> = {
  market: "Sofort zum aktuellen Kurs",
  limit: "Wartet auf einen besseren Kurs: Kaufen unter, Verkaufen über dem aktuellen Kurs; füllt zum Limitpreis",
  stop: "Wartet auf einen Ausbruch: Kaufen über, Verkaufen unter dem aktuellen Kurs; füllt zum Marktkurs",
};

const nf = (d: number) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const num = (v: number, d = 2) => (Number.isFinite(v) ? nf(d).format(v) : "–");
const money = (v: number) => `${num(v)} $`;
// Rounded first so a tiny loss does not show as "−0,00 $".
const cents = (v: number) => Math.round(v * 100) / 100 || 0;
const signed = (v: number) => `${cents(v) > 0 ? "+" : ""}${num(cents(v))} $`;
const pct = (v: number, d = 2) => `${v > 0 ? "+" : ""}${num(v * 100, d)} %`;
const tone = (v: number) => (cents(v) > 0 ? "up" : cents(v) < 0 ? "down" : undefined);
const qtyText = (q: number) => (q >= 1000 ? num(q, 0) : String(+q.toPrecision(6)).replace(".", ","));
const parseNum = (s: string) => (s.trim() === "" ? undefined : Number(s.trim().replace(/\s/g, "").replace(",", ".")));
const showNum = (v: number | undefined) => (v === undefined ? "" : String(+v.toPrecision(8)).replace(".", ","));
const clock = (ms: number) => new Date(ms).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const REASON_ICON: Record<DemoTrade["reason"], string> = { manual: "✋", stop: "🛑", target: "🎯", liquidation: "💥" };

/** Level `pctAway` percent from the price, on the losing (stop) or winning (target) side. */
const levelAt = (side: Side, price: number, pctAway: number, kind: "stop" | "target") => {
  const sign = (side === "long" ? 1 : -1) * (kind === "stop" ? -1 : 1);
  return +(price * (1 + (sign * pctAway) / 100)).toPrecision(6);
};

function PositionCard({ p, price }: { p: DemoPosition; price: number | undefined }) {
  const interval = useChartState((s) => s.interval);
  const chartSymbol = useChartState((s) => s.symbol);
  const [editing, setEditing] = useState(false);
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pnl = price === undefined ? null : unrealizedPnl(p, price);
  const liq = p.leverage > 1 ? liquidationPrice(p) : null;

  const startEdit = () => {
    setStop(showNum(p.stop));
    setTarget(showNum(p.target));
    setError(null);
    setEditing(true);
  };
  // A line dragged in the chart meanwhile: the open form shows the new levels.
  useEffect(() => {
    setStop(showNum(p.stop));
    setTarget(showNum(p.target));
  }, [p.stop, p.target]);
  const save = () => {
    const s = parseNum(stop);
    const t = parseNum(target);
    const err = setLevels(p.id, { stop: s, target: t });
    if (err) setError(err);
    else setEditing(false);
  };

  return (
    <div className={`dm-pos ${p.side}`}>
      <div className="dm-pos-head">
        <button className="dm-sym" onClick={() => p.symbol !== chartSymbol && void loadChart(p.symbol, interval)} data-tip="Im Chart öffnen">
          {p.symbol}
        </button>
        <span className={p.side === "long" ? "up" : "down"}>
          {p.side === "long" ? "Long" : "Short"}
          {p.leverage > 1 ? ` ${p.leverage}×` : ""}
        </span>
        <div className="spacer" />
        <strong className={pnl === null ? undefined : tone(pnl)}>{pnl === null ? "–" : signed(pnl)}</strong>
        {pnl !== null && <span className={`dm-muted ${tone(pnl) ?? ""}`}>{pct(pnl / p.margin, 1)}</span>}
      </div>
      <div className="dm-pos-grid">
        <span>Menge</span>
        <span>{qtyText(p.qty)}</span>
        <span>Einstieg</span>
        <span>{formatPrice(p.entry)}</span>
        <span>Aktuell</span>
        <span>{price === undefined ? "lädt …" : formatPrice(price)}</span>
        <span>Margin</span>
        <span>{money(p.margin)}</span>
        <span>Stop-Loss</span>
        <span className="down">{p.stop === undefined ? "–" : formatPrice(p.stop)}</span>
        <span>Take-Profit</span>
        <span className="up">{p.target === undefined ? "–" : formatPrice(p.target)}</span>
        {liq !== null && (
          <>
            <span>Liquidation</span>
            <span className="dm-gold">{formatPrice(liq)}</span>
          </>
        )}
      </div>
      {editing ? (
        <div className="dm-edit">
          <div className="calc-inputs">
            <label className="calc-field">
              <span>Stop-Loss</span>
              <div className="calc-input">
                <input inputMode="decimal" value={stop} placeholder="kein Stop" onChange={(e) => setStop(e.target.value)} />
              </div>
            </label>
            <label className="calc-field">
              <span>Take-Profit</span>
              <div className="calc-input">
                <input inputMode="decimal" value={target} placeholder="kein Ziel" onChange={(e) => setTarget(e.target.value)} />
              </div>
            </label>
          </div>
          {price !== undefined && (
            <div className="calc-examples">
              <span>Stop:</span>
              <button onClick={() => setStop(showNum(p.entry))} data-tip="Stop auf den Einstieg: kein Verlust mehr möglich (wenn der Kurs schon im Gewinn ist)">
                Break-even
              </button>
              {[1, 2].map((d) => (
                <button key={d} onClick={() => setStop(showNum(levelAt(p.side, price, d, "stop")))}>
                  {d} % vom Kurs
                </button>
              ))}
            </div>
          )}
          {error && <div className="calc-warn">{error}</div>}
          <div className="dm-row-actions">
            <button onClick={() => setEditing(false)}>Abbrechen</button>
            <button className="dm-primary" onClick={save}>
              Speichern
            </button>
          </div>
        </div>
      ) : (
        <div className="dm-row-actions">
          <button onClick={startEdit} data-tip="Stop-Loss und Take-Profit ändern">
            ✎ SL/TP
          </button>
          {[25, 50].map((f) => (
            <button key={f} onClick={() => closeDemoPart(p.id, f / 100)} disabled={price === undefined} data-tip={`${f} % der Position zum aktuellen Kurs schließen, der Rest läuft mit SL/TP weiter`}>
              {f} %
            </button>
          ))}
          <button className="dm-close" onClick={() => closeDemoPosition(p.id)} disabled={price === undefined} data-tip="Zum aktuellen Kurs schließen">
            Schließen {pnl !== null && <span className={tone(pnl)}>{signed(pnl)}</span>}
          </button>
        </div>
      )}
    </div>
  );
}

export function DemoPanel() {
  const symbol = useChartState((s) => s.symbol);
  const source = useChartState((s) => s.source);
  const chartLoading = useChartState((s) => s.loading);
  const account = useDemoBook((b) => b.account);
  const prices = useDemoBook((b) => b.prices);
  const replay = useReplayBook();
  const settings = useDemo((s) => s.settings);
  const journaled = useDemo((s) => s.journaled);

  const [side, setSide] = useState<Side>("long");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [orderPrice, setOrderPrice] = useState("");
  const [mode, setMode] = useState<SizeMode>("margin");
  const [size, setSize] = useState("");
  const [leverage, setLeverage] = useState(1);
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState<number | null>(null);
  const [customStart, setCustomStart] = useState("");
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);

  // A new asset starts with fresh levels; the old ones belong to another price.
  useEffect(() => {
    setStop("");
    setTarget("");
    setOrderPrice("");
    setError(null);
  }, [symbol]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const market = chartLoading ? undefined : prices[symbol];
  const orderPriceN = parseNum(orderPrice);
  // Sizes, costs and levels are figured at the price the order fills: the market, or the limit/stop price.
  const price = orderType === "market" ? market : orderPriceN !== undefined && orderPriceN > 0 ? orderPriceN : undefined;
  const eq = equity(account, prices);
  const free = available(account, prices);
  const open = openPnl(account, prices);
  const stats = useMemo(() => demoStats(account.history), [account.history]);
  const total = eq - account.startBalance;

  const sizeN = parseNum(size);
  const stopN = parseNum(stop);
  const targetN = parseNum(target);
  const qty =
    price === undefined || sizeN === undefined || !(sizeN > 0)
      ? 0
      : mode === "margin"
        ? qtyFromMargin(sizeN, leverage, price)
        : mode === "qty"
          ? sizeN
          : stopN !== undefined
            ? qtyFromRisk(eq, sizeN, price, stopN)
            : 0;
  const cost = price === undefined ? null : orderCost(account, qty, price, leverage);
  const riskAtStop = price !== undefined && stopN !== undefined && qty > 0 ? Math.abs(price - stopN) * qty : null;
  const rewardAtTarget = price !== undefined && targetN !== undefined && qty > 0 ? Math.abs(targetN - price) * qty : null;
  const liq = price !== undefined && cost && qty > 0 && leverage > 1 ? liquidationPrice({ side, entry: price, qty, margin: cost.margin }) : null;
  const name = findAsset(symbol)?.name;

  const submit = () => {
    if (mode === "risk" && stopN === undefined) return setError("Für „Risiko %“ zuerst einen Stop-Loss eintragen");
    const err = placeOrder({ symbol, side, qty, leverage, stop: stopN, target: targetN }, orderType, orderPriceN);
    if (err) return setError(err);
    setError(null);
    setNotice(
      orderType === "market"
        ? `${side === "long" ? "Long" : "Short"} ${symbol} eröffnet: ${qtyText(qty)} zu ${formatPrice(price!)}`
        : `${side === "long" ? "Buy" : "Sell"} ${orderType === "limit" ? "Limit" : "Stop"} ${symbol} wartet bei ${formatPrice(price!)}`,
    );
    setStop("");
    setTarget("");
  };

  const sizeUnit = mode === "margin" ? "$" : mode === "risk" ? "%" : "Stück";
  const recent = account.history.slice(-HISTORY_SHOWN).reverse();
  const notInJournal = account.history.filter((t) => !journaled.has(journalId(t)));
  const priceTip = source === "demo" ? "Für dieses Asset gibt es hier keine echte Datenquelle – gehandelt wird auf Demo-Daten" : "Gehandelt wird zum letzten Kurs aus dem Chart";

  return (
    <div className="dm">
      <section className="dm-account">
        <div className="dm-account-head">
          <span className="dm-muted">{replay ? "Replay-Konto · historische Kurse" : "Demo-Konto · Spielgeld"}</span>
          <div className="spacer" />
          <button className={`pill ${settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen((o) => !o)} data-tip="Startkapital, Gebühren, Journal, Linien im Chart">
            ⚙
          </button>
        </div>
        {replay && (
          <div className="dm-replay-note">
            ⏪ Dieser Chart läuft im Replay: Orders, SL und TP gelten zu den abgespielten Kursen. Das Replay-Konto wird beim Beenden verworfen, dein
            Demo-Konto bleibt unberührt.
          </div>
        )}
        <div className="dm-equity">
          <strong>{money(eq)}</strong>
          <span className={tone(total)}>
            {signed(total)} ({pct(total / account.startBalance)})
          </span>
        </div>
        <div className="dm-kpis">
          <div>
            <span>Guthaben</span>
            <strong>{money(account.balance)}</strong>
          </div>
          <div>
            <span>Frei</span>
            <strong>{money(free)}</strong>
          </div>
          <div>
            <span>Offen G/V</span>
            <strong className={tone(open)}>{signed(open)}</strong>
          </div>
        </div>
        {settingsOpen && (
          <div className="dm-settings">
            <div className="dm-label">Konto neu starten mit</div>
            <div className="calc-examples">
              {START_BALANCES.map((b) => (
                <button key={b} className={confirmReset === b ? "active" : ""} onClick={() => setConfirmReset(b)}>
                  {num(b, 0)} $
                </button>
              ))}
              <div className="calc-input dm-custom">
                <input inputMode="decimal" placeholder="eigener Betrag" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                <em>$</em>
              </div>
              <button
                onClick={() => {
                  const v = parseNum(customStart);
                  if (v && v > 0) setConfirmReset(v);
                }}
                disabled={!(Number(parseNum(customStart)) > 0)}
              >
                OK
              </button>
            </div>
            {confirmReset !== null && (
              <div className="dm-confirm">
                Alle Positionen und die Historie werden gelöscht, neues Guthaben {money(confirmReset)}.
                <div className="dm-row-actions">
                  <button onClick={() => setConfirmReset(null)}>Abbrechen</button>
                  <button
                    className="jr-danger"
                    onClick={() => {
                      resetAccount(confirmReset);
                      setConfirmReset(null);
                      setNotice(`Neues Demo-Konto mit ${money(confirmReset)}`);
                    }}
                  >
                    Neu starten
                  </button>
                </div>
              </div>
            )}
            <div className="dm-label">Gebühr pro Kauf und Verkauf</div>
            <div className="jr-seg">
              {FEES.map((f) => (
                <button key={f} className={account.feeRate === f ? "active" : ""} onClick={() => setFeeRate(f)}>
                  {f === 0 ? "keine" : `${num(f * 100, 2)} %`}
                </button>
              ))}
            </div>
            <label className="menu-check">
              <input type="checkbox" checked={settings.autoJournal} onChange={(e) => updateDemoSettings({ autoJournal: e.target.checked })} />
              Geschlossene Trades automatisch ins Journal (Setup „Demo“)
            </label>
            <label className="menu-check">
              <input type="checkbox" checked={settings.showLines} onChange={(e) => updateDemoSettings({ showLines: e.target.checked })} />
              Einstieg, SL und TP als Linien im Chart (SL/TP zum Verschieben ziehen)
            </label>
          </div>
        )}
      </section>

      <section className="dm-ticket">
        <div className="dm-asset">
          <div>
            <strong>{symbol}</strong>
            {name && <span className="dm-muted"> {name}</span>}
          </div>
          <div className="spacer" />
          <span className="dm-price" data-tip={priceTip}>
            {market === undefined ? "lädt …" : formatPrice(market)}
            {source === "demo" && <em className="asset-badge demo">Demo</em>}
          </span>
          <button className="pill" onClick={() => setSearchOpen(true)} data-tip="Anderes Asset handeln (wechselt den Chart)">
            🔍
          </button>
        </div>
        {searchOpen && <AssetSearchDialog onClose={() => setSearchOpen(false)} />}

        <div className="jr-seg jr-side">
          <button className={side === "long" ? "active up" : ""} onClick={() => setSide("long")}>
            Kaufen / Long ▲
          </button>
          <button className={side === "short" ? "active down" : ""} onClick={() => setSide("short")}>
            Verkaufen / Short ▼
          </button>
        </div>

        <div className="dm-size-head">
          <span className="dm-label">Order</span>
          <div className="jr-seg">
            {(["market", "limit", "stop"] as OrderType[]).map((t) => (
              <button
                key={t}
                className={orderType === t ? "active" : ""}
                onClick={() => {
                  setOrderType(t);
                  if (t !== "market" && !orderPrice && market !== undefined) setOrderPrice(showNum(+market.toPrecision(6)));
                }}
                data-tip={ORDER_TIPS[t]}
              >
                {t === "market" ? "Markt" : t === "limit" ? "Limit" : "Stop"}
              </button>
            ))}
          </div>
        </div>
        {orderType !== "market" && (
          <>
            <div className="calc-input">
              <input inputMode="decimal" value={orderPrice} onChange={(e) => setOrderPrice(e.target.value)} placeholder="Orderpreis" aria-label="Orderpreis" />
              <em>Preis</em>
            </div>
            {market !== undefined && (
              <div className="calc-examples">
                {[0.5, 1, 2].map((d) => {
                  // Limit: better than the market (buy below, sell above); stop: beyond it.
                  const sign = (side === "long" ? -1 : 1) * (orderType === "limit" ? 1 : -1);
                  return (
                    <button key={d} onClick={() => setOrderPrice(showNum(+(market * (1 + (sign * d) / 100)).toPrecision(6)))}>
                      {sign > 0 ? "+" : "−"}
                      {num(d, 1)} %
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        <div className="dm-size-head">
          <span className="dm-label">Größe</span>
          <div className="jr-seg">
            <button className={mode === "margin" ? "active" : ""} onClick={() => setMode("margin")} data-tip="Wie viel Guthaben du einsetzt (mit Hebel wird die Position größer)">
              Einsatz $
            </button>
            <button className={mode === "risk" ? "active" : ""} onClick={() => setMode("risk")} data-tip="Wie viel Prozent des Kontos du verlierst, wenn der Stop-Loss erreicht wird">
              Risiko %
            </button>
            <button className={mode === "qty" ? "active" : ""} onClick={() => setMode("qty")} data-tip="Anzahl Stück / Coins">
              Menge
            </button>
          </div>
        </div>
        <div className="calc-input">
          <input inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} placeholder={mode === "margin" ? "z. B. 1000" : mode === "risk" ? "z. B. 1" : "z. B. 0,5"} />
          <em>{sizeUnit}</em>
        </div>
        <div className="calc-examples">
          {mode === "margin" &&
            [10, 25, 50, 100].map((p) => (
              <button key={p} onClick={() => setSize(showNum(Math.floor((free / (1 + account.feeRate * leverage)) * p) / 100))} data-tip={`${p} % des freien Guthabens`}>
                {p} %
              </button>
            ))}
          {mode === "risk" &&
            [0.5, 1, 2].map((p) => (
              <button key={p} onClick={() => setSize(showNum(p))}>
                {num(p, 1)} %
              </button>
            ))}
        </div>

        <div className="dm-size-head">
          <span className="dm-label">Hebel</span>
          <div className="jr-seg dm-lev">
            {LEVERAGES.map((l) => (
              <button key={l} className={leverage === l ? "active" : ""} onClick={() => setLeverage(l)}>
                {l}×
              </button>
            ))}
          </div>
        </div>

        <div className="calc-inputs dm-levels">
          <label className="calc-field">
            <span>Stop-Loss {mode === "risk" && <em className="down">nötig</em>}</span>
            <div className="calc-input">
              <input inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} placeholder="optional" />
            </div>
          </label>
          <label className="calc-field">
            <span>Take-Profit</span>
            <div className="calc-input">
              <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="optional" />
            </div>
          </label>
        </div>
        {price !== undefined && (
          <div className="calc-examples">
            <span>SL:</span>
            {[1, 2, 5].map((d) => (
              <button key={d} onClick={() => setStop(showNum(levelAt(side, price, d, "stop")))} data-tip={`Stop ${d} % vom Kurs entfernt`}>
                {d} %
              </button>
            ))}
            <span>TP:</span>
            {stopN !== undefined && Math.abs(price - stopN) > 0 ? (
              [2, 3].map((r) => (
                <button key={r} onClick={() => setTarget(showNum(+(price + (side === "long" ? 1 : -1) * r * Math.abs(price - stopN)).toPrecision(6)))} data-tip={`Ziel ${r}-mal so weit weg wie der Stop (Chance-Risiko 1:${r})`}>
                  1:{r}
                </button>
              ))
            ) : (
              [2, 5].map((d) => (
                <button key={d} onClick={() => setTarget(showNum(levelAt(side, price, d, "target")))}>
                  {d} %
                </button>
              ))
            )}
          </div>
        )}

        {cost && qty > 0 && (
          <div className="dm-summary">
            <span>Menge</span>
            <strong>{qtyText(qty)}</strong>
            <span>Positionswert</span>
            <strong>{money(cost.value)}</strong>
            <span>Margin</span>
            <strong>{money(cost.margin)}</strong>
            <span>Gebühr</span>
            <strong>{money(cost.fee)}</strong>
            {riskAtStop !== null && (
              <>
                <span>Verlust bei SL</span>
                <strong className="down">
                  −{money(riskAtStop)} ({num((riskAtStop / eq) * 100, 1)} %)
                </strong>
              </>
            )}
            {rewardAtTarget !== null && (
              <>
                <span>Gewinn bei TP</span>
                <strong className="up">
                  +{money(rewardAtTarget)}
                  {riskAtStop ? ` · 1:${num(rewardAtTarget / riskAtStop, 1)}` : ""}
                </strong>
              </>
            )}
            {liq !== null && (
              <>
                <span>Liquidation bei</span>
                <strong className="dm-gold">{formatPrice(liq)}</strong>
              </>
            )}
          </div>
        )}

        <button className={`dm-submit ${side}`} onClick={submit} disabled={price === undefined || !(qty > 0)}>
          {orderType === "market" ? (side === "long" ? "Long kaufen" : "Short verkaufen") : `${side === "long" ? "Buy" : "Sell"} ${orderType === "limit" ? "Limit" : "Stop"} platzieren`}
          {price !== undefined && ` @ ${formatPrice(price)}`}
        </button>
        {error && <div className="calc-warn">{error}</div>}
        {notice && <div className="jr-notice">{notice}</div>}
      </section>

      {(account.orders ?? []).length > 0 && (
        <section>
          <div className="liq-head">
            <h3>Wartende Orders ({account.orders!.length})</h3>
          </div>
          {[...account.orders!].reverse().map((o) => (
            <div className="dm-hist dm-order" key={o.id} data-tip={`${o.type === "limit" ? "Limit: füllt zum Orderpreis, sobald der Kurs ihn erreicht" : "Stop: füllt zum Marktkurs, sobald der Kurs den Stop erreicht"}\nMenge ${qtyText(o.qty)}${o.leverage > 1 ? ` · ${o.leverage}× Hebel` : ""}${o.stop !== undefined ? `\nSL ${formatPrice(o.stop)}` : ""}${o.target !== undefined ? `\nTP ${formatPrice(o.target)}` : ""}\nLinie im Chart zum Verschieben ziehen`}>
              <span>{o.type === "limit" ? "⏳" : "⚡"}</span>
              <span>
                <strong>{o.symbol}</strong>{" "}
                <span className={o.side === "long" ? "up" : "down"}>
                  {o.side === "long" ? "Buy" : "Sell"} {o.type === "limit" ? "Limit" : "Stop"}
                </span>
                <br />
                <span className="dm-muted">
                  {qtyText(o.qty)} @ {formatPrice(o.price)}
                  {prices[o.symbol] !== undefined && ` · ${pct((o.price - prices[o.symbol]) / prices[o.symbol])} vom Kurs`}
                </span>
              </span>
              <span />
              <button onClick={() => cancelOrder(o.id)} data-tip="Order streichen" aria-label="Order streichen">
                ✕
              </button>
            </div>
          ))}
        </section>
      )}

      <section>
        <div className="liq-head">
          <h3>Offene Positionen ({account.positions.length})</h3>
          {account.positions.length > 1 &&
            (confirmCloseAll ? (
              <span className="dm-row-actions">
                <button
                  className="jr-danger"
                  onClick={() => {
                    const n = closeAllPositions();
                    setConfirmCloseAll(false);
                    setNotice(`${n} Positionen geschlossen`);
                  }}
                >
                  Alle schließen
                </button>
                <button onClick={() => setConfirmCloseAll(false)}>✕</button>
              </span>
            ) : (
              <button className="pill" onClick={() => setConfirmCloseAll(true)}>
                Alle schließen
              </button>
            ))}
        </div>
        {account.positions.length === 0 && <div className="dm-muted">Keine offenen Positionen. Oben Größe eintragen und kaufen oder verkaufen.</div>}
        {[...account.positions].reverse().map((p) => (
          <PositionCard key={p.id} p={p} price={prices[p.symbol]} />
        ))}
        {account.positions.length > 0 && <div className="dm-muted dm-small">Margin gebunden: {money(usedMargin(account))}</div>}
      </section>

      <section>
        <div className="liq-head">
          <h3>Historie ({stats.count})</h3>
          {notInJournal.length > 0 && (
            <button className="pill" onClick={() => setNotice(`${addToJournal(notInJournal)} Trades ins Journal übernommen`)} data-tip="Alle geschlossenen Demo-Trades ins Trading-Journal übernehmen (Setup „Demo“)">
              📒 Alle ins Journal
            </button>
          )}
        </div>
        {stats.count > 0 && (
          <div className="dm-kpis">
            <div>
              <span>Netto</span>
              <strong className={tone(stats.netPnl)}>{signed(stats.netPnl)}</strong>
            </div>
            <div>
              <span>Trefferquote</span>
              <strong>
                {num(stats.winRate * 100, 0)} % ({stats.wins}/{stats.count})
              </strong>
            </div>
            <div>
              <span>Gebühren</span>
              <strong>{money(stats.fees)}</strong>
            </div>
          </div>
        )}
        {stats.count === 0 && <div className="dm-muted">Noch keine geschlossenen Trades.</div>}
        <div className="dm-history">
          {recent.map((t) => (
            <div className="dm-hist" key={t.id} data-tip={`${REASON_LABELS[t.reason]}\nEinstieg ${formatPrice(t.entry)} → Ausstieg ${formatPrice(t.exit)}\nMenge ${qtyText(t.qty)}${t.leverage > 1 ? ` · ${t.leverage}× Hebel` : ""}\nGebühren ${money(t.openFee + t.closeFee)}`}>
              <span>{REASON_ICON[t.reason]}</span>
              <span>
                <strong>{t.symbol}</strong> <span className={t.side === "long" ? "up" : "down"}>{t.side === "long" ? "Long" : "Short"}</span>
                <br />
                <span className="dm-muted">{clock(t.closedAt)}</span>
              </span>
              <strong className={tone(t.pnl)}>{signed(t.pnl)}</strong>
              {journaled.has(journalId(t)) ? (
                <span className="dm-muted" data-tip="Steht im Journal">
                  📒✓
                </span>
              ) : (
                <button onClick={() => addToJournal([t])} data-tip="Ins Trading-Journal übernehmen">
                  📒+
                </button>
              )}
            </div>
          ))}
        </div>
        {account.history.length > HISTORY_SHOWN && <div className="dm-muted dm-small">Die letzten {HISTORY_SHOWN} von {account.history.length} Trades.</div>}
      </section>

      <p className="hint">
        Spielgeld, kein echtes Geld: Gehandelt wird zum aktuellen Kurs aus dem Chart, wie bei einem Futures-Konto mit isolierter Margin. Stop-Loss, Take-Profit und
        Liquidation werden ausgelöst, solange die App geöffnet ist. Hebel bis {LEVERAGES[LEVERAGES.length - 1]}× möglich – je höher, desto näher liegt die Liquidation.
      </p>
    </div>
  );
}
