/**
 * Optional own relay (proxy/worker.js, a Cloudflare Worker) for exchanges whose public data the browser
 * may not read (no CORS headers): https://<worker>/<host>/<path> fetches https://<host>/<path> and answers
 * with CORS headers. Only public market data passes: GET requests to the hosts below, no keys or logins.
 * Without a proxy URL everything loads straight from the exchanges as before.
 *
 * The lists must match HOSTS and WS_HOSTS in proxy/worker.js (a test compares them).
 */

/**
 * REST hosts the relay serves. "always": blocked in the browser (Devi's connection test, 2026-10-28), so they go
 * through the relay right away. "fallback": loads directly most of the time, the relay only when the direct call fails
 * (Bitfinex and Bitstamp market lists).
 */
export const PROXY_HOSTS: Record<string, "always" | "fallback"> = {
  "api.kucoin.com": "always",
  "api-futures.kucoin.com": "always",
  "www.bitmex.com": "always",
  "futures.kraken.com": "always",
  "eapi.binance.com": "always",
  "api-pub.bitfinex.com": "fallback",
  "www.bitstamp.net": "fallback",
};

/** WebSocket hosts the relay passes through: BitMEX's stream failed in the same test (WebSockets are not bound to CORS, BitMEX refused anyway). */
export const PROXY_WS_HOSTS = ["ws.bitmex.com"];

let base: string | null = null;

/** "https://chartai-proxy.name.workers.dev/" → "https://chartai-proxy.name.workers.dev"; null for anything but an https address. */
export function normalizeProxyUrl(url: string): string | null {
  const text = url.trim();
  if (!text) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
    if (u.protocol !== "https:" || u.search || u.hash) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** Sets the relay (empty or invalid: none). */
export function setProxyBase(url: string): void {
  base = normalizeProxyUrl(url);
}

export function proxyBase(): string | null {
  return base;
}

/** A relay is set: the exchanges blocked in the browser load through it. */
export function proxyActive(): boolean {
  return base !== null;
}

/** The relay address for an exchange URL, or null when no relay is set or the host is not one it serves. */
export function proxiedUrl(url: string): string | null {
  if (!base) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol === "https:" && PROXY_HOSTS[u.hostname] && !u.port) return `${base}/${u.hostname}${u.pathname}${u.search}`;
  if (u.protocol === "wss:" && PROXY_WS_HOSTS.includes(u.hostname) && !u.port) return `${base.replace(/^https:/, "wss:")}/${u.hostname}${u.pathname}${u.search}`;
  return null;
}

/** The WebSocket address to open: through the relay for the hosts that refuse the browser, otherwise unchanged. */
export function wsVia(url: string): string {
  return url.startsWith("wss:") ? (proxiedUrl(url) ?? url) : url;
}

/**
 * fetch() that uses the relay where needed: "always" hosts go through it, "fallback" hosts only after the direct
 * request got no answer. `init` is called per attempt, so each one gets its own timeout signal.
 */
export async function fetchVia(url: string, init?: () => RequestInit): Promise<Response> {
  const via = proxiedUrl(url);
  if (!via) return fetch(url, init?.());
  if (PROXY_HOSTS[new URL(url).hostname] === "always") return fetch(via, init?.());
  try {
    return await fetch(url, init?.());
  } catch {
    return fetch(via, init?.());
  }
}

/** Asks the relay whether it runs and accepts this page: GET <relay>/health. */
export async function checkProxy(url: string, fetchFn: typeof fetch = fetch): Promise<{ ok: boolean; detail: string }> {
  const b = normalizeProxyUrl(url);
  if (!b) return { ok: false, detail: "keine gültige https-Adresse" };
  try {
    const res = await fetchFn(`${b}/health`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const j = (await res.json()) as { ok?: boolean; service?: string; allowed?: boolean };
    if (!j.ok || j.service !== "chartai-proxy") return { ok: false, detail: "antwortet, ist aber nicht der ChartAI-Proxy" };
    return j.allowed ? { ok: true, detail: "Proxy läuft und nimmt Anfragen dieser Seite an" } : { ok: false, detail: "Proxy läuft, erlaubt aber diese Seite nicht (ALLOWED_ORIGINS im Worker)" };
  } catch {
    return { ok: false, detail: "nicht erreichbar (Adresse prüfen, Worker bereitgestellt?)" };
  }
}
