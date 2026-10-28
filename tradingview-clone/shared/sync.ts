/**
 * Sync between devices (Mac, iPad …) through the own Cloudflare Worker (proxy/worker.js, /sync).
 * Everything ChartAI keeps in localStorage under "chartai." travels, except secrets and caches (NOT_SYNCED).
 * Each key carries the time it last changed (t); the newer value wins, key by key, so a drawing made on the Mac
 * and an alarm set on the iPad are both kept. Deleted keys travel as v: null.
 */

/** Value of one key with its change time (ms); v null: deleted. */
export interface SyncItem {
  v: string | null;
  t: number;
}

export interface SyncDoc {
  rev: number;
  items: Record<string, SyncItem>;
}

/** What this device knows per key: hash of its value (h, "" when deleted), change time (t), the time the Worker holds (r, -1: none). */
export interface MetaItem {
  h: string;
  t: number;
  r: number;
}

export interface SyncMeta {
  /** rev of the Worker document the device last took over. */
  rev: number;
  items: Record<string, MetaItem>;
}

/** Device-local keys: API keys (Claude, Twelve Data), the sync settings themselves and market-list caches. */
const NOT_SYNCED = ["chartai.claude.", "chartai.exchangeFeed.", "chartai.sync", "chartai.binanceSymbols.", "chartai.venueMarkets."];

export function isSyncKey(key: string): boolean {
  return key.startsWith("chartai.") && !NOT_SYNCED.some((p) => key.startsWith(p));
}

/** cyrb53, a fast 53-bit string hash (public domain, github.com/bryc/code, jshash/experimental/cyrb53.js). */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const hashOf = (v: string | null) => (v === null ? "" : hashText(v));

/**
 * Notes which keys changed on this device since the last look. `firstTime` (joining a device that already has data):
 * existing values get t = 0, so whatever the Worker already holds wins over this device's start state.
 */
export function scanLocal(meta: SyncMeta, local: Record<string, string>, now: number, firstTime = false): SyncMeta {
  const items: Record<string, MetaItem> = { ...meta.items };
  for (const [k, v] of Object.entries(local)) {
    if (!isSyncKey(k)) continue;
    const h = hashText(v);
    const m = items[k];
    if (!m) items[k] = { h, t: firstTime ? 0 : now, r: -1 };
    else if (m.h !== h) items[k] = { ...m, h, t: now };
  }
  for (const [k, m] of Object.entries(items)) {
    if (m.h !== "" && !(k in local)) items[k] = { ...m, h: "", t: now };
  }
  return { ...meta, items };
}

/** Items the Worker does not have in this version yet. */
export function pendingItems(meta: SyncMeta, local: Record<string, string>): Record<string, SyncItem> {
  const out: Record<string, SyncItem> = {};
  for (const [k, m] of Object.entries(meta.items)) if (m.t > m.r) out[k] = { v: m.h === "" ? null : (local[k] ?? null), t: m.t };
  return out;
}

/**
 * Compares the Worker's document with this device. `apply`: newer values from the other device (null: delete the key);
 * the returned meta is right once they are written. Keys this device changed later stay pending (t > r) and are sent next.
 */
export function reconcile(meta: SyncMeta, local: Record<string, string>, doc: SyncDoc): { apply: Record<string, string | null>; meta: SyncMeta } {
  const items: Record<string, MetaItem> = { ...meta.items };
  const apply: Record<string, string | null> = {};
  for (const [k, d] of Object.entries(doc.items)) {
    if (!isSyncKey(k)) continue;
    const m = items[k];
    if (!m || d.t > m.t) {
      const current = local[k] ?? null;
      if (current !== d.v) apply[k] = d.v;
      items[k] = { h: hashOf(d.v), t: d.t, r: d.t };
    } else {
      items[k] = { ...m, r: d.t };
    }
  }
  // Keys the Worker lost (e.g. a merge that read an older copy) are sent again.
  for (const [k, m] of Object.entries(items)) if (!(k in doc.items) && m.r !== -1) items[k] = { ...m, r: -1 };
  return { apply, meta: { rev: doc.rev, items } };
}

/** "Bearer" key: 24 random bytes as base64url (32 characters). */
export function makeSyncKey(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(24));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Pairing link: opens ChartAI on the other device with address and key filled in. */
export function pairingLink(pageUrl: string, worker: string, key: string): string {
  const u = new URL(pageUrl);
  u.hash = new URLSearchParams({ "sync-url": worker, "sync-key": key }).toString();
  return u.toString();
}

export function readPairing(hash: string): { url: string; key: string } | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const url = p.get("sync-url");
  const key = p.get("sync-key");
  return url && key ? { url, key } : null;
}

/** German text for an answer of the Worker's /sync. */
export function syncErrorText(status: number, body: { error?: string; missing?: string[] } | null): string {
  if (status === 401) return "Sync-Schlüssel stimmt nicht mit SYNC_KEY im Worker überein";
  if (status === 501) {
    const missing = body?.missing ?? [];
    if (missing.includes("CHARTAI_SYNC") && missing.includes("SYNC_KEY")) return "im Worker fehlen noch der KV-Speicher CHARTAI_SYNC und das Secret SYNC_KEY";
    if (missing.includes("CHARTAI_SYNC")) return "im Worker fehlt noch der KV-Speicher CHARTAI_SYNC (Bindung)";
    return "im Worker fehlt noch das Secret SYNC_KEY (mindestens 16 Zeichen)";
  }
  if (status === 403 && body?.error === "host not allowed") return "Worker ist noch die alte Version ohne Sync – neuen worker.js-Code bereitstellen";
  if (status === 403) return "Worker erlaubt diese Seite nicht (ALLOWED_ORIGINS)";
  if (status === 404 || status === 405) return "Worker ist noch die alte Version ohne Sync – neuen worker.js-Code bereitstellen";
  if (status === 413) return "zu viele Daten für einen Sync";
  if (status === 429) return "zu viele Anfragen, gleich nochmal";
  if (status === 503) return "Cloudflare hat nicht gespeichert (Tageslimit des Gratis-Tarifs?), morgen geht es weiter";
  return `Fehler ${status}${body?.error ? `: ${body.error}` : ""}`;
}
