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

/** Where the shared state lives: the own Cloudflare Worker or a secret GitHub Gist (no `kind`: Worker, as in 0.62.0). */
export type SyncTarget = { kind?: "worker"; url: string; key: string } | { kind: "gist"; gist: string; token: string };

/** Pairing link: opens ChartAI on the other device with the target filled in. */
export function pairingLink(pageUrl: string, target: SyncTarget): string {
  const u = new URL(pageUrl);
  u.hash = new URLSearchParams(target.kind === "gist" ? { "sync-gist": target.gist, "sync-token": target.token } : { "sync-url": target.url, "sync-key": target.key }).toString();
  return u.toString();
}

export function readPairing(hash: string): SyncTarget | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const gist = p.get("sync-gist");
  const token = p.get("sync-token");
  if (gist && token) return { kind: "gist", gist, token };
  const url = p.get("sync-url");
  const key = p.get("sync-key");
  return url && key ? { url, key } : null;
}

/** Adds items to a document, key by key, the newer t wins (the same rule as /sync in proxy/worker.js). */
export function mergeItems(doc: SyncDoc, items: Record<string, SyncItem>, now: number): { doc: SyncDoc; changed: boolean } {
  const next: SyncDoc = { rev: doc.rev, items: { ...doc.items } };
  let changed = false;
  for (const [k, item] of Object.entries(items)) {
    if (!isSyncKey(k) || !(typeof item.v === "string" || item.v === null) || !Number.isFinite(item.t)) continue;
    const cur = next.items[k];
    if (!cur || item.t > cur.t) {
      next.items[k] = { v: item.v, t: item.t };
      changed = true;
    }
  }
  if (changed) next.rev = Math.max(now, doc.rev + 1);
  return { doc: next, changed };
}

/** The Gist that holds the state: one file, found again on the other device by its name. */
export const GIST_FILE = "chartai-sync.json";
export const GIST_DESCRIPTION = "ChartAI-Sync (nicht löschen, gleicht Charts zwischen deinen Geräten ab)";
/** GitHub page that creates a token which may only use Gists, name and right already filled in. */
export const GIST_TOKEN_URL = "https://github.com/settings/tokens/new?description=ChartAI-Sync&scopes=gist";

export function parseDoc(text: string): SyncDoc {
  const d = JSON.parse(text) as Partial<SyncDoc>;
  return { rev: typeof d.rev === "number" ? d.rev : 0, items: d.items && typeof d.items === "object" ? d.items : {} };
}

/** German text for an answer of the GitHub API. */
export function gistErrorText(status: number, body: { message?: string } | null): string {
  const msg = body?.message ?? "";
  if (status === 401) return "GitHub-Schlüssel ungültig oder abgelaufen – bei GitHub einen neuen erstellen";
  if (status === 403 && /rate limit/i.test(msg)) return "GitHub-Limit für diese Stunde erreicht, gleich geht es weiter";
  if (status === 403 || status === 404) return "Schlüssel darf keine Gists (beim Erstellen den Haken bei „gist“ setzen) oder der Sync-Gist wurde gelöscht";
  if (status === 422) return "GitHub hat den Stand abgelehnt (zu groß?)";
  return `GitHub-Fehler ${status}${msg ? `: ${msg}` : ""}`;
}

/** File backup (export/import): every synced key of this device. */
export interface Backup {
  app: "ChartAI";
  version: string;
  exported: string;
  items: Record<string, string>;
}

export function makeBackup(values: Record<string, string>, version: string, now: Date): Backup {
  const items: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (isSyncKey(k)) items[k] = v;
  return { app: "ChartAI", version, exported: now.toISOString(), items };
}

export function readBackup(text: string): Backup | string {
  try {
    const b = JSON.parse(text) as Partial<Backup>;
    if (b.app !== "ChartAI" || !b.items || typeof b.items !== "object") return "keine ChartAI-Sicherung";
    const items: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.items)) if (isSyncKey(k) && typeof v === "string") items[k] = v;
    return { app: "ChartAI", version: String(b.version ?? "?"), exported: String(b.exported ?? ""), items };
  } catch {
    return "Datei ist kein gültiges JSON";
  }
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
