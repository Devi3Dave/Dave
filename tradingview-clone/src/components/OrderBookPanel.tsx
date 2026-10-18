import { useEffect, useMemo, useState } from "react";
import { isCryptoSymbol } from "../../shared/marketData";
import { groupLevels, groupingSteps, type Level } from "../../shared/orderbook";
import { formatPrice } from "../chart/DrawingsPrimitive";
import { orderBookFeed, useOrderBook, type BookMarket } from "../market/orderBookFeed";
import { addDrawing, newId, useChartState } from "../store";

const ROWS = 16;

const compact = (v: number) =>
  v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(2)}K` : v >= 1 ? v.toFixed(3) : v.toPrecision(3);

function decimalsFor(step: number) {
  return Math.max(0, Math.min(8, Math.ceil(-Math.log10(step) - 1e-9)));
}

interface Row {
  price: number;
  qty: number;
  total: number;
}

function cumulate(levels: Level[]): Row[] {
  let total = 0;
  return levels.slice(0, ROWS).map(([price, qty]) => {
    total += qty;
    return { price, qty, total };
  });
}

/** Live Binance order book with grouping, depth bars, spread and buy/sell ratio. */
export function OrderBookPanel() {
  const symbol = useChartState((s) => s.symbol);
  const bars = useChartState((s) => s.bars);
  const book = useOrderBook();
  const [market, setMarket] = useState<BookMarket>("spot");
  const [step, setStep] = useState<number | null>(null);
  const crypto = isCryptoSymbol(symbol);

  useEffect(() => {
    if (!crypto) return;
    orderBookFeed.start(symbol, market);
    return () => orderBookFeed.stop();
  }, [symbol, market, crypto]);

  const bestBid = book.bids[0]?.[0];
  const bestAsk = book.asks[0]?.[0];
  const ref = bestBid ?? bars[bars.length - 1]?.close ?? 0;
  const steps = groupingSteps(ref);
  const activeStep = step !== null && steps.includes(step) ? step : steps[1];
  const decimals = decimalsFor(activeStep);

  const { bids, asks, maxTotal, bidShare } = useMemo(() => {
    const b = cumulate(groupLevels(book.bids, activeStep, "bid"));
    const a = cumulate(groupLevels(book.asks, activeStep, "ask"));
    const max = Math.max(b[b.length - 1]?.total ?? 0, a[a.length - 1]?.total ?? 0);
    const bv = b[b.length - 1]?.total ?? 0;
    const av = a[a.length - 1]?.total ?? 0;
    return { bids: b, asks: a, maxTotal: max, bidShare: bv + av > 0 ? bv / (bv + av) : 0.5 };
  }, [book.bids, book.asks, activeStep]);

  if (!crypto) {
    return (
      <div className="panel-empty">
        Das Orderbuch gibt es für Krypto-Paare von Binance (z. B. BTCUSDT). <strong>{symbol}</strong> ist dort nicht gelistet.
      </div>
    );
  }

  const spread = bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : null;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const mid = bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : last?.close;

  const toLine = (price: number, side: "bid" | "ask") =>
    addDrawing({
      id: newId("user-book"),
      author: "user",
      kind: "hline",
      price,
      color: side === "bid" ? "#26a69a" : "#ef5350",
      style: "dashed",
      label: side === "bid" ? "Bid-Wand" : "Ask-Wand",
    });

  const row = (r: Row, side: "bid" | "ask") => (
    <button
      key={r.price}
      className={`book-row ${side}`}
      onClick={() => toLine(r.price, side)}
      data-tip={`Als Linie in den Chart übernehmen\nKumuliert: ${compact(r.total)}`}
      data-tip-placement="left"
    >
      <span className="book-depth" style={{ width: `${maxTotal ? (r.total / maxTotal) * 100 : 0}%` }} />
      <span className="book-price">{r.price.toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</span>
      <span>{compact(r.qty)}</span>
      <span>{compact(r.total)}</span>
    </button>
  );

  return (
    <div className="book">
      <div className="book-head">
        <div className="segmented">
          {(["spot", "futures"] as const).map((m) => (
            <button
              key={m}
              className={m === market ? "active" : ""}
              onClick={() => setMarket(m)}
              data-tip={m === "spot" ? "Binance Spot-Orderbuch" : "Binance USDⓈ-M Perpetual-Futures-Orderbuch"}
            >
              {m === "spot" ? "Spot" : "Futures"}
            </button>
          ))}
        </div>
        <select value={activeStep} onChange={(e) => setStep(Number(e.target.value))} data-tip="Preisstufen zusammenfassen" aria-label="Gruppierung">
          {steps.map((s) => (
            <option key={s} value={s}>
              {s.toLocaleString("de-DE", { maximumFractionDigits: 8 })}
            </option>
          ))}
        </select>
        <span className={`book-status ${book.status}`} data-tip={book.error ?? (book.status === "live" ? "Live verbunden" : "Verbinde …")}>
          ●
        </span>
      </div>
      <div className="book-cols">
        <span>Preis</span>
        <span>Menge</span>
        <span>Summe</span>
      </div>
      {book.status !== "live" && book.bids.length === 0 ? (
        <div className="panel-empty">{book.error ?? "Verbinde mit Binance …"}</div>
      ) : (
        <>
          <div className="book-side asks">{[...asks].reverse().map((r) => row(r, "ask"))}</div>
          <div className="book-mid" data-tip={"Mittelkurs zwischen bestem Bid und Ask\nSpread = Abstand zwischen beiden"}>
            <strong className={last && prev && last.close < prev.close ? "down" : "up"}>{mid !== undefined ? formatPrice(mid) : "–"}</strong>
            {spread !== null && (
              <span>
                Spread {formatPrice(spread)} ({((spread / (mid || 1)) * 100).toFixed(3)} %)
              </span>
            )}
          </div>
          <div className="book-side bids">{bids.map((r) => row(r, "bid"))}</div>
          <div className="book-ratio" data-tip={"Verhältnis Kauf- zu Verkaufsvolumen\nin den angezeigten Stufen"}>
            <span className="up">B {(bidShare * 100).toFixed(0)}%</span>
            <div className="ratio-bar">
              <div className="ratio-bid" style={{ width: `${bidShare * 100}%` }} />
            </div>
            <span className="down">{((1 - bidShare) * 100).toFixed(0)}% S</span>
          </div>
        </>
      )}
    </div>
  );
}
