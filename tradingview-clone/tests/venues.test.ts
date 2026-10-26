import { afterEach, describe, expect, it, vi } from "vitest";
import { findAsset } from "../shared/assets";
import { referenceMarket } from "../shared/freshness";
import { loadMarketData } from "../shared/marketData";
import { parseSpread } from "../shared/spread";
import { getVenue, parseVenueSymbol, splitPair, venueSymbol } from "../shared/venues";

// Response shapes as in each exchange's API documentation (see shared/venues.ts).
const H = 3600;
const T0 = 1_761_436_800; // 2025-10-26 00:00 UTC

describe("venue symbols", () => {
  it("splits pairs by their quote currency", () => {
    expect(splitPair("BTCUSDT")).toEqual({ base: "BTC", quote: "USDT" });
    expect(splitPair("BTCUSD")).toEqual({ base: "BTC", quote: "USD" });
    expect(splitPair("ETH-EUR")).toEqual({ base: "ETH", quote: "EUR" });
    expect(splitPair("ETHBTC")).toEqual({ base: "ETH", quote: "BTC" });
    expect(splitPair("TSLA")).toBeNull();
  });

  it("reads TradingView-style symbols and leaves Binance plain", () => {
    expect(parseVenueSymbol("COINBASE:BTCUSD")).toMatchObject({ venue: { id: "COINBASE" }, pair: { base: "BTC", quote: "USD" } });
    expect(parseVenueSymbol("kraken:etheur")?.pair).toEqual({ base: "ETH", quote: "EUR" });
    expect(parseVenueSymbol("BINANCE:BTCUSDT")).toBeNull();
    expect(parseVenueSymbol("BTCUSDT")).toBeNull();
    expect(parseVenueSymbol("NYSE:TSLA")).toBeNull();
  });

  it("maps a Binance pair to the exchange's usual quote", () => {
    expect(venueSymbol("COINBASE", "BTCUSDT")).toBe("COINBASE:BTCUSD");
    expect(venueSymbol("BYBIT", "SOLUSDT")).toBe("BYBIT:SOLUSDT");
    expect(venueSymbol("KRAKEN", "ETHBTC")).toBe("KRAKEN:ETHBTC");
    expect(venueSymbol("BINANCE", "COINBASE:BTCUSD")).toBe("BTCUSD");
  });

  it("keeps the coin's name and 24/7 hours on other exchanges", () => {
    expect(findAsset("COINBASE:BTCUSD")?.name).toBe("Bitcoin");
    expect(findAsset("KRAKEN:ETHEUR")).toBeUndefined();
    expect(referenceMarket("BITSTAMP:BTCUSD", "venue").kind).toBe("24/7");
  });

  it("allows spreads between two exchanges", () => {
    expect(parseSpread("COINBASE:BTCUSD - BINANCE:BTCUSDT")).toEqual({ left: { symbol: "COINBASE:BTCUSD" }, op: "-", right: { symbol: "BINANCE:BTCUSDT" } });
  });
});

describe("venue candles", () => {
  it("parses each exchange into ascending candles", () => {
    const coinbase = getVenue("COINBASE")!.parseCandles([
      [T0 + H, 9, 12, 10, 11, 5],
      [T0, 8, 11, 9, 10, 4],
    ]);
    expect(coinbase).toEqual([
      { time: T0, low: 8, high: 11, open: 9, close: 10, volume: 4 },
      { time: T0 + H, low: 9, high: 12, open: 10, close: 11, volume: 5 },
    ]);
    const kraken = getVenue("KRAKEN")!.parseCandles({ error: [], result: { XXBTZUSD: [[T0, "9", "11", "8", "10", "9.5", "4", 12]], last: T0 } });
    expect(kraken).toEqual([{ time: T0, open: 9, high: 11, low: 8, close: 10, volume: 4 }]);
    const bybit = getVenue("BYBIT")!.parseCandles({ retCode: 0, result: { list: [[String((T0 + H) * 1000), "10", "12", "9", "11", "5", "55"], [String(T0 * 1000), "9", "11", "8", "10", "4", "40"]] } });
    expect(bybit.map((b) => b.time)).toEqual([T0, T0 + H]);
    const okx = getVenue("OKX")!.parseCandles({ code: "0", data: [[String(T0 * 1000), "9", "11", "8", "10", "4", "40", "40", "1"]] });
    expect(okx[0]).toEqual({ time: T0, open: 9, high: 11, low: 8, close: 10, volume: 4 });
    const bitstamp = getVenue("BITSTAMP")!.parseCandles({ data: { pair: "BTC/USD", ohlc: [{ timestamp: String(T0), open: "9", high: "11", low: "8", close: "10", volume: "4" }] } });
    expect(bitstamp[0]).toEqual({ time: T0, open: 9, high: 11, low: 8, close: 10, volume: 4 });
    // Bitfinex: [MTS, OPEN, CLOSE, HIGH, LOW, VOLUME].
    const bitfinex = getVenue("BITFINEX")!.parseCandles([[T0 * 1000, 9, 10, 11, 8, 4]]);
    expect(bitfinex[0]).toEqual({ time: T0, open: 9, high: 11, low: 8, close: 10, volume: 4 });
  });

  it("turns exchange errors into messages", () => {
    expect(() => getVenue("KRAKEN")!.parseCandles({ error: ["EQuery:Unknown asset pair"] })).toThrow("Kraken: EQuery:Unknown asset pair");
    expect(() => getVenue("BYBIT")!.parseCandles({ retCode: 10001, retMsg: "Not supported symbols" })).toThrow("Bybit: Not supported symbols");
    expect(() => getVenue("COINBASE")!.parseCandles({ message: "NotFound" })).toThrow("Coinbase: NotFound");
  });

  it("builds the exchanges' own pair names", () => {
    const btcusd = { base: "BTC", quote: "USD" };
    expect(getVenue("KRAKEN")!.candlesUrl(btcusd, "60", 720)).toContain("pair=XBTUSD&interval=60");
    expect(getVenue("BITFINEX")!.candlesUrl({ base: "BTC", quote: "USDT" }, "1h", 1000)).toContain("trade:1h:tBTCUST/");
    expect(getVenue("BITFINEX")!.candlesUrl({ base: "DOGE", quote: "USD" }, "1h", 1000)).toContain("tDOGE:USD");
    expect(getVenue("OKX")!.candlesUrl({ base: "ETH", quote: "USDT" }, "1Dutc", 300, T0)).toContain("instId=ETH-USDT&bar=1Dutc&limit=300&after=" + T0 * 1000);
    expect(getVenue("COINBASE")!.candlesUrl(btcusd, "3600", 300, T0)).toContain(`start=${new Date((T0 - 300 * H) * 1000).toISOString()}`);
  });

  it("reads live trades", () => {
    expect(getVenue("COINBASE")!.parseTrades({ type: "ticker", price: "65000.5", last_size: "0.01", time: "2025-10-26T00:00:01Z" })).toEqual([{ price: 65000.5, size: 0.01, timeMs: (T0 + 1) * 1000 }]);
    expect(getVenue("BYBIT")!.parseTrades({ topic: "publicTrade.BTCUSDT", data: [{ T: 1, p: "2", v: "3" }] })).toEqual([{ price: 2, size: 3, timeMs: 1 }]);
    expect(getVenue("OKX")!.parseTrades({ arg: { channel: "trades" }, data: [{ px: "2", sz: "3", ts: "1" }] })).toEqual([{ price: 2, size: 3, timeMs: 1 }]);
    expect(getVenue("BITFINEX")!.parseTrades([17, "te", [1, 5, -0.5, 65000]])).toEqual([{ price: 65000, size: 0.5, timeMs: 5 }]);
    expect(getVenue("BITFINEX")!.parseTrades([17, "hb"])).toEqual([]);
    expect(getVenue("KRAKEN")!.parseTrades({ channel: "trade", type: "snapshot", data: [{ price: 1, qty: 1, timestamp: "2025-10-26T00:00:00Z" }] })).toEqual([]);
    expect(getVenue("BITSTAMP")!.parseTrades({ event: "trade", data: { price: 2, amount: 3, microtimestamp: "5000000" } })).toEqual([{ price: 2, size: 3, timeMs: 5000 }]);
  });
});

describe("loading from another exchange", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Coinbase hourly candles back from `end`, newest first, as its API sends them. */
  function stubCoinbase(newest: number) {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      const gran = Number(/granularity=(\d+)/.exec(url)![1]);
      const endIso = /end=([^&]+)/.exec(url)?.[1];
      const last = endIso ? Math.floor(Date.parse(decodeURIComponent(endIso)) / 1000 / gran) * gran : newest;
      const rows = Array.from({ length: 300 }, (_, i) => {
        const t = last - i * gran;
        return [t, 99, 101, 100, 100.5, 1];
      });
      return new Response(JSON.stringify(rows), { status: 200 });
    });
    return urls;
  }

  it("pages back and merges candles the exchange does not have", async () => {
    const urls = stubCoinbase(T0);
    const data = await loadMarketData("COINBASE:BTCUSD", "4h", 500);
    expect(data.source).toBe("venue");
    expect(data.symbol).toBe("COINBASE:BTCUSD");
    // 500 four-hour candles need 2000 hourly ones: 5 pages of 300 is the most it asks for.
    expect(urls.length).toBe(5);
    expect(data.bars.every((b) => b.time % (4 * H) === 0)).toBe(true);
    const times = data.bars.map((b) => b.time);
    expect(new Set(times).size).toBe(times.length);
  });

  it("starts weeks on Monday", async () => {
    stubCoinbase(T0);
    const data = await loadMarketData("COINBASE:BTCUSD", "1w", 10);
    for (const b of data.bars) expect(new Date(b.time * 1000).getUTCDay()).toBe(1);
  });

  it("reports a pair the exchange does not list instead of showing other prices", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: ["EQuery:Unknown asset pair"] }), { status: 200 }));
    await expect(loadMarketData("KRAKEN:FOOUSD", "1h")).rejects.toThrow("Kraken");
    await expect(loadMarketData("KRAKEN:BTCUSD", "1s")).rejects.toThrow("Sekunden");
  });

  it("treats BINANCE: as the plain Binance pair", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify([[T0 * 1000, "1", "2", "0.5", "1.5", "10", 0, 0, 0, "5"]]), { status: 200 });
    });
    const data = await loadMarketData("BINANCE:BTCUSDT", "1h", 1);
    expect(data).toMatchObject({ symbol: "BTCUSDT", source: "binance" });
    expect(urls[0]).toContain("symbol=BTCUSDT");
  });
});
