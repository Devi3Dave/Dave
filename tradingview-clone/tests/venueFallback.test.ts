import { afterEach, describe, expect, it, vi } from "vitest";
import { isNetworkError, loadMarketData } from "../shared/marketData";
import { checkVenue } from "../shared/venueCheck";
import { isBlockedSymbol, loadedMarketTag, marketTag, pickerPerps, pickerVenues, VENUES } from "../shared/venues";

/** A WebSocket that answers each sent message with `reply(msg)` (nothing for null). */
function fakeWebSocket(reply: (msg: unknown, url: string) => unknown | null, sent: unknown[] = []) {
  return class {
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(public url: string) {
      setTimeout(() => this.onopen?.(), 0);
    }
    send(data: string) {
      const msg = JSON.parse(data);
      sent.push(msg);
      const out = reply(msg, this.url);
      if (out !== null) setTimeout(() => this.onmessage?.({ data: JSON.stringify(out) }), 0);
    }
    close() {}
  };
}

const blocked = async () => {
  throw new TypeError("Load failed");
};

afterEach(() => vi.unstubAllGlobals());

describe("blocked REST (CORS)", () => {
  it("recognises the browsers' network errors", () => {
    expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
    expect(isNetworkError(new Error("Failed to fetch"))).toBe(true);
    expect(isNetworkError(Object.assign(new Error("signal timed out"), { name: "TimeoutError" }))).toBe(true);
    expect(isNetworkError(new Error("Kraken: EQuery:Unknown asset pair"))).toBe(false);
  });

  it("loads Kraken spot candles from the WebSocket ohlc snapshot", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", blocked);
    vi.stubGlobal(
      "WebSocket",
      fakeWebSocket(
        () => ({
          channel: "ohlc",
          type: "snapshot",
          data: [
            { symbol: "BTC/USD", open: 2, high: 3, low: 1, close: 2.5, volume: 10, interval_begin: "2026-10-28T11:00:00.000000000Z", interval: 60 },
            { symbol: "BTC/USD", open: 1, high: 2, low: 1, close: 2, volume: 5, interval_begin: "2026-10-28T10:00:00.000000000Z", interval: 60 },
          ],
        }),
        sent,
      ),
    );
    const data = await loadMarketData("KRAKEN:BTCUSD", "1h", 100);
    expect(sent[0]).toEqual({ method: "subscribe", params: { channel: "ohlc", symbol: ["BTC/USD"], interval: 60, snapshot: true } });
    expect(data.source).toBe("venue");
    expect(data.bars.map((b) => b.time)).toEqual([Date.parse("2026-10-28T10:00:00Z") / 1000, Date.parse("2026-10-28T11:00:00Z") / 1000]);
    expect(data.bars[1].close).toBe(2.5);
  });

  it("loads Deribit candles with JSON-RPC over the WebSocket", async () => {
    const sent: { method?: string; params?: { instrument_name?: string; resolution?: string } }[] = [];
    vi.stubGlobal("fetch", blocked);
    vi.stubGlobal(
      "WebSocket",
      fakeWebSocket(
        (m) => ({ jsonrpc: "2.0", id: (m as { id: number }).id, result: { status: "ok", ticks: [3600_000, 7200_000], open: [1, 2], high: [2, 3], low: [1, 2], close: [2, 3], volume: [4, 5] } }),
        sent,
      ),
    );
    const data = await loadMarketData("DERIBIT:BTC-PERPETUAL", "1h", 2);
    expect(sent[0].method).toBe("public/get_tradingview_chart_data");
    expect(sent[0].params).toMatchObject({ instrument_name: "BTC-PERPETUAL", resolution: "60" });
    expect(data.bars.map((b) => b.close)).toEqual([2, 3]);
  });

  it("loads Bitget candles from the candle channel snapshot", async () => {
    const sent: { args?: { channel: string; instType: string }[] }[] = [];
    vi.stubGlobal("fetch", blocked);
    vi.stubGlobal(
      "WebSocket",
      fakeWebSocket(
        (m) => {
          const arg = (m as { args: object[] }).args[0];
          return { action: "snapshot", arg, data: [["7200000", "2", "3", "1", "2.5", "9"], ["3600000", "1", "2", "1", "2", "8"]] };
        },
        sent,
      ),
    );
    const data = await loadMarketData("BITGET:BTCUSDT.P", "1h", 10);
    expect(sent[0].args?.[0]).toMatchObject({ channel: "candle1H", instType: "USDT-FUTURES" });
    expect(data.bars.map((b) => b.time)).toEqual([3600, 7200]);
  });

  it("loads Bitfinex candles from the candles channel snapshot", async () => {
    const sent: { channel?: string; key?: string }[] = [];
    vi.stubGlobal("fetch", blocked);
    vi.stubGlobal(
      "WebSocket",
      fakeWebSocket(
        // Bitfinex answers with info and subscribed events first; the snapshot is newest first.
        () => [17, [[7_200_000, 2, 2.5, 3, 1, 9], [3_600_000, 1, 2, 2, 1, 8]]],
        sent,
      ),
    );
    const data = await loadMarketData("BITFINEX:BTCUSD", "1h", 10);
    expect(sent[0]).toEqual({ event: "subscribe", channel: "candles", key: "trade:1h:tBTCUSD" });
    expect(data.bars.map((b) => [b.time, b.close])).toEqual([[3600, 2], [7200, 2.5]]);
  });

  it("marks exchanges whose feeds the browser blocks and Deribit without spot", () => {
    const v = (id: string) => VENUES.find((x) => x.id === id)!;
    expect(v("KUCOIN")).toMatchObject({ spotBlocked: true, perpBlocked: true });
    expect(v("BITMEX")).toMatchObject({ spotBlocked: true, perpBlocked: true });
    expect(v("KRAKEN")).toMatchObject({ spotBlocked: false, perpBlocked: true });
    expect(v("BITFINEX")).toMatchObject({ spotBlocked: false, perpBlocked: false });
    expect(v("DERIBIT").noSpot).toContain("Coinbase");
  });

  it("names the exchange instead of Safari's 'Load failed' where no WebSocket helps", async () => {
    vi.stubGlobal("fetch", blocked);
    await expect(loadMarketData("KUCOIN:BTCUSDT", "1h")).rejects.toThrow("KuCoin lässt den Abruf aus dem Browser nicht zu");
  });

  it("keeps exchange errors as they are", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: ["EQuery:Unknown asset pair"] }), { status: 200 }));
    await expect(loadMarketData("KRAKEN:FOOUSD", "1h")).rejects.toThrow("EQuery");
  });
});

describe("connection test", () => {
  it("reports blocked REST, the WebSocket fallback and live trades for Kraken", async () => {
    const deps = {
      fetchJson: blocked,
      isNetworkError,
      async wsRequest<T>(url: string, message: string, parse: (m: unknown) => T | null): Promise<T> {
        const m = JSON.parse(message) as { params?: { channel?: string }; event?: string };
        if (url.includes("futures")) throw new Error("WebSocket-Verbindung fehlgeschlagen");
        const reply =
          m.params?.channel === "ohlc"
            ? { channel: "ohlc", type: "snapshot", data: [{ open: 1, high: 2, low: 1, close: 2, volume: 1, interval_begin: "2026-10-28T10:00:00Z" }] }
            : { channel: "trade", type: "update", data: [{ price: 70000, qty: 0.1, timestamp: "2026-10-28T10:00:01Z" }] };
        return parse(reply) as T;
      },
    };
    const steps = await checkVenue("KRAKEN", deps);
    const by = (label: string) => steps.find((s) => s.label.startsWith(label));
    expect(by("Spot KRAKEN:BTCUSD: Kerzen (REST)")?.state).toBe("fail");
    expect(by("Spot KRAKEN:BTCUSD: Kerzen (REST)")?.detail).toContain("CORS");
    expect(by("Spot KRAKEN:BTCUSD: Kerzen über WebSocket")).toMatchObject({ state: "ok", detail: "1 Kerzen, letzter Kurs 2" });
    expect(by("Spot KRAKEN:BTCUSD: Live-Kurse")).toMatchObject({ state: "ok", detail: "Trade zu 70000" });
    expect(by("Perp KRAKEN:BTCUSD.P: Kerzen über WebSocket")?.state).toBe("skip");
    expect(by("Perp KRAKEN:BTCUSD.P: Live-Kurse")?.state).toBe("fail");
    expect(by("Marktliste")?.state).toBe("fail");
  });
});

describe("picker shows only what loads", () => {
  it("leaves out KuCoin and BitMEX and Kraken's perpetuals", () => {
    expect(pickerVenues().map((v) => v.id)).toEqual(["BINANCE", "COINBASE", "KRAKEN", "BYBIT", "OKX", "BITSTAMP", "BITFINEX", "BITGET", "DERIBIT"]);
    expect(pickerPerps("KRAKEN")).toBe(false);
    expect(pickerPerps("BYBIT")).toBe(true);
    expect(pickerPerps("DERIBIT")).toBe(true);
    expect(isBlockedSymbol("KRAKEN:BTCUSD.P")).toBe(true);
    expect(isBlockedSymbol("BINANCE:BTC-260327-100000-C")).toBe(true);
    expect(isBlockedSymbol("KRAKEN:BTCUSD")).toBe(false);
  });

  it("names exchange, form and pair of the loaded market", () => {
    expect(marketTag("KRAKEN:BTCUSD")).toBe("Kraken · Spot · BTC/USD");
    expect(marketTag("BYBIT:ETHUSDT.P")).toBe("Bybit · Perp · ETH/USDT");
    expect(marketTag("BTCUSDT")).toBeNull();
    expect(loadedMarketTag("BTCUSDT", "binance")).toBe("Binance · Spot · BTC/USDT");
    expect(loadedMarketTag("XAUUSDT", "binance_futures")).toBe("Binance · Perp · XAU/USDT");
    expect(loadedMarketTag("OKX:BTCUSDT.P", "venue")).toBe("OKX · Perp · BTC/USDT");
    expect(loadedMarketTag("AAPL", "yahoo")).toBeNull();
  });
});
