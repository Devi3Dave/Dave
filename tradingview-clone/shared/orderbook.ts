// Local order book kept in sync from a REST snapshot plus Binance diff-depth events,
// following "How to manage a local order book correctly" from the Binance API docs.

export type Level = [price: number, qty: number];

export interface DepthSnapshot {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface DepthEvent {
  U: number; // first update id in event
  u: number; // final update id in event
  pu?: number; // futures only: final update id of the previous event
  b: [string, string][];
  a: [string, string][];
}

export type ApplyResult = "applied" | "ignored" | "gap";

export class LocalBook {
  private bids = new Map<string, number>();
  private asks = new Map<string, number>();
  private updateId = -1;
  private synced = false;

  get ready() {
    return this.updateId >= 0;
  }

  reset() {
    this.bids.clear();
    this.asks.clear();
    this.updateId = -1;
    this.synced = false;
  }

  loadSnapshot(s: DepthSnapshot) {
    this.reset();
    for (const [p, q] of s.bids) if (+q > 0) this.bids.set(p, +q);
    for (const [p, q] of s.asks) if (+q > 0) this.asks.set(p, +q);
    this.updateId = s.lastUpdateId;
  }

  /** Applies one diff event; "gap" means events were missed and the book must be rebuilt. */
  apply(e: DepthEvent): ApplyResult {
    if (!this.ready) return "ignored";
    if (e.u <= this.updateId) return "ignored";
    if (!this.synced) {
      // The first event after the snapshot must straddle it.
      if (e.U > this.updateId + 1) return "gap";
    } else if (e.pu !== undefined ? e.pu !== this.updateId : e.U !== this.updateId + 1) {
      return "gap";
    }
    for (const [p, q] of e.b) this.set(this.bids, p, +q);
    for (const [p, q] of e.a) this.set(this.asks, p, +q);
    this.updateId = e.u;
    this.synced = true;
    return "applied";
  }

  private set(side: Map<string, number>, price: string, qty: number) {
    if (qty === 0) side.delete(price);
    else side.set(price, qty);
  }

  /** Best `depth` levels per side: bids high→low, asks low→high. */
  top(depth = 500): { bids: Level[]; asks: Level[] } {
    const toLevels = (m: Map<string, number>, desc: boolean) =>
      [...m.entries()]
        .map(([p, q]) => [+p, q] as Level)
        .sort((x, y) => (desc ? y[0] - x[0] : x[0] - y[0]))
        .slice(0, depth);
    return { bids: toLevels(this.bids, true), asks: toLevels(this.asks, false) };
  }
}

/** Groups levels into price buckets of `step` (bids round down, asks round up), best first. */
export function groupLevels(levels: Level[], step: number, side: "bid" | "ask"): Level[] {
  const out = new Map<number, number>();
  for (const [p, q] of levels) {
    const k = side === "bid" ? Math.floor(p / step + 1e-9) * step : Math.ceil(p / step - 1e-9) * step;
    const key = +k.toFixed(10);
    out.set(key, (out.get(key) ?? 0) + q);
  }
  return [...out.entries()].sort((a, b) => (side === "bid" ? b[0] - a[0] : a[0] - b[0]));
}

/** Sensible grouping steps for a price, e.g. 0.01 … 100 for BTC. */
export function groupingSteps(price: number): number[] {
  if (!(price > 0)) return [1];
  // BTC at ~65,000 → 0.01, 0.1, 1, 10, 50, 100 (Binance's grouping choices).
  const base = 10 ** (Math.floor(Math.log10(price)) - 6);
  return [1, 10, 100, 1000, 5000, 10000].map((m) => +(base * m).toPrecision(6));
}
