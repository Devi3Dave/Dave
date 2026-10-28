import { describe, expect, it } from "vitest";
import {
  loadVenueMarkets,
  marketLabel,
  parseBinanceFutures,
  parseBinanceOptions,
  parseBinanceSpot,
  parseBitgetContracts,
  parseBitgetSpot,
  parseBitmex,
  parseDeribit,
  parseKucoinFutures,
  parseKucoinSpot,
  parseOkxOptions,
  parseBitfinex,
  parseBitstamp,
  parseBybit,
  parseCoinbase,
  parseKrakenFutures,
  parseKrakenSpot,
  parseOkx,
  searchMarkets,
} from "../shared/venueMarkets";
import { parseVenueSymbol } from "../shared/venues";

// Shapes as in the exchanges' instrument endpoints (shared/venueMarkets.ts).
const symbols = (list: { symbol: string }[]) => list.map((m) => m.symbol);

describe("market lists", () => {
  it("reads Binance spot, USDⓈ-M and COIN-M", () => {
    expect(symbols(parseBinanceSpot([{ symbol: "BTCUSDT" }, { symbol: "ETHBTC" }, { symbol: "BTCUPUSDT" }, { symbol: "XYZ" }]))).toEqual(["BTCUSDT", "ETHBTC"]);
    const usdm = parseBinanceFutures({
      symbols: [
        { symbol: "BTCUSDT", pair: "BTCUSDT", contractType: "PERPETUAL", status: "TRADING" },
        { symbol: "BTCUSDT_260327", pair: "BTCUSDT", contractType: "CURRENT_QUARTER", status: "TRADING" },
        { symbol: "ETHUSDT", pair: "ETHUSDT", contractType: "PERPETUAL", status: "SETTLING" },
      ],
    });
    expect(usdm).toEqual([
      { symbol: "BINANCE:BTCUSDT.P", base: "BTC", quote: "USDT", kind: "perp" },
      { symbol: "BINANCE:BTCUSDT_260327", base: "BTC", quote: "USDT", kind: "future", expiry: "2026-03-27" },
    ]);
    const coinm = parseBinanceFutures({
      symbols: [
        { symbol: "BTCUSD_PERP", pair: "BTCUSD", contractType: "PERPETUAL", contractStatus: "TRADING" },
        { symbol: "BTCUSD_260626", pair: "BTCUSD", contractType: "NEXT_QUARTER", contractStatus: "TRADING" },
      ],
    });
    expect(coinm.map((m) => [m.symbol, m.inverse])).toEqual([
      ["BINANCE:BTCUSD.P", true],
      ["BINANCE:BTCUSD_260626", true],
    ]);
  });

  it("reads Coinbase, Bitstamp and Bitfinex", () => {
    expect(symbols(parseCoinbase([{ id: "BTC-USD", base_currency: "BTC", quote_currency: "USD", status: "online", trading_disabled: false }, { id: "X-USD", base_currency: "X", quote_currency: "USD", status: "delisted" }]))).toEqual([
      "COINBASE:BTCUSD",
    ]);
    expect(symbols(parseBitstamp([{ name: "BTC/EUR", url_symbol: "btceur", trading: "Enabled" }]))).toEqual(["BITSTAMP:BTCEUR"]);
    expect(symbols(parseBitfinex([["BTCUSD", "ETHUST", "DOGE:USD", "TESTBTC:TESTUSD"]], false))).toEqual(["BITFINEX:BTCUSD", "BITFINEX:ETHUSDT", "BITFINEX:DOGEUSD"]);
    expect(symbols(parseBitfinex([["BTCF0:USTF0", "BTCF0:EUTF0"]], true))).toEqual(["BITFINEX:BTCUSDT.P"]);
  });

  it("reads Kraken spot (XBT as BTC) and futures", () => {
    expect(symbols(parseKrakenSpot({ error: [], result: { XXBTZUSD: { altname: "XBTUSD", wsname: "XBT/USD", status: "online" }, XETHZEUR: { wsname: "ETH/EUR" } } }))).toEqual([
      "KRAKEN:BTCUSD",
      "KRAKEN:ETHEUR",
    ]);
    const fut = parseKrakenFutures({
      instruments: [
        { symbol: "PF_XBTUSD", tradeable: true },
        { symbol: "PI_ETHUSD", tradeable: true },
        { symbol: "FF_XBTUSD_260327", tradeable: true },
        { symbol: "PF_OLDUSD", tradeable: false },
      ],
    });
    expect(fut.map((m) => [m.symbol, m.kind])).toEqual([
      ["KRAKEN:BTCUSD.P", "perp"],
      ["KRAKEN:PI_ETHUSD", "perp"],
      ["KRAKEN:FF_XBTUSD_260327", "future"],
    ]);
  });

  it("reads Bybit spot, linear and inverse", () => {
    expect(symbols(parseBybit({ result: { list: [{ symbol: "BTCUSDT", status: "Trading" }] } }, "spot"))).toEqual(["BYBIT:BTCUSDT"]);
    const linear = parseBybit(
      {
        result: {
          list: [
            { symbol: "BTCUSDT", contractType: "LinearPerpetual", baseCoin: "BTC", quoteCoin: "USDT", status: "Trading" },
            { symbol: "BTCPERP", contractType: "LinearPerpetual", baseCoin: "BTC", quoteCoin: "USDC", status: "Trading" },
            { symbol: "BTCUSDT-27MAR26", contractType: "LinearFutures", baseCoin: "BTC", quoteCoin: "USDT", status: "Trading", deliveryTime: "1774598400000" },
          ],
        },
      },
      "linear",
    );
    expect(linear.map((m) => [m.symbol, m.kind, m.expiry])).toEqual([
      ["BYBIT:BTCUSDT.P", "perp", undefined],
      ["BYBIT:BTCUSDC.P", "perp", undefined],
      ["BYBIT:BTCUSDT-27MAR26", "future", "2026-03-27"],
    ]);
    const inverse = parseBybit(
      {
        result: {
          list: [
            { symbol: "BTCUSD", contractType: "InversePerpetual", baseCoin: "BTC", quoteCoin: "USD", status: "Trading" },
            { symbol: "BTCUSDH26", contractType: "InverseFutures", baseCoin: "BTC", quoteCoin: "USD", status: "Trading" },
          ],
        },
      },
      "inverse",
    );
    expect(inverse.map((m) => [m.symbol, m.inverse])).toEqual([
      ["BYBIT:BTCUSD.P", true],
      ["BYBIT:BTCUSDH26", true],
    ]);
  });

  it("reads OKX spot, swaps and futures", () => {
    expect(symbols(parseOkx({ data: [{ instId: "BTC-USDT", state: "live" }] }, "SPOT"))).toEqual(["OKX:BTCUSDT"]);
    expect(symbols(parseOkx({ data: [{ instId: "BTC-USD-SWAP", state: "live" }] }, "SWAP"))).toEqual(["OKX:BTCUSD.P"]);
    expect(parseOkx({ data: [{ instId: "BTC-USDT-260327", state: "live", expTime: "1774598400000" }] }, "FUTURES")).toEqual([
      { symbol: "OKX:BTC-USDT-260327", base: "BTC", quote: "USDT", kind: "future", expiry: "2026-03-27" },
    ]);
  });

  it("every listed market loads through shared/venues.ts", () => {
    const all = [
      ...parseBinanceFutures({ symbols: [{ symbol: "ETHUSD_PERP", pair: "ETHUSD", contractType: "PERPETUAL", contractStatus: "TRADING" }] }),
      ...parseOkx({ data: [{ instId: "SOL-USDC-SWAP", state: "live" }] }, "SWAP"),
      ...parseKrakenFutures({ instruments: [{ symbol: "PF_SOLUSD", tradeable: true }] }),
    ];
    for (const m of all) expect(parseVenueSymbol(m.symbol)?.kind).toBe(m.kind);
  });

  it("keeps the lists that loaded when one fails", async () => {
    const got = await loadVenueMarkets("KRAKEN", async (url) => {
      if (url.includes("futures")) throw new Error("blocked");
      return { result: { XXBTZUSD: { wsname: "XBT/USD" } } };
    });
    expect(symbols(got.markets)).toEqual(["KRAKEN:BTCUSD"]);
    expect(got.failed).toHaveLength(1);
  });
});

describe("market search", () => {
  const markets = [
    ...parseBinanceSpot([{ symbol: "BTCUSDT" }, { symbol: "BTCEUR" }, { symbol: "ETHBTC" }, { symbol: "WBTCUSDT" }]),
    ...parseBinanceFutures({
      symbols: [
        { symbol: "BTCUSDT_260626", pair: "BTCUSDT", contractType: "NEXT_QUARTER", status: "TRADING" },
        { symbol: "BTCUSDT_260327", pair: "BTCUSDT", contractType: "CURRENT_QUARTER", status: "TRADING" },
        { symbol: "BTCUSDT", pair: "BTCUSDT", contractType: "PERPETUAL", status: "TRADING" },
      ],
    }),
  ];

  it("lists spot, then perpetuals, then futures by expiry", () => {
    expect(symbols(searchMarkets(markets, "btc"))).toEqual(["BTCUSDT", "BTCEUR", "BINANCE:BTCUSDT.P", "BINANCE:BTCUSDT_260327", "BINANCE:BTCUSDT_260626"]);
  });

  it("narrows to a form by word", () => {
    expect(symbols(searchMarkets(markets, "btc perp"))).toEqual(["BINANCE:BTCUSDT.P"]);
    expect(symbols(searchMarkets(markets, "BTC futures"))).toEqual(["BINANCE:BTCUSDT_260327", "BINANCE:BTCUSDT_260626"]);
    expect(symbols(searchMarkets(markets, "eth spot"))).toEqual(["ETHBTC"]);
    expect(symbols(searchMarkets(markets, "BINANCE:BTCUSDT.P"))).toEqual(["BINANCE:BTCUSDT.P"]);
  });

  it("names markets in words", () => {
    expect(marketLabel({ symbol: "BINANCE:BTCUSD_260327", base: "BTC", quote: "USD", kind: "future", expiry: "2026-03-27", inverse: true })).toBe("BTC / USD · Futures 27.03.2026 (Coin-margined)");
  });
});

describe("more exchanges and options", () => {
  it("reads Bitget, KuCoin, Deribit and BitMEX lists", () => {
    expect(symbols(parseBitgetSpot({ data: [{ symbol: "BTCUSDT", baseCoin: "BTC", quoteCoin: "USDT", status: "online" }] }))).toEqual(["BITGET:BTCUSDT"]);
    expect(symbols(parseBitgetContracts({ data: [{ symbol: "BTCUSDT", baseCoin: "BTC", symbolType: "perpetual", symbolStatus: "normal" }] }, "USDT-FUTURES"))).toEqual(["BITGET:BTCUSDT.P"]);
    expect(symbols(parseBitgetContracts({ data: [{ symbol: "BTCPERP", baseCoin: "BTC", symbolType: "perpetual" }] }, "USDC-FUTURES"))).toEqual(["BITGET:BTCUSDC.P"]);
    expect(symbols(parseKucoinSpot({ data: [{ baseCurrency: "BTC", quoteCurrency: "USDT", enableTrading: true }] }))).toEqual(["KUCOIN:BTCUSDT"]);
    expect(
      symbols(
        parseKucoinFutures({
          data: [
            { symbol: "XBTUSDTM", baseCurrency: "XBT", quoteCurrency: "USDT", expireDate: null, status: "Open" },
            { symbol: "XBTUSDM", baseCurrency: "XBT", quoteCurrency: "USD", expireDate: null, status: "Open" },
            { symbol: "XBTMZ26", baseCurrency: "XBT", quoteCurrency: "USD", expireDate: 1798185600000, status: "Open" },
          ],
        }),
      ),
    ).toEqual(["KUCOIN:BTCUSDT.P", "KUCOIN:BTCUSD.P", "KUCOIN:XBTMZ26"]);
    const deribit = parseDeribit({
      result: [
        { instrument_name: "BTC-PERPETUAL", kind: "future", is_active: true },
        { instrument_name: "ETH_USDC-PERPETUAL", kind: "future", is_active: true },
        { instrument_name: "BTC-27MAR26", kind: "future", is_active: true, expiration_timestamp: 1774598400000 },
        { instrument_name: "BTC-27MAR26-100000-C", kind: "option", is_active: true, expiration_timestamp: 1774598400000, strike: 100000, option_type: "call" },
        { instrument_name: "BTC_USDC", kind: "spot", is_active: true },
      ],
    });
    expect(deribit.map((m) => [m.symbol, m.kind])).toEqual([
      ["DERIBIT:BTCUSD.P", "perp"],
      ["DERIBIT:ETHUSDC.P", "perp"],
      ["DERIBIT:BTC-27MAR26", "future"],
      ["DERIBIT:BTC-27MAR26-100000-C", "option"],
      ["DERIBIT:BTCUSDC", "spot"],
    ]);
    expect(deribit[3]).toMatchObject({ strike: 100000, right: "C", expiry: "2026-03-27" });
    const bitmex = parseBitmex([
      { symbol: "XBTUSD", typ: "FFWCSX", underlying: "XBT", quoteCurrency: "USD", state: "Open" },
      { symbol: "XBTZ26", typ: "FFCCSX", underlying: "XBT", quoteCurrency: "USD", state: "Open", expiry: "2026-12-25T12:00:00.000Z" },
      { symbol: "XBT_USDT", typ: "IFXXXP", underlying: "XBT", quoteCurrency: "USDT", state: "Open" },
      { symbol: ".BXBT", typ: "MRCXXX", state: "Unlisted" },
    ]);
    expect(symbols(bitmex)).toEqual(["BITMEX:BTCUSD.P", "BITMEX:XBTZ26", "BITMEX:XBT_USDT"]);
  });

  it("reads Binance and OKX options", () => {
    expect(parseBinanceOptions({ optionSymbols: [{ symbol: "BTC-260327-100000-C", strikePrice: "100000", side: "CALL", expiryDate: 1774598400000 }] })).toEqual([
      { symbol: "BINANCE:BTC-260327-100000-C", base: "BTC", quote: "USDT", kind: "option", expiry: "2026-03-27", strike: 100000, right: "C" },
    ]);
    expect(parseOkxOptions({ data: [{ instId: "BTC-USD-260327-100000-P", state: "live", stk: "100000", optType: "P", expTime: "1774598400000" }] })[0]).toMatchObject({
      symbol: "OKX:BTC-USD-260327-100000-P",
      kind: "option",
      right: "P",
      inverse: true,
    });
  });

  it("shows options only when asked for", () => {
    const markets = parseDeribit({
      result: [
        { instrument_name: "BTC-PERPETUAL", kind: "future" },
        { instrument_name: "BTC-27MAR26-100000-C", kind: "option", expiration_timestamp: 1774598400000, strike: 100000, option_type: "call" },
        { instrument_name: "BTC-27MAR26-100000-P", kind: "option", expiration_timestamp: 1774598400000, strike: 100000, option_type: "put" },
        { instrument_name: "BTC-27MAR26-90000-C", kind: "option", expiration_timestamp: 1774598400000, strike: 90000, option_type: "call" },
      ],
    });
    expect(symbols(searchMarkets(markets, "btc"))).toEqual(["DERIBIT:BTCUSD.P"]);
    expect(symbols(searchMarkets(markets, "btc call 100000"))).toEqual(["DERIBIT:BTC-27MAR26-100000-C"]);
    expect(symbols(searchMarkets(markets, "btc call"))).toEqual(["DERIBIT:BTC-27MAR26-90000-C", "DERIBIT:BTC-27MAR26-100000-C"]);
    expect(symbols(searchMarkets(markets, "BTC-27MAR26-100000-P"))).toEqual(["DERIBIT:BTC-27MAR26-100000-P"]);
    expect(marketLabel(markets[1])).toBe("BTC / USD · Call 100.000 27.03.2026 (Coin-margined)");
  });
});
