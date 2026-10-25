import { describe, expect, it } from "vitest";
import { ASSETS, categoryOfFutures, findAsset, parseFuturesInfo, parseSpotTickers, resolveAsset, searchAssets } from "../shared/assets";
import { isCryptoSymbol } from "../shared/marketData";

const gold = ASSETS.find((a) => a.id === "GC=F")!;
const sap = ASSETS.find((a) => a.id === "SAP.DE")!;
const btc = ASSETS.find((a) => a.id === "BTCUSDT")!;

describe("asset catalog", () => {
  it("covers every category with unique ids", () => {
    const ids = ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of ["Krypto", "Aktien", "Indizes & ETFs", "Edelmetalle", "Rohstoffe", "Forex"]) expect(ASSETS.some((a) => a.category === c)).toBe(true);
  });

  it("perpetuals are crypto-style symbols so Binance is tried first", () => {
    for (const a of ASSETS) if (a.perp) expect(isCryptoSymbol(a.perp)).toBe(true);
  });

  it("finds an asset by id or perpetual", () => {
    expect(findAsset("XAUUSDT")?.name).toBe("Gold");
    expect(findAsset("GC=F")?.name).toBe("Gold");
    expect(findAsset("FOO")).toBeUndefined();
  });
});

describe("resolveAsset", () => {
  it("uses Yahoo with the server and the perpetual on the iPad", () => {
    expect(resolveAsset(gold, false, null)).toEqual({ symbol: "GC=F", source: "yahoo" });
    expect(resolveAsset(gold, true, new Set(["XAUUSDT"]))).toEqual({ symbol: "XAUUSDT", source: "binance_futures" });
    expect(resolveAsset(gold, true, null).symbol).toBe("XAUUSDT");
  });

  it("falls back to demo when no perpetual is listed", () => {
    expect(resolveAsset(gold, true, new Set())).toEqual({ symbol: "GC=F", source: "demo" });
    expect(resolveAsset(sap, true, null).source).toBe("demo");
  });

  it("keeps crypto on Binance spot", () => {
    expect(resolveAsset(btc, true, null)).toEqual({ symbol: "BTCUSDT", source: "binance" });
  });
});

describe("Binance lists", () => {
  const info = {
    symbols: [
      { symbol: "BTCUSDT", baseAsset: "BTC", status: "TRADING", contractType: "PERPETUAL", underlyingType: "COIN", underlyingSubType: ["PoW"] },
      { symbol: "XAUUSDT", baseAsset: "XAU", status: "TRADING", contractType: "TRADIFI_PERPETUAL", underlyingType: "COMMODITY", underlyingSubType: ["Metal"] },
      { symbol: "RKLBUSDT", baseAsset: "RKLB", status: "TRADING", contractType: "TRADIFI_PERPETUAL", underlyingType: "EQUITY", underlyingSubType: [] },
      { symbol: "OLDUSDT", baseAsset: "OLD", status: "SETTLING", contractType: "PERPETUAL", underlyingType: "COIN" },
      { symbol: "BTCUSDT_261225", baseAsset: "BTC", status: "TRADING", contractType: "CURRENT_QUARTER", underlyingType: "COIN" },
    ],
  };

  it("keeps trading perpetuals and marks TradFi contracts", () => {
    const f = parseFuturesInfo(info);
    expect(f.map((x) => x.symbol)).toEqual(["BTCUSDT", "XAUUSDT", "RKLBUSDT"]);
    expect(f.map((x) => x.tradfi)).toEqual([false, true, true]);
    expect(categoryOfFutures(f[1])).toBe("Edelmetalle");
    expect(categoryOfFutures(f[2])).toBe("Aktien");
  });

  it("drops leveraged spot tokens", () => {
    expect(parseSpotTickers([{ symbol: "ETHUSDT" }, { symbol: "BTCUPUSDT" }, { symbol: "ETHBTC" }, { symbol: "AEVOUSDT" }])).toEqual(["AEVOUSDT", "ETHUSDT"]);
  });

  it("searches names and symbols, catalog first, then extra pairs", () => {
    const f = parseFuturesInfo(info);
    expect(searchAssets("gold", [], f)[0].symbol).toBe("GC=F");
    expect(searchAssets("tesla", [], f)[0].symbol).toBe("TSLA");
    const rklb = searchAssets("rklb", ["RKLBUSDT"], f);
    expect(rklb).toHaveLength(1);
    expect(rklb[0].category).toBe("Aktien");
    expect(searchAssets("aevo", ["AEVOUSDT"], f)[0]).toMatchObject({ symbol: "AEVOUSDT", category: "Krypto" });
    // The gold perpetual is part of the catalog entry, not listed twice.
    expect(searchAssets("xau", [], f).map((h) => h.symbol)).toEqual(["GC=F"]);
  });
});
