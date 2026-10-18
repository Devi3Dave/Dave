import { useSyncExternalStore } from "react";
import { LocalBook, type DepthEvent, type DepthSnapshot, type Level } from "../../shared/orderbook";
import type { FeedStatus } from "./liquidationFeed";

export type BookMarket = "spot" | "futures";

export interface BookState {
  symbol: string | null;
  market: BookMarket;
  status: FeedStatus;
  error: string | null;
  bids: Level[];
  asks: Level[];
  updatedAt: number;
}

const ENDPOINTS: Record<BookMarket, { rest: string[]; ws: string }> = {
  spot: {
    rest: ["https://api.binance.com/api/v3/depth", "https://data-api.binance.vision/api/v3/depth"],
    ws: "wss://stream.binance.com:9443/ws",
  },
  futures: { rest: ["https://fapi.binance.com/fapi/v1/depth"], ws: "wss://fstream.binance.com/ws" },
};

// UI refresh rate; the stream itself delivers every 100 ms.
const PUBLISH_MS = 150;

/** Live local order book for one Binance symbol (snapshot + diff-depth stream). */
class OrderBookFeed {
  private state: BookState = { symbol: null, market: "spot", status: "off", error: null, bids: [], asks: [], updatedAt: 0 };
  private book = new LocalBook();
  private buffer: DepthEvent[] = [];
  private ws: WebSocket | null = null;
  private session = 0;
  private syncing = false;
  private publishTimer: number | undefined;
  private retryTimer: number | undefined;
  private listeners = new Set<() => void>();

  get = () => this.state;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<BookState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  start(symbol: string, market: BookMarket) {
    if (this.state.symbol === symbol && this.state.market === market && this.ws) return;
    this.stop();
    const session = ++this.session;
    this.set({ symbol, market, status: "connecting", error: null, bids: [], asks: [] });
    this.connect(symbol, market, session);
  }

  stop() {
    this.session++;
    window.clearTimeout(this.publishTimer);
    window.clearTimeout(this.retryTimer);
    this.publishTimer = undefined;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.book.reset();
    this.buffer = [];
    this.syncing = false;
    if (this.state.status !== "off") this.set({ symbol: null, status: "off" });
  }

  private connect(symbol: string, market: BookMarket, session: number) {
    const ws = new WebSocket(`${ENDPOINTS[market].ws}/${symbol.toLowerCase()}@depth@100ms`);
    this.ws = ws;
    ws.onopen = () => {
      if (session === this.session) void this.resync(symbol, market, session);
    };
    ws.onmessage = (ev) => {
      if (session !== this.session) return;
      const e = JSON.parse(ev.data) as DepthEvent;
      if (!this.book.ready) {
        this.buffer.push(e);
        if (this.buffer.length > 2000) this.buffer.shift();
        return;
      }
      if (this.book.apply(e) === "gap") {
        this.buffer = [e];
        void this.resync(symbol, market, session);
      } else this.schedulePublish();
    };
    ws.onclose = () => {
      if (session !== this.session) return;
      this.ws = null;
      this.set({ status: "error", error: "Verbindung zu Binance getrennt – neuer Versuch …" });
      this.retryTimer = window.setTimeout(() => {
        if (session === this.session) {
          this.book.reset();
          this.buffer = [];
          this.connect(symbol, market, session);
        }
      }, 3000);
    };
  }

  /** Steps 3–7 of Binance's "manage a local order book" procedure. */
  private async resync(symbol: string, market: BookMarket, session: number) {
    if (this.syncing) return;
    this.syncing = true;
    this.book.reset();
    try {
      for (let attempt = 0; attempt < 5 && session === this.session; attempt++) {
        const snap = await fetchSnapshot(symbol, market);
        if (session !== this.session) return;
        const first = this.buffer[0];
        // Snapshot older than the first buffered event: fetch again.
        if (first && snap.lastUpdateId < first.U - 1) continue;
        this.book.loadSnapshot(snap);
        const pending = this.buffer.filter((e) => e.u > snap.lastUpdateId);
        this.buffer = [];
        let ok = true;
        for (const e of pending) {
          if (this.book.apply(e) === "gap") {
            ok = false;
            break;
          }
        }
        if (!ok) {
          this.book.reset();
          continue;
        }
        this.set({ status: "live", error: null });
        this.schedulePublish();
        return;
      }
      if (session === this.session) this.set({ status: "error", error: "Orderbuch konnte nicht synchronisiert werden." });
    } catch (err) {
      if (session === this.session) {
        this.set({ status: "error", error: `Orderbuch nicht verfügbar: ${(err as Error).message}` });
        this.retryTimer = window.setTimeout(() => {
          if (session === this.session) void this.resync(symbol, market, session);
        }, 5000);
      }
    } finally {
      this.syncing = false;
    }
  }

  private schedulePublish() {
    if (this.publishTimer !== undefined) return;
    this.publishTimer = window.setTimeout(() => {
      this.publishTimer = undefined;
      const { bids, asks } = this.book.top(1000);
      this.set({ bids, asks, updatedAt: Date.now() });
    }, PUBLISH_MS);
  }
}

async function fetchSnapshot(symbol: string, market: BookMarket): Promise<DepthSnapshot> {
  let lastError: unknown;
  for (const base of ENDPOINTS[market].rest) {
    try {
      const res = await fetch(`${base}?symbol=${encodeURIComponent(symbol)}&limit=1000`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as DepthSnapshot;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export const orderBookFeed = new OrderBookFeed();

export function useOrderBook(): BookState {
  return useSyncExternalStore(orderBookFeed.subscribe, orderBookFeed.get);
}
