import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../proxy/worker.js";
import { loadMarketData } from "../shared/marketData";
import { checkProxy, fetchVia, normalizeProxyUrl, PROXY_HOSTS, PROXY_WS_HOSTS, proxiedUrl, setProxyBase, wsVia } from "../shared/proxy";
import { isBlockedSymbol, pickerPerps, pickerVenues } from "../shared/venues";

const RELAY = "https://chartai-proxy.devi.workers.dev";
const PAGE = "https://devi3dave.github.io";

afterEach(() => {
  setProxyBase("");
  vi.unstubAllGlobals();
});

describe("relay address", () => {
  it("accepts https addresses only", () => {
    expect(normalizeProxyUrl("https://chartai-proxy.devi.workers.dev/")).toBe(RELAY);
    expect(normalizeProxyUrl("chartai-proxy.devi.workers.dev")).toBe(RELAY);
    expect(normalizeProxyUrl("http://chartai-proxy.devi.workers.dev")).toBeNull();
    expect(normalizeProxyUrl("https://x.dev/?u=1")).toBeNull();
    expect(normalizeProxyUrl("")).toBeNull();
  });

  it("rewrites only the hosts the relay serves", () => {
    expect(proxiedUrl("https://api.kucoin.com/api/v1/market/candles?type=1hour")).toBeNull();
    setProxyBase(RELAY);
    expect(proxiedUrl("https://api.kucoin.com/api/v1/market/candles?type=1hour")).toBe(`${RELAY}/api.kucoin.com/api/v1/market/candles?type=1hour`);
    expect(proxiedUrl("https://api.binance.com/api/v3/klines")).toBeNull();
    expect(wsVia("wss://ws.bitmex.com/realtime")).toBe("wss://chartai-proxy.devi.workers.dev/ws.bitmex.com/realtime");
    expect(wsVia("wss://ws.kraken.com/v2")).toBe("wss://ws.kraken.com/v2");
  });

  it("lists the same hosts as the Worker", () => {
    const src = readFileSync(new URL("../proxy/worker.js", import.meta.url), "utf8");
    const list = (name: string) => JSON.parse(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`).exec(src)![1]) as string[];
    expect(list("HOSTS")).toEqual(Object.keys(PROXY_HOSTS));
    expect(list("WS_HOSTS")).toEqual(PROXY_WS_HOSTS);
  });
});

describe("loading through the relay", () => {
  it("sends always-blocked hosts straight to the relay and others only after a failed direct call", async () => {
    setProxyBase(RELAY);
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (url.startsWith("https://api-pub.bitfinex.com")) throw new TypeError("Load failed");
      return new Response("[]");
    });
    await fetchVia("https://www.bitmex.com/api/v1/instrument/active");
    await fetchVia("https://api-pub.bitfinex.com/v2/conf/pub:list:pair:exchange");
    await fetchVia("https://api.bybit.com/v5/market/kline");
    expect(urls).toEqual([
      `${RELAY}/www.bitmex.com/api/v1/instrument/active`,
      "https://api-pub.bitfinex.com/v2/conf/pub:list:pair:exchange",
      `${RELAY}/api-pub.bitfinex.com/v2/conf/pub:list:pair:exchange`,
      "https://api.bybit.com/v5/market/kline",
    ]);
  });

  it("loads KuCoin candles over the relay", async () => {
    setProxyBase(RELAY);
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ code: "200000", data: [["1761649200", "1", "2", "3", "0.5", "10", "0"]] }));
    });
    const data = await loadMarketData("KUCOIN:BTCUSDT", "1h", 1);
    expect(urls[0].startsWith(`${RELAY}/api.kucoin.com/api/v1/market/candles?`)).toBe(true);
    expect(data.bars.at(-1)?.close).toBe(2);
  });

  it("offers every exchange in the picker once a relay is set", () => {
    expect(pickerVenues().some((v) => v.id === "KUCOIN")).toBe(false);
    expect(isBlockedSymbol("KRAKEN:BTCUSD.P")).toBe(true);
    setProxyBase(RELAY);
    expect(pickerVenues().map((v) => v.id)).toEqual(["BINANCE", "COINBASE", "KRAKEN", "BYBIT", "OKX", "BITSTAMP", "BITFINEX", "BITGET", "KUCOIN", "DERIBIT", "BITMEX"]);
    expect(pickerPerps("KRAKEN")).toBe(true);
    expect(isBlockedSymbol("KRAKEN:BTCUSD.P")).toBe(false);
    expect(isBlockedSymbol("BINANCE:BTC-260327-100000-C")).toBe(false);
  });

  it("tells whether the relay runs and accepts the page", async () => {
    const answer = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
    expect(await checkProxy(RELAY, answer({ ok: true, service: "chartai-proxy", allowed: true }))).toMatchObject({ ok: true });
    expect((await checkProxy(RELAY, answer({ ok: true, service: "chartai-proxy", allowed: false }))).detail).toContain("ALLOWED_ORIGINS");
    expect((await checkProxy("http://x.dev")).ok).toBe(false);
  });
});

describe("Cloudflare Worker", () => {
  const ask = (path: string, init: { method?: string; origin?: string | null; ip?: string } = {}) => {
    const headers = new Headers();
    if (init.origin !== null) headers.set("Origin", init.origin ?? PAGE);
    headers.set("CF-Connecting-IP", init.ip ?? "1.2.3.4");
    return worker.fetch(new Request(`${RELAY}${path}`, { method: init.method ?? "GET", headers }));
  };

  it("relays GET requests of the page to allowed exchange hosts, with CORS and a short cache", async () => {
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response('{"code":"200000"}', { headers: { "Content-Type": "application/json" } });
    });
    const res = await ask("/api.kucoin.com/api/v1/market/candles?type=1hour&symbol=BTC-USDT");
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PAGE);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=10");
    expect(await res.text()).toBe('{"code":"200000"}');
    expect(calls[0][0]).toBe("https://api.kucoin.com/api/v1/market/candles?type=1hour&symbol=BTC-USDT");
    expect(calls[0][1].redirect).toBe("manual");
  });

  it("refuses other pages, other hosts and other methods", async () => {
    const upstream = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", upstream);
    expect((await ask("/api.kucoin.com/api/v1/x", { origin: "https://evil.example" })).status).toBe(403);
    expect((await ask("/api.kucoin.com/api/v1/x", { origin: null })).status).toBe(403);
    expect((await ask("/example.com/steal")).status).toBe(403);
    expect((await ask("/api.kucoin.com.evil.com/x")).status).toBe(403);
    expect((await ask("/api.kucoin.com/api/v1/x", { method: "POST" })).status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("shows a short page when the address is opened in a browser tab", async () => {
    const res = await ask("/", { origin: null });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ChartAI-Proxy läuft");
    expect((await ask("/api.kucoin.com/x", { origin: null })).status).toBe(403);
  });

  it("answers the browser's preflight and the health check", async () => {
    const pre = await ask("/api.kucoin.com/x", { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
    expect(await (await ask("/health")).json()).toEqual({ ok: true, service: "chartai-proxy", allowed: true, sync: false });
    expect(await (await ask("/health", { origin: "https://evil.example" })).json()).toEqual({ ok: true, service: "chartai-proxy", allowed: false, sync: false });
  });

  it("does not follow redirects away from the exchange", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 302, headers: { Location: "https://elsewhere.example" } }));
    expect((await ask("/www.bitmex.com/api/v1/instrument/active")).status).toBe(502);
  });

  it("limits requests per address and minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T16:00:05Z"));
    vi.stubGlobal("fetch", async () => new Response("{}"));
    let last = 0;
    for (let i = 0; i < 301; i++) last = (await ask("/www.bitmex.com/api/v1/x", { ip: "9.9.9.9" })).status;
    expect(last).toBe(429);
    expect((await ask("/www.bitmex.com/api/v1/x", { ip: "8.8.8.8" })).status).toBe(200);
    vi.useRealTimers();
  });
});
