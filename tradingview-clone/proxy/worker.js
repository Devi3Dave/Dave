/**
 * ChartAI-Proxy: a Cloudflare Worker that relays public market data of exchanges which refuse requests
 * from the browser (no CORS headers): KuCoin, BitMEX, Kraken Futures, Binance options, and the market lists
 * of Bitfinex and Bitstamp. Copy this file into the Cloudflare dashboard as it is (proxy/README.md).
 *
 *   GET https://<worker>/api.kucoin.com/api/v1/market/candles?…  →  GET https://api.kucoin.com/api/v1/market/candles?…
 *   WebSocket wss://<worker>/ws.bitmex.com/realtime              →  wss://ws.bitmex.com/realtime
 *   GET https://<worker>/health                                  →  {"ok":true,"service":"chartai-proxy","allowed":true,"sync":true}
 *   GET/POST https://<worker>/sync (Authorization: Bearer <SYNC_KEY>) →  charts, drawings and settings shared by Mac and iPad
 *
 * Safety: the relay only GETs (plus the browser's OPTIONS preflight), only the exchange hosts below, only requests from the
 * ChartAI page (Origin), no cookies and no exchange keys, at most RATE_LIMIT requests per minute and address.
 * Answers are cached for CACHE_SECONDS, so many charts asking for the same candles cost one exchange call.
 * Sync (optional): needs a KV namespace bound as CHARTAI_SYNC and a secret SYNC_KEY (proxy/README.md). The whole ChartAI state is one
 * KV value {rev, items: {"chartai.…": {v, t}}}; a POST merges key by key, the newer t wins. Without the key nothing is read or written.
 * Cloudflare's own docs: developers.cloudflare.com/workers (fetch handler, WebSockets, cf.cacheTtl), developers.cloudflare.com/kv (get, put).
 */

// Pages allowed to use the relay. Add "http://localhost:5173" here to use it while developing.
const ALLOWED_ORIGINS = ["https://devi3dave.github.io"];

// Must match PROXY_HOSTS and PROXY_WS_HOSTS in shared/proxy.ts.
const HOSTS = ["api.kucoin.com", "api-futures.kucoin.com", "www.bitmex.com", "futures.kraken.com", "eapi.binance.com", "api-pub.bitfinex.com", "www.bitstamp.net"];
const WS_HOSTS = ["ws.bitmex.com"];

const CACHE_SECONDS = 10;
const RATE_LIMIT = 300;
// The sync document; KV allows 25 MiB per value, ChartAI's state is far smaller.
const SYNC_DOC = "chartai-sync-v1";
const SYNC_MAX_BYTES = 10_000_000;

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

const WELCOME = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChartAI-Proxy</title>
<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;line-height:1.5">
<h1>✓ ChartAI-Proxy läuft</h1>
<p>Diese Adresse ist richtig eingerichtet. Kopiere sie aus der Adresszeile und trage sie in ChartAI ein: Asset-Auswahl → 🩺 Test → „Eigener Proxy für gesperrte Börsen“ → Speichern.</p>
<p>Kurse gibt der Proxy nur an die ChartAI-Seite heraus, darum zeigt ein direkter Aufruf anderer Adressen hier „origin not allowed“ (403). Das ist gewollt.</p>`;

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function reply(status, body, origin) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...(origin ? cors(origin) : {}) } });
}

/** Compares without stopping at the first different character, so the answer time says nothing about the key. */
function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function validItem(key, item) {
  return (
    typeof key === "string" && key.startsWith("chartai.") && key.length <= 200 &&
    item !== null && typeof item === "object" && (typeof item.v === "string" || item.v === null) &&
    typeof item.t === "number" && Number.isFinite(item.t) && item.t >= 0
  );
}

/** GET returns the stored state ({same:true} when ?rev= is already the newest), POST merges {items} into it. */
async function handleSync(request, env, url, origin) {
  const kv = env && env.CHARTAI_SYNC;
  const secret = env && env.SYNC_KEY;
  if (!kv || typeof secret !== "string" || secret.length < 16) {
    return reply(501, { error: "sync not set up", missing: [!kv && "CHARTAI_SYNC", !(typeof secret === "string" && secret.length >= 16) && "SYNC_KEY"].filter(Boolean) }, origin);
  }
  const auth = request.headers.get("Authorization") ?? "";
  if (!sameKey(auth.replace(/^Bearer /, ""), secret)) return reply(401, { error: "wrong sync key" }, origin);

  const stored = await kv.get(SYNC_DOC);
  const doc = stored ? JSON.parse(stored) : { rev: 0, items: {} };
  if (request.method === "GET") {
    if (url.searchParams.get("rev") === String(doc.rev)) return reply(200, { rev: doc.rev, same: true }, origin);
    return reply(200, doc, origin);
  }
  if (request.method !== "POST") return reply(405, { error: "only GET and POST" }, origin);
  const text = await request.text();
  if (text.length > SYNC_MAX_BYTES) return reply(413, { error: "too large" }, origin);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: "not JSON" }, origin);
  }
  if (!body || typeof body.items !== "object" || body.items === null) return reply(400, { error: "items missing" }, origin);
  let changed = false;
  for (const [key, item] of Object.entries(body.items)) {
    if (!validItem(key, item)) continue;
    const cur = doc.items[key];
    if (!cur || item.t > cur.t) {
      doc.items[key] = { v: item.v, t: item.t };
      changed = true;
    }
  }
  if (changed) {
    doc.rev = Math.max(Date.now(), doc.rev + 1);
    try {
      await kv.put(SYNC_DOC, JSON.stringify(doc));
    } catch (e) {
      // The free plan allows 1000 writes a day.
      return reply(503, { error: `not saved: ${e && e.message ? e.message : e}` }, origin);
    }
  }
  return reply(200, doc, origin);
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
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = origin !== null && ALLOWED_ORIGINS.includes(origin);
    // Opened in a browser tab (no Origin header): a short page instead of an error.
    if (url.pathname === "/" && request.method === "GET" && origin === null) return new Response(WELCOME, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    // Says only whether the relay runs and accepts the asking page, so any page may read it.
    if (url.pathname === "/health" && request.method === "GET") return reply(200, { ok: true, service: "chartai-proxy", allowed, sync: Boolean(env && env.CHARTAI_SYNC && env.SYNC_KEY) }, "*");
    if (!allowed) return reply(403, { error: "origin not allowed", service: "chartai-proxy" }, null);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (limited(request.headers.get("CF-Connecting-IP") ?? "unknown")) return reply(429, { error: "too many requests" }, origin);
    if (url.pathname === "/sync") return handleSync(request, env, url, origin);
    if (request.method !== "GET") return reply(405, { error: "only GET" }, origin);

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
