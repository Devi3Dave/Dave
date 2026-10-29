import { useSyncExternalStore } from "react";
import { normalizeProxyUrl } from "../shared/proxy";
import {
  GIST_DESCRIPTION,
  GIST_FILE,
  gistErrorText,
  isSyncKey,
  mergeItems,
  parseDoc,
  pendingItems,
  readPairing,
  reconcile,
  scanLocal,
  syncErrorText,
  type SyncDoc,
  type SyncItem,
  type SyncMeta,
  type SyncTarget,
} from "../shared/sync";

/**
 * Automatic sync of charts, indicators, drawings and settings between devices (shared/sync.ts), through a secret GitHub Gist
 * or the own Worker.
 * Runs before the app is loaded (main.tsx), so the stores read the newest state. Later changes from the other device are
 * taken over when ChartAI comes back to the front or after a few seconds without input, by reloading the page; the
 * stores would otherwise write their older state back. Must not import the stores.
 */

const CONFIG_KEY = "chartai.sync.v1";
const META_KEY = "chartai.syncMeta.v1";
/** sessionStorage: shows after the reload that the other device's state was taken over. */
const APPLIED_KEY = "chartai.syncApplied";
const PROXY_KEY = "chartai.proxy.v1";

/** First send after a change, then at most this often (Cloudflare's free plan: 1000 saves a day, GitHub: 5000 calls an hour). */
const PUSH_DELAY_MS = 4_000;
const PUSH_GAP_MS = 45_000;
const POLL_MS = 30_000;
/** No tap or key this long: a new state from the other device may reload the page. */
const IDLE_MS = 10_000;
const START_TIMEOUT_MS = 4_000;
/** At most one automatic reload in this time; a value rewritten on every start would otherwise bounce between the devices. */
const RELOAD_GAP_MS = 120_000;
const RELOADED_KEY = "chartai.syncReloadedAt";

export type SyncConfig = SyncTarget;

export interface SyncStatus {
  config: SyncConfig | null;
  state: "off" | "busy" | "ok" | "error";
  detail: string;
  /** Device time of the last successful sync. */
  last: number | null;
  /** Set after a reload that took over the other device's state. */
  applied: boolean;
}

const listeners = new Set<() => void>();
let status: SyncStatus = { config: readConfig(), state: "off", detail: "", last: null, applied: false };

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSyncStatus,
  );
}

function readConfig(): SyncConfig | null {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "null") as SyncConfig | null;
    if (c?.kind === "gist") return typeof c.gist === "string" && typeof c.token === "string" && c.token ? c : null;
    return c && typeof c.url === "string" && typeof c.key === "string" && c.key ? c : null;
  } catch {
    return null;
  }
}

function readMeta(): SyncMeta | null {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? "null") as SyncMeta | null;
  } catch {
    return null;
  }
}

function writeMeta(meta: SyncMeta) {
  try {
    rawSet(META_KEY, JSON.stringify(meta));
  } catch {
    // full: sent again next time
  }
}

// The original methods: what sync writes itself must not count as a change of this device.
const rawSet = (k: string, v: string) => Storage.prototype.setItem.call(localStorage, k, v);
const rawRemove = (k: string) => Storage.prototype.removeItem.call(localStorage, k);

function localValues(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && isSyncKey(k)) out[k] = localStorage.getItem(k) ?? "";
  }
  return out;
}

/** The Worker address: the own one of the sync settings, else the proxy's. */
export function defaultWorkerUrl(): string {
  try {
    return normalizeProxyUrl(localStorage.getItem(PROXY_KEY) ?? "") ?? "";
  } catch {
    return "";
  }
}

function netError(e: unknown, who: string): Error {
  if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") return new Error(`${who} antwortet gerade nicht, nächster Versuch gleich`);
  if (navigator.onLine === false) return new Error("offline – synchronisiert, sobald wieder Netz da ist");
  return new Error(who === "GitHub" ? "GitHub nicht erreichbar" : "Worker nicht erreichbar (Adresse prüfen, Worker bereitgestellt?)");
}

async function workerCall(cfg: { url: string; key: string }, init: { method: "GET"; rev?: number } | { method: "POST"; body: string; keepalive?: boolean }, signal?: AbortSignal): Promise<SyncDoc & { same?: boolean }> {
  const url = `${cfg.url}/sync${init.method === "GET" && init.rev !== undefined ? `?rev=${init.rev}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: { Authorization: `Bearer ${cfg.key}`, ...(init.method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: init.method === "POST" ? init.body : undefined,
      keepalive: init.method === "POST" ? init.keepalive : undefined,
      signal: signal ?? AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (e) {
    throw netError(e, "Worker");
  }
  const body = (await res.json().catch(() => null)) as (SyncDoc & { same?: boolean; error?: string; missing?: string[] }) | null;
  if (!res.ok || !body) throw new Error(syncErrorText(res.status, body));
  return body;
}

const GITHUB = "https://api.github.com";

/** GitHub REST API (CORS allowed for any page); "no-store", because GitHub lets browsers keep answers for 60 s. */
async function github<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${GITHUB}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: signal ?? AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (e) {
    throw netError(e, "GitHub");
  }
  const body = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!res.ok || !body) throw new Error(gistErrorText(res.status, body));
  return body;
}

interface GistFile {
  content?: string;
  truncated?: boolean;
  raw_url?: string;
}

/** The state in the Gist; a file over 1 MB comes without content and is loaded from raw_url. */
async function gistDoc(cfg: { gist: string; token: string }, signal?: AbortSignal): Promise<SyncDoc> {
  const g = await github<{ files: Record<string, GistFile> }>(cfg.token, `/gists/${encodeURIComponent(cfg.gist)}`, {}, signal);
  const file = g.files[GIST_FILE];
  if (!file) return { rev: 0, items: {} };
  let text = file.content ?? "";
  if (file.truncated && file.raw_url) {
    try {
      text = await (await fetch(file.raw_url, { cache: "no-store", signal: signal ?? AbortSignal.timeout(20_000) })).text();
    } catch (e) {
      throw netError(e, "GitHub");
    }
  }
  try {
    return parseDoc(text);
  } catch {
    return { rev: 0, items: {} };
  }
}

/** Reads the shared state; `same` when it is still `rev`. */
async function fetchDoc(cfg: SyncConfig, rev: number | undefined, signal?: AbortSignal): Promise<SyncDoc & { same?: boolean }> {
  if (cfg.kind !== "gist") return workerCall(cfg, { method: "GET", rev }, signal);
  const doc = await gistDoc(cfg, signal);
  return doc.rev === rev ? { ...doc, same: true } : doc;
}

/** Adds this device's newer items; the Worker merges itself, for the Gist it is read, merged and written back. */
async function pushItems(cfg: SyncConfig, items: Record<string, SyncItem>, keepalive: boolean, signal?: AbortSignal): Promise<SyncDoc> {
  if (cfg.kind !== "gist") {
    const body = JSON.stringify({ items });
    return workerCall(cfg, { method: "POST", body, keepalive: keepalive && body.length < 60_000 }, signal);
  }
  const { doc, changed } = mergeItems(await gistDoc(cfg, signal), items, Date.now());
  if (changed) await github(cfg.token, `/gists/${encodeURIComponent(cfg.gist)}`, { method: "PATCH", body: { files: { [GIST_FILE]: { content: JSON.stringify(doc) } } } }, signal);
  return doc;
}

/** Finds the sync Gist of this GitHub account or creates it (secret: only reachable with its address). */
export async function findOrCreateGist(token: string): Promise<SyncConfig> {
  const t = token.trim();
  for (let page = 1; page <= 5; page++) {
    const list = await github<{ id: string; files: Record<string, unknown> }[]>(t, `/gists?per_page=100&page=${page}`);
    const hit = list.find((g) => g.files && GIST_FILE in g.files);
    if (hit) return { kind: "gist", gist: hit.id, token: t };
    if (list.length < 100) break;
  }
  const created = await github<{ id: string }>(t, "/gists", {
    method: "POST",
    body: { description: GIST_DESCRIPTION, public: false, files: { [GIST_FILE]: { content: JSON.stringify({ rev: 0, items: {} }) } } },
  });
  return { kind: "gist", gist: created.id, token: t };
}

/** Writes the other device's values. */
function applyValues(apply: Record<string, string | null>) {
  for (const [k, v] of Object.entries(apply)) {
    try {
      if (v === null) rawRemove(k);
      else rawSet(k, v);
    } catch {
      // storage full: this key stays as it is
    }
  }
}

let running: Promise<void> | null = null;
let lastPush = 0;
let pushTimer: number | undefined;
let lastInput = 0;
/** The app is on screen; until then the other device's state is written without a reload. */
let appStarted = false;

function reloadedLately(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(RELOADED_KEY) ?? 0) < RELOAD_GAP_MS;
  } catch {
    return false;
  }
}

const idle = () => Date.now() - lastInput >= IDLE_MS && !reloadedLately();

/**
 * One round: note local changes, send what the Worker lacks, take over what is newer there.
 * `mayReload`: whether a running app may be reloaded now for the other device's state.
 */
async function cycle(opts: { mayReload: boolean; signal?: AbortSignal; keepalive?: boolean }): Promise<void> {
  const cfg = status.config;
  if (!cfg) return;
  setStatus({ state: "busy" });
  try {
    const first = readMeta() === null;
    let meta = scanLocal(readMeta() ?? { rev: -1, items: {} }, localValues(), Date.now(), first);
    writeMeta(meta);
    const pending = pendingItems(meta, localValues());
    let doc: SyncDoc & { same?: boolean };
    if (Object.keys(pending).length) {
      doc = await pushItems(cfg, pending, Boolean(opts.keepalive), opts.signal);
      lastPush = Date.now();
    } else {
      doc = await fetchDoc(cfg, meta.rev, opts.signal);
    }
    if (!doc.same) {
      const result = reconcile(meta, localValues(), doc);
      const hasNews = Object.keys(result.apply).length > 0;
      if (hasNews && appStarted && !opts.mayReload) {
        // Taken over later (back to the front or idle); only what was sent counts as known.
        for (const [k, item] of Object.entries(pending)) if (meta.items[k]) meta.items[k] = { ...meta.items[k], r: Math.max(meta.items[k].r, item.t) };
        writeMeta(meta);
        setStatus({ state: "ok", detail: "Neuer Stand vom anderen Gerät – wird übernommen, sobald du kurz nichts tippst", last: Date.now() });
        return;
      }
      applyValues(result.apply);
      meta = result.meta;
      writeMeta(meta);
      if (hasNews && appStarted) {
        try {
          sessionStorage.setItem(APPLIED_KEY, "1");
          sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
        } catch {
          // no note after the reload
        }
        location.reload();
        return;
      }
      if (hasNews) setStatus({ applied: true });
      // Something of this device may still be newer than what the Worker holds (sent next round).
      if (Object.keys(pendingItems(meta, localValues())).length) schedulePush(PUSH_DELAY_MS);
    }
    setStatus({ state: "ok", detail: "", last: Date.now() });
  } catch (e) {
    setStatus({ state: "error", detail: (e as Error).message });
  }
}

function run(opts: Parameters<typeof cycle>[0]): Promise<void> {
  if (running) return running;
  running = cycle(opts).finally(() => {
    running = null;
  });
  return running;
}

function schedulePush(delay = PUSH_DELAY_MS) {
  if (!status.config || pushTimer !== undefined) return;
  const wait = Math.max(delay, lastPush + PUSH_GAP_MS - Date.now());
  pushTimer = window.setTimeout(() => {
    pushTimer = undefined;
    void run({ mayReload: idle() });
  }, wait);
}

/** Every write of the app to a synced key starts a (delayed) send. */
function watchStorage() {
  const set = Storage.prototype.setItem;
  const remove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k: string, v: string) {
    set.call(this, k, v);
    if (this === localStorage && isSyncKey(k)) schedulePush();
  };
  Storage.prototype.removeItem = function (k: string) {
    remove.call(this, k);
    if (this === localStorage && isSyncKey(k)) schedulePush();
  };
}

let started = false;

function startBackground() {
  if (started) return;
  started = true;
  watchStorage();
  const mark = () => {
    lastInput = Date.now();
  };
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(ev, mark, { passive: true, capture: true });
  document.addEventListener("visibilitychange", () => {
    if (!status.config) return;
    if (document.visibilityState === "hidden") {
      // Send what changed before the device is put away.
      window.clearTimeout(pushTimer);
      pushTimer = undefined;
      void run({ mayReload: false, keepalive: true });
    } else {
      lastInput = 0;
      void run({ mayReload: true });
    }
  });
  window.addEventListener("online", () => status.config && void run({ mayReload: idle() }));
  window.setInterval(() => {
    if (status.config && document.visibilityState === "visible") void run({ mayReload: idle() });
  }, POLL_MS);
}

/** Before the app loads: takes over a pairing link and the newest state (at most a few seconds, offline the app just starts). */
export async function startSync(): Promise<void> {
  const pairing = readPairing(location.hash);
  if (pairing) {
    if (pairing.kind === "gist") saveConfig(pairing, "join");
    else {
      const url = normalizeProxyUrl(pairing.url);
      if (url) saveConfig({ url, key: pairing.key }, "join");
    }
    history.replaceState(null, "", location.pathname + location.search);
  }
  try {
    if (sessionStorage.getItem(APPLIED_KEY)) {
      sessionStorage.removeItem(APPLIED_KEY);
      status = { ...status, applied: true };
    }
  } catch {
    // no note
  }
  startBackground();
  if (status.config) {
    const timeout = AbortSignal.timeout(START_TIMEOUT_MS);
    await run({ mayReload: false, signal: timeout });
  }
}

/** Called once the app is rendered: from now on the other device's state needs a reload. */
export function markAppStarted() {
  appStarted = true;
}

/**
 * Switches sync on. "join": what the Worker already holds replaces this device's state (the other device is set up already);
 * "upload": this device's state replaces the Worker's.
 */
function saveConfig(cfg: SyncConfig, mode: "join" | "upload") {
  rawSet(CONFIG_KEY, JSON.stringify(cfg));
  // A new start: join gives existing values t = 0, upload the current time.
  rawRemove(META_KEY);
  if (mode === "upload") writeMeta(scanLocal({ rev: -1, items: {} }, localValues(), Date.now()));
  status = { ...status, config: cfg, state: "busy", detail: "" };
  listeners.forEach((l) => l());
}

export async function enableSync(cfg: SyncConfig, mode: "join" | "upload"): Promise<void> {
  saveConfig(cfg, mode);
  lastInput = 0;
  await run({ mayReload: true });
}

export function disableSync() {
  rawRemove(CONFIG_KEY);
  rawRemove(META_KEY);
  window.clearTimeout(pushTimer);
  pushTimer = undefined;
  setStatus({ config: null, state: "off", detail: "", last: null });
}

export function syncNow(): Promise<void> {
  lastInput = 0;
  return run({ mayReload: true });
}

/** Looks at the Worker or Gist without changing anything: whether the key fits and how many keys it holds. */
export async function probeSync(cfg: SyncConfig): Promise<{ ok: true; keys: number } | { ok: false; detail: string }> {
  try {
    const doc = await fetchDoc(cfg, undefined);
    return { ok: true, keys: Object.values(doc.items ?? {}).filter((i) => i.v !== null).length };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

/** All synced keys of this device, for the file backup. */
export function syncedValues(): Record<string, string> {
  return localValues();
}

/**
 * Replaces this device's state with a backup and restarts the app. Written through the normal methods,
 * so a switched-on sync passes the imported state on to the other devices.
 */
export function restoreBackup(items: Record<string, string>) {
  for (const k of Object.keys(localValues())) if (!(k in items)) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
  if (status.config) {
    // Send before the reload, so the other device does not overwrite the import with its older state.
    window.clearTimeout(pushTimer);
    pushTimer = undefined;
    void (running ?? Promise.resolve()).then(() => run({ mayReload: false })).finally(() => location.reload());
  } else location.reload();
}
