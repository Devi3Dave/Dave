/**
 * ChartAI-Proxy: a Cloudflare Worker that relays public market data of exchanges which refuse requests
 * from the browser (no CORS headers): KuCoin, BitMEX, Kraken Futures, Binance options, and the market lists
 * of Bitfinex and Bitstamp. Copy this file into the Cloudflare dashboard as it is (proxy/README.md).
 *
 *   GET https://<worker>/api.kucoin.com/api/v1/market/candles?…  →  GET https://api.kucoin.com/api/v1/market/candles?…
 *   WebSocket wss://<worker>/ws.bitmex.com/realtime              →  wss://ws.bitmex.com/realtime
 *   GET https://<worker>/health                                  →  {"ok":true,"service":"chartai-proxy","allowed":true}
 *
 * Safety: only GET (and the browser's OPTIONS preflight), only the exchange hosts below, only requests from the
 * ChartAI page (Origin), no cookies, keys or secrets, at most RATE_LIMIT requests per minute and address.
 * Answers are cached for CACHE_SECONDS, so many charts asking for the same candles cost one exchange call.
 * Cloudflare's own docs: developers.cloudflare.com/workers (fetch handler, WebSockets, cf.cacheTtl).
 */

// Pages allowed to use the relay. Add "http://localhost:5173" here to use it while developing.
const ALLOWED_ORIGINS = ["https://devi3dave.github.io"];

// Must match PROXY_HOSTS and PROXY_WS_HOSTS in shared/proxy.ts.
const HOSTS = ["api.kucoin.com", "api-futures.kucoin.com", "www.bitmex.com", "futures.kraken.com", "eapi.binance.com", "api-pub.bitfinex.com", "www.bitstamp.net"];
const WS_HOSTS = ["ws.bitmex.com"];

const CACHE_SECONDS = 10;
const RATE_LIMIT = 300;

// Per Worker instance: enough to stop a runaway loop or a stranger, not a global counter.
const hits = new Map();

function limited(ip, now = Date.now()) {
  const minute = Math.floor(now / 60_000);
  const h = hits.get(ip);
  if (!h || h.minute !== minute) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { minute, count: 1 });
    return false;
  }
  h.count += 1;
  return h.count > RATE_LIMIT;
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function reply(status, body, origin) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...(origin ? cors(origin) : {}) } });
}

/** Passes a WebSocket through: the browser talks to the Worker, the Worker to the exchange. */
async function relaySocket(target) {
  const upstream = await fetch(target, { headers: { Upgrade: "websocket" } });
  const exchange = upstream.webSocket;
  if (!exchange) return new Response("exchange refused the WebSocket", { status: 502 });
  exchange.accept();
  const [client, inside] = Object.values(new WebSocketPair());
  inside.accept();
  const closeBoth = (code, reason) => {
    for (const s of [inside, exchange]) {
      try {
        s.close(code === 1005 || code === 1006 ? 1000 : code, reason);
      } catch {
        // already closed
      }
    }
  };
  inside.addEventListener("message", (e) => exchange.send(e.data));
  exchange.addEventListener("message", (e) => inside.send(e.data));
  inside.addEventListener("close", (e) => closeBoth(e.code, e.reason));
  exchange.addEventListener("close", (e) => closeBoth(e.code, e.reason));
  inside.addEventListener("error", () => closeBoth(1011, "error"));
  exchange.addEventListener("error", () => closeBoth(1011, "error"));
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = origin !== null && ALLOWED_ORIGINS.includes(origin);
    // Says only whether the relay runs and accepts the asking page, so any page may read it.
    if (url.pathname === "/health" && request.method === "GET") return reply(200, { ok: true, service: "chartai-proxy", allowed }, "*");
    if (!allowed) return reply(403, { error: "origin not allowed", service: "chartai-proxy" }, null);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== "GET") return reply(405, { error: "only GET" }, origin);
    if (limited(request.headers.get("CF-Connecting-IP") ?? "unknown")) return reply(429, { error: "too many requests" }, origin);

    const slash = url.pathname.indexOf("/", 1);
    const host = slash > 0 ? url.pathname.slice(1, slash) : url.pathname.slice(1);
    const path = slash > 0 ? url.pathname.slice(slash) : "/";
    const target = `https://${host}${path}${url.search}`;

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      if (!WS_HOSTS.includes(host)) return reply(403, { error: "host not allowed" }, origin);
      return relaySocket(target);
    }
    if (!HOSTS.includes(host)) return reply(403, { error: "host not allowed" }, origin);

    let upstream;
    try {
      upstream = await fetch(target, {
        headers: { Accept: "application/json", "User-Agent": "chartai-proxy" },
        redirect: "manual",
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
      });
    } catch (e) {
      return reply(502, { error: `exchange not reachable: ${e && e.message ? e.message : e}` }, origin);
    }
    const headers = new Headers(cors(origin));
    headers.set("Content-Type", upstream.headers.get("Content-Type") ?? "application/json");
    headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
    // Redirects are not followed: the answer must come from the allowed host itself.
    if (upstream.status >= 300 && upstream.status < 400) return reply(502, { error: `exchange redirected (${upstream.status})` }, origin);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
