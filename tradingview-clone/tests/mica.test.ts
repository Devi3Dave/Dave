import { describe, expect, it } from "vitest";
import { allowedVenues, availabilityIn, EEA_COUNTRIES, EU_QUOTES, euMarket, isEea, MICA, MICA_AS_OF } from "../shared/mica";
import { parseKrakenSpot, searchMarkets, type Market } from "../shared/venueMarkets";
import { VENUES } from "../shared/venues";

const spot = (symbol: string, base: string, quote: string): Market => ({ symbol, base, quote, kind: "spot" });

describe("MiCA status", () => {
  it("has an entry with sources for every exchange", () => {
    expect(/^\d{4}-\d{2}-\d{2}$/.test(MICA_AS_OF)).toBe(true);
    for (const v of VENUES) {
      const info = MICA[v.id];
      expect(info, v.id).toBeDefined();
      expect(info.sources.length, v.id).toBeGreaterThan(0);
      for (const s of info.sources) expect(s.url.startsWith("https://"), s.url).toBe(true);
      if (info.status === "licensed") {
        expect(info.entity && info.authority && info.since, v.id).toBeTruthy();
        expect(isEea(info.country), v.id).toBe(true);
      }
    }
  });

  it("knows the 30 EEA states", () => {
    expect(Object.keys(EEA_COUNTRIES)).toHaveLength(30);
    expect(isEea("DE") && isEea("NO") && !isEea("CH") && !isEea(null)).toBe(true);
  });

  it("tells what a resident may use", () => {
    expect(availabilityIn("DE", "KRAKEN")).toMatchObject({ spot: "yes", derivatives: "yes" });
    expect(availabilityIn("DE", "BYBIT")).toMatchObject({ spot: "yes", derivatives: "no" });
    expect(availabilityIn("FR", "BINANCE").spot).toBe("no");
    expect(availabilityIn("AT", "BITGET").spot).toBe("pending");
    expect(availabilityIn("AT", "KUCOIN").spot).toBe("unclear");
    expect(availabilityIn("CH", "BINANCE")).toMatchObject({ spot: "local", derivatives: "local" });
    expect(availabilityIn(null, "BINANCE").spot).toBe("local");
  });

  it("filters the exchanges allowed in a country", () => {
    const ids = VENUES.map((v) => v.id);
    expect(allowedVenues("DE", ids)).toEqual(["COINBASE", "KRAKEN", "BYBIT", "OKX", "BITSTAMP"]);
    expect(allowedVenues("CH", ids)).toEqual(ids);
  });
});

describe("EU mode", () => {
  it("prefers EUR, then USDC, over USDT", () => {
    const markets = [spot("KRAKEN:BTCUSDT", "BTC", "USDT"), spot("KRAKEN:BTCUSDC", "BTC", "USDC"), spot("KRAKEN:BTCEUR", "BTC", "EUR"), spot("KRAKEN:SOLUSDC", "SOL", "USDC"), spot("KRAKEN:PEPEUSDT", "PEPE", "USDT")];
    expect(euMarket(markets, "BTC")?.symbol).toBe("KRAKEN:BTCEUR");
    expect(euMarket(markets, "SOL")?.symbol).toBe("KRAKEN:SOLUSDC");
    expect(euMarket(markets, "PEPE")).toBeNull();
  });

  it("finds Kraken's EUR pair from its pair list (XBT → BTC)", () => {
    const markets = parseKrakenSpot({ result: { XXBTZEUR: { altname: "XBTEUR", wsname: "XBT/EUR", base: "XXBT", quote: "ZEUR", status: "online" } } });
    expect(euMarket(markets, "BTC")?.quote).toBe("EUR");
  });

  it("sorts EUR and USDC pairs first in the search", () => {
    const markets = [spot("BTCUSDT", "BTC", "USDT"), spot("BTCEUR", "BTC", "EUR"), spot("BTCUSDC", "BTC", "USDC")];
    expect(searchMarkets(markets, "btc").map((m) => m.symbol)).toEqual(["BTCUSDT", "BTCUSDC", "BTCEUR"]);
    expect(searchMarkets(markets, "btc", EU_QUOTES).map((m) => m.symbol)).toEqual(["BTCEUR", "BTCUSDC", "BTCUSDT"]);
  });
});
