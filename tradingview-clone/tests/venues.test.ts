import { afterEach, describe, expect, it, vi } from "vitest";
import { findAsset } from "../shared/assets";
import { referenceMarket } from "../shared/freshness";
import { loadMarketData } from "../shared/marketData";
import { parseSpread } from "../shared/spread";
import { parseVenueSymbol, perpSymbol, splitPair, stripBinance, venueSymbol, type Feed } from "../shared/venues";

// Response shapes as in each exchange's API documentation (see shared/venues.ts).
const H = 3600;
const T0 = 1_761_436_800; // 2025-10-26 00:00 UTC

/** The feed that loads a symbol. */
const feed = (symbol: string): Feed => parseVenueSymbol(symbol)!.feed;

describe("venue symbols", () => {
  it("splits pairs by their quote currency", () => {
    expect(splitPair("BTCUSDT")).toEqual({ base: "BTC", quote: "USDT" });
    expect(splitPair("BTCUSD")).toEqual({ base: "BTC", quote: "USD" });
    expect(splitPair("ETH-EUR")).toEqual({ base: "ETH", quote: "EUR" });
    expect(splitPair("ETHBTC")).toEqual({ base: "ETH", quote: "BTC" });
    expect(splitPair("TSLA")).toBeNull();
    expect(splitPair("BTCUSDT.P")).toBeNull();
  });

  it("reads TradingView-style spot symbols and leaves Binance spot plain", () => {
    expect(parseVenueSymbol("COINBASE:BTCUSD")).toMatchObject({ kind: "spot", native: "BTC-USD", pair: { base: "BTC", quote: "USD" } });
    expect(parseVenueSymbol("kraken:etheur")).toMatchObject({ native: "ETHEUR", wsNative: "ETH/EUR" });
    expect(parseVenueSymbol("KRAKEN:BTCUSD")).toMatchObject({ native: "XBTUSD", wsNative: "BTC/USD" });
    expect(parseVenueSymbol("BINANCE:BTCUSDT")).toBeNull();
    expect(stripBinance("BINANCE:BTCUSDT")).toBe("BTCUSDT");
    expect(stripBinance("BINANCE:BTCUSDT.P")).toBe("BINANCE:BTCUSDT.P");
    expect(parseVenueSymbol("BTCUSDT")).toBeNull();
    expect(parseVenueSymbol("NYSE:TSLA")).toBeNull();
  });

  it("maps perpetuals to each exchange's contract", () => {
    const p = (s: string) => {
      const i = parseVenueSymbol(s);
      return i && { kind: i.kind, native: i.native, inverse: !!i.inverse };
    };
    expect(p("BINANCE:BTCUSDT.P")).toEqual({ kind: "perp", native: "BTCUSDT", inverse: false });
    expect(p("BINANCE:BTCUSD.P")).toEqual({ kind: "perp", native: "BTCUSD_PERP", inverse: true });
    expect(p("BYBIT:BTCUSDT.P")).toEqual({ kind: "perp", native: "BTCUSDT", inverse: false });
    expect(p("BYBIT:BTCUSDC.P")).toEqual({ kind: "perp", native: "BTCPERP", inverse: false });
    expect(p("BYBIT:BTCUSD.P")).toEqual({ kind: "perp", native: "BTCUSD", inverse: true });
    expect(p("OKX:BTCUSDT.P")).toEqual({ kind: "perp", native: "BTC-USDT-SWAP", inverse: false });
    expect(p("OKX:BTCUSD.P")).toEqual({ kind: "perp", native: "BTC-USD-SWAP", inverse: true });
    expect(p("KRAKEN:BTCUSD.P")).toEqual({ kind: "perp", native: "PF_XBTUSD", inverse: false });
    expect(p("KRAKEN:PI_XBTUSD")).toEqual({ kind: "perp", native: "PI_XBTUSD", inverse: true });
    expect(p("BITFINEX:BTCUSDT.P")).toEqual({ kind: "perp", native: "tBTCF0:USTF0", inverse: false });
    // Coinbase and Bitstamp have no public perpetuals.
    expect(p("COINBASE:BTCUSD.P")).toBeNull();
    expect(p("BITSTAMP:BTCUSD.P")).toBeNull();
  });

  it("reads futures with an expiry under the exchange's own names", () => {
    expect(parseVenueSymbol("BINANCE:BTCUSDT_260327")).toMatchObject({ kind: "future", native: "BTCUSDT_260327", inverse: false });
    expect(parseVenueSymbol("BINANCE:BTCUSD_260327")).toMatchObject({ kind: "future", native: "BTCUSD_260327", inverse: true });
    expect(parseVenueSymbol("OKX:BTC-USD-260327")).toMatchObject({ kind: "future", native: "BTC-USD-260327", inverse: true });
    expect(parseVenueSymbol("BYBIT:BTCUSDT-27MAR26")).toMatchObject({ kind: "future", pair: { base: "BTC", quote: "USDT" } });
    expect(parseVenueSymbol("BYBIT:BTC-27MAR26")).toMatchObject({ kind: "future", pair: { base: "BTC", quote: "USDC" } });
    expect(parseVenueSymbol("BYBIT:BTCUSDH26")).toMatchObject({ kind: "future", inverse: true });
    expect(parseVenueSymbol("KRAKEN:FF_XBTUSD_260327")).toMatchObject({ kind: "future", pair: { base: "BTC", quote: "USD" } });
  });

  it("maps a Binance pair to the exchange's usual quote and perpetual", () => {
    expect(venueSymbol("COINBASE", "BTCUSDT")).toBe("COINBASE:BTCUSD");
    expect(venueSymbol("BYBIT", "SOLUSDT")).toBe("BYBIT:SOLUSDT");
    expect(venueSymbol("KRAKEN", "ETHBTC")).toBe("KRAKEN:ETHBTC");
    expect(venueSymbol("BINANCE", "COINBASE:BTCUSD")).toBe("BTCUSD");
    expect(perpSymbol("BINANCE", "BTCUSDT")).toBe("BINANCE:BTCUSDT.P");
    expect(perpSymbol("KRAKEN", "ETHUSDT")).toBe("KRAKEN:ETHUSD.P");
    expect(perpSymbol("COINBASE", "BTCUSDT")).toBeNull();
  });

  it("keeps the coin's name and 24/7 hours on every market", () => {
    expect(findAsset("COINBASE:BTCUSD")?.name).toBe("Bitcoin");
    expect(findAsset("BYBIT:ETHUSDT.P")?.name).toBe("Ethereum");
    expect(findAsset("OKX:BTC-USD-260327")?.name).toBe("Bitcoin");
    expect(findAsset("KRAKEN:ETHEUR")).toBeUndefined();
    expect(referenceMarket("BITSTAMP:BTCUSD", "venue").kind).toBe("24/7");
  });

  it("allows spreads between spot and perpetual", () => {
    expect(parseSpread("BINANCE:BTCUSDT.P - BTCUSDT")).toEqual({ left: { symbol: "BINANCE:BTCUSDT.P" }, op: "-", right: { symbol: "BTCUSDT" } });
    expect(parseSpread("COINBASE:BTCUSD - BINANCE:BTCUSDT")).toEqual({ left: { symbol: "COINBASE:BTCUSD" }, op: "-", right: { symbol: "BINANCE:BTCUSDT" } });
  });
});

describe("venue candles", () => {
  it("parses each exchange into ascending candles", () => {
    expect(
      feed("COINBASE:BTCUSD").parseCandles([
        [T0 + H, 9, 12, 10, 11, 5],
        [T0, 8, 11, 9, 10, 4],
      ]),
    ).toEqual([
      { time: T0, low: 8, high: 11, open: 9, close: 10, volume: 4 },
      { time: T0 + H, low: 9, high: 12, open: 10, close: 11, volume: 5 },
    ]);
    const kraken = feed("KRAKEN:BTCUSD").parseCandles({ error: [], result: { XXBTZUSD: [[T0, "9", "11", "8", "10", "9.5", "4", 12]], last: T0 } });
    expect(kraken).toEqual([{ time: T0, open: 9, high: 11, low: 8, close: 10, volume: 4 }]);
    const krakenFut = feed("KRAKEN:BTCUSD.P").parseCandles({ candles: [{ time: T0 * 1000, open: "9", high: "11", low: "8", close: "10", volume: 4 }], more_candles: false });
    expect(krakenFut).toEqual([{ time: T0, open: 9, high: 11, low: 8, close: 10, volume: 4 }]);
    const bybit = feed("BYBIT:BTCUSDT.P").parseCandles({ retCode: 0, result: { list: [[String((T0 + H) * 1000), "10", "12", "9", "11", "5", "55"], [String(T0 * 1000), "9", "11", "8", "10", "4", "40"]] } });
    expect(bybit.map((b) => b.time)).toEqual([T0, T0 + H]);
    const okx = feed("OKX:BTCUSDT.P").parseCandles({ code: "0", data: [[String(T0 * 1000), "9", "11", "8", "10", "4", "40", "40", "1"]] });
    expect(okx[0]).toEqual({ time: T0, open: 9, high: 11, low: 8, close: 10, volume: 4 });
    const bitstamp = feed("BITSTAMP:BTCUSD").parseCandles({ data: { pair: "BTC/USD", ohlc: [{ timestamp: String(T0), open: "9", high: "11", low: "8", close: "10", volume: "4" }] } });
    expect(bitstamp[0]).toEqual({ time: T0, open: 9, high: 11, low: 8, close: 10, volume: 4 });
    // Bitfinex: [MTS, OPEN, CLOSE, HIGH, LOW, VOLUME].
    expect(feed("BITFINEX:BTCUSD").parseCandles([[T0 * 1000, 9, 10, 11, 8, 4]])[0]).toEqual({ time: T0, open: 9, high: 11, low: 8, close: 10, volume: 4 });
    const binance = feed("BINANCE:BTCUSD.P").parseCandles([[T0 * 1000, "9", "11", "8", "10", "4", T0 * 1000 + 59_999, "0", 1, "0", "0", "0"]]);
    expect(binance[0]).toEqual({ time: T0, open: 9, high: 11, low: 8, close: 10, volume: 4 });
  });

  it("turns exchange errors into messages", () => {
    expect(() => feed("KRAKEN:BTCUSD").parseCandles({ error: ["EQuery:Unknown asset pair"] })).toThrow("Kraken: EQuery:Unknown asset pair");
    expect(() => feed("BYBIT:BTCUSDT").parseCandles({ retCode: 10001, retMsg: "Not supported symbols" })).toThrow("Bybit: Not supported symbols");
    expect(() => feed("COINBASE:BTCUSD").parseCandles({ message: "NotFound" })).toThrow("Coinbase: NotFound");
    expect(() => feed("BINANCE:FOOUSDT.P").parseCandles({ code: -1121, msg: "Invalid symbol." })).toThrow("Binance: Invalid symbol.");
  });

  it("asks the right API for each market", () => {
    const url = (symbol: string, code: string, end?: number) => {
      const i = parseVenueSymbol(symbol)!;
      return i.feed.candlesUrl(i.native, code, 300, end);
    };
    expect(url("KRAKEN:BTCUSD", "60")).toContain("api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60");
    expect(url("KRAKEN:BTCUSD.P", "1h", T0)).toBe(`https://futures.kraken.com/api/charts/v1/trade/PF_XBTUSD/1h?from=${T0 - 1 - 300 * H}&to=${T0 - 1}`);
    expect(url("BITFINEX:BTCUSDT", "1h")).toContain("trade:1h:tBTCUST/");
    expect(url("BITFINEX:DOGEUSD", "1h")).toContain("tDOGE:USD");
    expect(url("BITFINEX:BTCUSDT.P", "1h")).toContain("trade:1h:tBTCF0:USTF0/");
    expect(url("OKX:ETHUSDT", "1Dutc", T0)).toContain("instId=ETH-USDT&bar=1Dutc&limit=300&after=" + T0 * 1000);
    expect(url("OKX:ETHUSDT.P", "1H")).toContain("instId=ETH-USDT-SWAP");
    expect(url("COINBASE:BTCUSD", "3600", T0)).toContain(`start=${new Date((T0 - 300 * H) * 1000).toISOString()}`);
    expect(url("BYBIT:BTCUSDT.P", "60")).toContain("category=linear&symbol=BTCUSDT");
    expect(url("BYBIT:BTCUSD.P", "60")).toContain("category=inverse&symbol=BTCUSD&");
    expect(url("BYBIT:BTCUSDT", "60")).toContain("category=spot&symbol=BTCUSDT");
    expect(url("BINANCE:BTCUSDT.P", "1h")).toBe("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=300");
    expect(url("BINANCE:BTCUSD_260327", "1h", T0)).toBe(`https://dapi.binance.com/dapi/v1/klines?symbol=BTCUSD_260327&interval=1h&limit=300&endTime=${T0 * 1000 - 1}`);
  });

  it("subscribes to the market's trades", () => {
    const sub = (symbol: string) => {
      const i = parseVenueSymbol(symbol)!;
      return { url: i.feed.wsUrl, msg: JSON.parse(i.feed.subscribe(i.wsNative ?? i.native)) };
    };
    expect(sub("BINANCE:BTCUSDT.P")).toEqual({ url: "wss://fstream.binance.com/ws", msg: { method: "SUBSCRIBE", params: ["btcusdt@aggTrade"], id: 1 } });
    expect(sub("BINANCE:BTCUSD.P").url).toBe("wss://dstream.binance.com/ws");
    expect(sub("BYBIT:BTCUSDT.P")).toEqual({ url: "wss://stream.bybit.com/v5/public/linear", msg: { op: "subscribe", args: ["publicTrade.BTCUSDT"] } });
    expect(sub("KRAKEN:BTCUSD").msg.params.symbol).toEqual(["BTC/USD"]);
    expect(sub("KRAKEN:BTCUSD.P").msg).toEqual({ event: "subscribe", feed: "trade", product_ids: ["PF_XBTUSD"] });
    expect(sub("OKX:BTC-USD-260327").msg.args[0].instId).toBe("BTC-USD-260327");
  });

  it("reads live trades", () => {
    expect(feed("COINBASE:BTCUSD").parseTrades({ type: "ticker", price: "65000.5", last_size: "0.01", time: "2025-10-26T00:00:01Z" })).toEqual([{ price: 65000.5, size: 0.01, timeMs: (T0 + 1) * 1000 }]);
    expect(feed("BYBIT:BTCUSDT").parseTrades({ topic: "publicTrade.BTCUSDT", data: [{ T: 1, p: "2", v: "3" }] })).toEqual([{ price: 2, size: 3, timeMs: 1 }]);
    expect(feed("OKX:BTCUSDT").parseTrades({ arg: { channel: "trades" }, data: [{ px: "2", sz: "3", ts: "1" }] })).toEqual([{ price: 2, size: 3, timeMs: 1 }]);
    expect(feed("BITFINEX:BTCUSD").parseTrades([17, "te", [1, 5, -0.5, 65000]])).toEqual([{ price: 65000, size: 0.5, timeMs: 5 }]);
    expect(feed("BITFINEX:BTCUSD").parseTrades([17, "hb"])).toEqual([]);
    expect(feed("KRAKEN:BTCUSD").parseTrades({ channel: "trade", type: "snapshot", data: [{ price: 1, qty: 1, timestamp: "2025-10-26T00:00:00Z" }] })).toEqual([]);
    expect(feed("KRAKEN:BTCUSD.P").parseTrades({ feed: "trade", product_id: "PF_XBTUSD", price: 2, qty: 3, time: 5 })).toEqual([{ price: 2, size: 3, timeMs: 5 }]);
    expect(feed("KRAKEN:BTCUSD.P").parseTrades({ feed: "trade_snapshot", trades: [] })).toEqual([]);
    expect(feed("BITSTAMP:BTCUSD").parseTrades({ event: "trade", data: { price: 2, amount: 3, microtimestamp: "5000000" } })).toEqual([{ price: 2, size: 3, timeMs: 5000 }]);
    expect(feed("BINANCE:BTCUSDT.P").parseTrades({ e: "aggTrade", p: "2", q: "3", T: 5 })).toEqual([{ price: 2, size: 3, timeMs: 5 }]);
  });
});

describe("loading from an exchange", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Coinbase hourly candles back from `end`, newest first, as its API sends them. */
  function stubCoinbase(newest: number) {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      const gran = Number(/granularity=(\d+)/.exec(url)![1]);
      const endIso = /end=([^&]+)/.exec(url)?.[1];
      const last = endIso ? Math.floor(Date.parse(decodeURIComponent(endIso)) / 1000 / gran) * gran : newest;
      const rows = Array.from({ length: 300 }, (_, i) => [last - i * gran, 99, 101, 100, 100.5, 1]);
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

  it("loads a Binance perpetual from the futures API", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify([[T0 * 1000, "1", "2", "0.5", "1.5", "10", 0, 0, 0, "5"]]), { status: 200 });
    });
    const data = await loadMarketData("BINANCE:BTCUSDT.P", "1h", 1);
    expect(data).toMatchObject({ symbol: "BINANCE:BTCUSDT.P", source: "venue" });
    expect(urls[0]).toContain("fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h");
  });

  it("reports a market the exchange does not have instead of showing other prices", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: ["EQuery:Unknown asset pair"] }), { status: 200 }));
    await expect(loadMarketData("KRAKEN:FOOUSD", "1h")).rejects.toThrow("Kraken");
    await expect(loadMarketData("KRAKEN:BTCUSD", "1s")).rejects.toThrow("Sekunden");
    await expect(loadMarketData("COINBASE:BTCUSD.P", "1h")).rejects.toThrow("gibt es bei der Börse nicht");
  });

  it("treats BINANCE: spot as the plain Binance pair", async () => {
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

describe("Bitget, KuCoin, Deribit, BitMEX and options", () => {
  const p = (s: string) => {
    const i = parseVenueSymbol(s);
    return i && { kind: i.kind, native: i.native, inverse: !!i.inverse, quote: i.pair.quote };
  };

  it("maps spot, perpetuals and futures to each exchange's names", () => {
    expect(p("BITGET:BTCUSDT")).toEqual({ kind: "spot", native: "BTCUSDT", inverse: false, quote: "USDT" });
    expect(p("BITGET:BTCUSDT.P")).toEqual({ kind: "perp", native: "BTCUSDT", inverse: false, quote: "USDT" });
    expect(p("BITGET:BTCUSDC.P")).toEqual({ kind: "perp", native: "BTCPERP", inverse: false, quote: "USDC" });
    expect(p("BITGET:BTCUSD.P")).toEqual({ kind: "perp", native: "BTCUSD", inverse: true, quote: "USD" });
    expect(p("BITGET:BTCUSDZ26")).toEqual({ kind: "future", native: "BTCUSDZ26", inverse: true, quote: "USD" });
    expect(p("KUCOIN:BTCUSDT")).toEqual({ kind: "spot", native: "BTC-USDT", inverse: false, quote: "USDT" });
    expect(p("KUCOIN:BTCUSDT.P")).toEqual({ kind: "perp", native: "XBTUSDTM", inverse: false, quote: "USDT" });
    expect(p("KUCOIN:BTCUSD.P")).toEqual({ kind: "perp", native: "XBTUSDM", inverse: true, quote: "USD" });
    expect(p("KUCOIN:XBTMZ26")).toEqual({ kind: "future", native: "XBTMZ26", inverse: true, quote: "USD" });
    expect(p("DERIBIT:BTCUSD.P")).toEqual({ kind: "perp", native: "BTC-PERPETUAL", inverse: true, quote: "USD" });
    expect(p("DERIBIT:SOLUSDC.P")).toEqual({ kind: "perp", native: "SOL_USDC-PERPETUAL", inverse: false, quote: "USDC" });
    expect(p("DERIBIT:BTC-27MAR26")).toEqual({ kind: "future", native: "BTC-27MAR26", inverse: true, quote: "USD" });
    // Deribit routes spot to Coinbase and has no candles for it.
    expect(parseVenueSymbol("DERIBIT:BTCUSDC")).toBeNull();
    expect(p("BITMEX:BTCUSD.P")).toEqual({ kind: "perp", native: "XBTUSD", inverse: true, quote: "USD" });
    expect(p("BITMEX:BTCUSDT.P")).toEqual({ kind: "perp", native: "XBTUSDT", inverse: false, quote: "USDT" });
    expect(p("BITMEX:XBTZ26")).toEqual({ kind: "future", native: "XBTZ26", inverse: true, quote: "USD" });
    expect(p("BITMEX:ETHUSDTZ26")).toEqual({ kind: "future", native: "ETHUSDTZ26", inverse: false, quote: "USDT" });
    expect(p("BITMEX:BTCUSDT")).toEqual({ kind: "spot", native: "XBT_USDT", inverse: false, quote: "USDT" });
    expect(perpSymbol("DERIBIT", "BTCUSDT")).toBe("DERIBIT:BTCUSD.P");
    expect(venueSymbol("KUCOIN", "BTCUSDT")).toBe("KUCOIN:BTCUSDT");
  });

  it("reads options under the exchange's names", () => {
    expect(p("DERIBIT:BTC-27MAR26-100000-C")).toEqual({ kind: "option", native: "BTC-27MAR26-100000-C", inverse: true, quote: "USD" });
    expect(p("DERIBIT:XRP_USDC-27MAR26-0d625-P")).toMatchObject({ kind: "option", native: "XRP_USDC-27MAR26-0d625-P" });
    expect(p("OKX:BTC-USD-260327-100000-C")).toEqual({ kind: "option", native: "BTC-USD-260327-100000-C", inverse: true, quote: "USD" });
    expect(p("BINANCE:BTC-260327-100000-P")).toEqual({ kind: "option", native: "BTC-260327-100000-P", inverse: false, quote: "USDT" });
    expect(findAsset("DERIBIT:BTC-27MAR26-100000-C")?.name).toBe("Bitcoin");
  });

  it("parses their candles", () => {
    expect(feed("BITGET:BTCUSDT.P").parseCandles({ code: "00000", data: [[String((T0 + H) * 1000), "10", "12", "9", "11", "5", "55"], [String(T0 * 1000), "9", "11", "8", "10", "4", "40"]] }).map((b) => b.time)).toEqual([T0, T0 + H]);
    expect(feed("KUCOIN:BTCUSDT").parseCandles({ code: "200000", data: [[String(T0), "9", "10", "11", "8", "4", "40"]] })[0]).toEqual({ time: T0, open: 9, close: 10, high: 11, low: 8, volume: 4 });
    expect(feed("KUCOIN:BTCUSDT.P").parseCandles({ code: "200000", data: [[T0 * 1000, 9, 11, 8, 10, 4]] })[0]).toEqual({ time: T0, open: 9, high: 11, low: 8, close: 10, volume: 4 });
    expect(feed("DERIBIT:BTCUSD.P").parseCandles({ result: { status: "ok", ticks: [T0 * 1000], open: [9], high: [11], low: [8], close: [10], volume: [4] } })[0]).toEqual({ time: T0, open: 9, high: 11, low: 8, close: 10, volume: 4 });
    // BitMEX stamps buckets with their end, newest first.
    const bitmex = feed("BITMEX:BTCUSD.P").parseCandles([
      { timestamp: new Date((T0 + 2 * H) * 1000).toISOString(), open: 10, high: 12, low: 9, close: 11, volume: 5 },
      { timestamp: new Date((T0 + H) * 1000).toISOString(), open: 9, high: 11, low: 8, close: 10, volume: 4 },
    ]);
    expect(bitmex.map((b) => b.time)).toEqual([T0, T0 + H]);
    expect(feed("BINANCE:BTC-260327-100000-C").parseCandles([{ openTime: T0 * 1000, open: "9", high: "11", low: "8", close: "10", volume: "4" }])[0]).toEqual({ time: T0, open: 9, high: 11, low: 8, close: 10, volume: 4 });
    expect(() => feed("BITGET:BTCUSDT").parseCandles({ code: "40034", msg: "Parameter does not exist" })).toThrow("Bitget: Parameter does not exist");
  });

  it("asks the right APIs", () => {
    const url = (symbol: string, code: string, end?: number) => {
      const i = parseVenueSymbol(symbol)!;
      return i.feed.candlesUrl(i.native, code, 100, end);
    };
    expect(url("BITGET:BTCUSD.P", "1H")).toContain("/mix/market/candles?symbol=BTCUSD&productType=COIN-FUTURES&granularity=1H");
    expect(url("BITGET:BTCUSDT", "1h")).toContain("/spot/market/candles?symbol=BTCUSDT&granularity=1h");
    expect(url("KUCOIN:BTCUSDT", "1hour", T0)).toBe(`https://api.kucoin.com/api/v1/market/candles?type=1hour&symbol=BTC-USDT&startAt=${T0 - 1 - 100 * H}&endAt=${T0 - 1}`);
    expect(url("KUCOIN:BTCUSDT.P", "60", T0)).toBe(`https://api-futures.kucoin.com/api/v1/kline/query?symbol=XBTUSDTM&granularity=60&from=${T0 * 1000 - 1 - 100 * H * 1000}&to=${T0 * 1000 - 1}`);
    expect(url("DERIBIT:BTC-27MAR26-100000-C", "60", T0)).toContain("instrument_name=BTC-27MAR26-100000-C&resolution=60");
    expect(url("BITMEX:BTCUSD.P", "1h")).toContain("binSize=1h&partial=true&symbol=XBTUSD&count=100&reverse=true");
    expect(url("BINANCE:BTC-260327-100000-C", "1h")).toContain("eapi.binance.com/eapi/v1/klines?symbol=BTC-260327-100000-C");
    expect(url("OKX:BTC-USD-260327-100000-C", "1H")).toContain("instId=BTC-USD-260327-100000-C");
  });

  it("reads their live trades; KuCoin has no public stream", () => {
    expect(feed("BITGET:BTCUSDT").parseTrades({ action: "update", arg: { channel: "trade" }, data: [{ ts: "5", price: "2", size: "3" }] })).toEqual([{ price: 2, size: 3, timeMs: 5 }]);
    expect(feed("DERIBIT:BTCUSD.P").parseTrades({ method: "subscription", params: { channel: "trades.BTC-PERPETUAL.100ms", data: [{ price: 2, amount: 3, timestamp: 5 }] } })).toEqual([{ price: 2, size: 3, timeMs: 5 }]);
    expect(feed("BITMEX:BTCUSD.P").parseTrades({ table: "trade", action: "insert", data: [{ price: 2, size: 3, timestamp: "1970-01-01T00:00:00.005Z" }] })).toEqual([{ price: 2, size: 3, timeMs: 5 }]);
    expect(feed("BITMEX:BTCUSD.P").parseTrades({ table: "trade", action: "partial", data: [] })).toEqual([]);
    expect(feed("BINANCE:BTC-260327-100000-C").parseTrades({ e: "trade", p: "2", q: "3", T: 5 })).toEqual([{ price: 2, size: 3, timeMs: 5 }]);
    expect(feed("KUCOIN:BTCUSDT").wsUrl).toBeUndefined();
  });
});
