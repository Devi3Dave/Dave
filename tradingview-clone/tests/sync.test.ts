import { describe, expect, it } from "vitest";
import worker from "../proxy/worker.js";
import { gistErrorText, hashText, isSyncKey, makeBackup, makeSyncKey, mergeItems, pairingLink, parseDoc, pendingItems, readBackup, readPairing, reconcile, scanLocal, syncErrorText, type SyncDoc, type SyncMeta } from "../shared/sync";

const RELAY = "https://chartai-proxy.devi.workers.dev";
const PAGE = "https://devi3dave.github.io";
const KEY = "k".repeat(32);
const empty = (): SyncMeta => ({ rev: -1, items: {} });

/** Two devices and the Worker, as plain data: what the app does each round (src/sync.ts) without fetch. */
function device(local: Record<string, string>) {
  return { local, meta: empty() };
}
function round(d: { local: Record<string, string>; meta: SyncMeta }, server: SyncDoc, now: number, firstTime = false) {
  d.meta = scanLocal(d.meta, d.local, now, firstTime);
  for (const [k, item] of Object.entries(pendingItems(d.meta, d.local))) {
    const cur = server.items[k];
    if (!cur || item.t > cur.t) {
      server.items[k] = item;
      server.rev += 1;
    }
  }
  const r = reconcile(d.meta, d.local, server);
  for (const [k, v] of Object.entries(r.apply)) {
    if (v === null) delete d.local[k];
    else d.local[k] = v;
  }
  d.meta = r.meta;
}

describe("sync logic", () => {
  it("keeps API keys, its own settings and caches on the device", () => {
    expect(isSyncKey("chartai.layout.v1")).toBe(true);
    expect(isSyncKey("chartai.layout.v1.chart2")).toBe(true);
    expect(isSyncKey("chartai.proxy.v1")).toBe(true);
    expect(isSyncKey("chartai.claude.v1")).toBe(false);
    expect(isSyncKey("chartai.exchangeFeed.v1")).toBe(false);
    expect(isSyncKey("chartai.sync.v1")).toBe(false);
    expect(isSyncKey("chartai.syncMeta.v1")).toBe(false);
    expect(isSyncKey("chartai.venueMarkets.v1.kraken")).toBe(false);
    expect(isSyncKey("other.app")).toBe(false);
  });

  it("brings the Mac's drawings to a new iPad, without the iPad's start layout winning", () => {
    const server: SyncDoc = { rev: 0, items: {} };
    const mac = device({ "chartai.layout.v1": '{"drawings":[1,2,3]}', "chartai.claude.v1": '{"apiKey":"sk-secret"}' });
    round(mac, server, 1000);
    expect(server.items["chartai.layout.v1"].v).toBe('{"drawings":[1,2,3]}');
    expect(server.items["chartai.claude.v1"]).toBeUndefined();

    const ipad = device({ "chartai.layout.v1": '{"drawings":[]}', "chartai.alerts.v1": "[9]" });
    round(ipad, server, 5000, true);
    expect(ipad.local["chartai.layout.v1"]).toBe('{"drawings":[1,2,3]}');
    // What only the iPad had travels too.
    expect(server.items["chartai.alerts.v1"].v).toBe("[9]");
    round(mac, server, 6000);
    expect(mac.local["chartai.alerts.v1"]).toBe("[9]");
  });

  it("merges key by key: the newer change wins, deletions travel", () => {
    const server: SyncDoc = { rev: 0, items: {} };
    const mac = device({ "chartai.layout.v1": "A", "chartai.notes.v1": "n" });
    round(mac, server, 1000);
    const ipad = device({});
    round(ipad, server, 1100, true);
    expect(ipad.local).toEqual({ "chartai.layout.v1": "A", "chartai.notes.v1": "n" });

    mac.local["chartai.layout.v1"] = "B";
    ipad.local["chartai.alerts.v1"] = "X";
    delete ipad.local["chartai.notes.v1"];
    round(ipad, server, 2000);
    round(mac, server, 2100);
    round(ipad, server, 2200);
    expect(mac.local).toEqual({ "chartai.layout.v1": "B", "chartai.alerts.v1": "X" });
    expect(ipad.local).toEqual(mac.local);
    expect(server.items["chartai.notes.v1"].v).toBeNull();
    // Nothing left to send once both agree.
    expect(pendingItems(scanLocal(mac.meta, mac.local, 3000), mac.local)).toEqual({});
  });

  it("sends again what the Worker lost", () => {
    const server: SyncDoc = { rev: 0, items: {} };
    const mac = device({ "chartai.layout.v1": "A" });
    round(mac, server, 1000);
    delete server.items["chartai.layout.v1"];
    const r = reconcile(mac.meta, mac.local, server);
    expect(pendingItems(r.meta, mac.local)).toEqual({ "chartai.layout.v1": { v: "A", t: 1000 } });
  });

  it("makes keys and pairing links", () => {
    const key = makeSyncKey((b) => b.fill(7));
    expect(key).toHaveLength(32);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    const link = pairingLink(`${PAGE}/Dave/chartai/`, { url: RELAY, key });
    expect(link.startsWith(`${PAGE}/Dave/chartai/#`)).toBe(true);
    expect(readPairing(new URL(link).hash)).toEqual({ url: RELAY, key });
    const gist = { kind: "gist" as const, gist: "abc123", token: "ghp_x" };
    expect(readPairing(new URL(pairingLink(`${PAGE}/Dave/chartai/`, gist)).hash)).toEqual(gist);
    expect(readPairing("")).toBeNull();
    expect(hashText("a")).not.toBe(hashText("b"));
  });

  it("explains Worker answers in German", () => {
    expect(syncErrorText(401, null)).toContain("SYNC_KEY");
    expect(syncErrorText(501, { missing: ["CHARTAI_SYNC"] })).toContain("KV");
    expect(syncErrorText(403, { error: "host not allowed" })).toContain("alte Version");
  });
});

describe("Gist and file", () => {
  it("merges like the Worker: newer wins, foreign keys dropped", () => {
    const base: SyncDoc = { rev: 5, items: { "chartai.layout.v1": { v: "A", t: 10 } } };
    const r = mergeItems(base, { "chartai.layout.v1": { v: "old", t: 5 }, "chartai.alerts.v1": { v: "X", t: 7 }, "chartai.claude.v1": { v: "sk", t: 99 } }, 1000);
    expect(r.changed).toBe(true);
    expect(r.doc.items).toEqual({ "chartai.layout.v1": { v: "A", t: 10 }, "chartai.alerts.v1": { v: "X", t: 7 } });
    expect(r.doc.rev).toBe(1000);
    expect(mergeItems(r.doc, { "chartai.alerts.v1": { v: "X", t: 7 } }, 2000).changed).toBe(false);
    expect(parseDoc("{}")).toEqual({ rev: 0, items: {} });
  });

  it("explains GitHub answers in German", () => {
    expect(gistErrorText(401, null)).toContain("abgelaufen");
    expect(gistErrorText(403, { message: "API rate limit exceeded" })).toContain("Limit");
    expect(gistErrorText(404, null)).toContain("gist");
  });

  it("exports and imports the synced keys only", () => {
    const b = makeBackup({ "chartai.layout.v1": "A", "chartai.claude.v1": '{"apiKey":"sk"}' }, "0.63.0", new Date("2026-10-29T12:00:00Z"));
    expect(b.items).toEqual({ "chartai.layout.v1": "A" });
    const back = readBackup(JSON.stringify(b));
    expect(typeof back === "string" ? back : back.items).toEqual({ "chartai.layout.v1": "A" });
    expect(readBackup('{"app":"x"}')).toBe("keine ChartAI-Sicherung");
    expect(readBackup("nope")).toContain("JSON");
  });
});

describe("Worker /sync", () => {
  const kv = () => {
    const map = new Map<string, string>();
    return { map, get: async (k: string) => map.get(k) ?? null, put: async (k: string, v: string) => void map.set(k, v) };
  };
  const ask = (env: object, init: { method?: string; key?: string | null; body?: unknown; path?: string; origin?: string } = {}) => {
    const headers = new Headers({ Origin: init.origin ?? PAGE, "CF-Connecting-IP": "5.6.7.8" });
    if (init.key !== null) headers.set("Authorization", `Bearer ${init.key ?? KEY}`);
    return worker.fetch(
      new Request(`${RELAY}${init.path ?? "/sync"}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }),
      env,
    );
  };

  it("says what is missing until KV and key are set up", async () => {
    const res = await ask({});
    expect(res.status).toBe(501);
    expect(((await res.json()) as { missing: string[] }).missing).toEqual(["CHARTAI_SYNC", "SYNC_KEY"]);
    expect((await ask({ CHARTAI_SYNC: kv(), SYNC_KEY: "short" })).status).toBe(501);
    const health = (await (await ask({ CHARTAI_SYNC: kv(), SYNC_KEY: KEY }, { path: "/health" })).json()) as { sync: boolean };
    expect(health.sync).toBe(true);
  });

  it("refuses a wrong key and other pages", async () => {
    const env = { CHARTAI_SYNC: kv(), SYNC_KEY: KEY };
    expect((await ask(env, { key: "x".repeat(32) })).status).toBe(401);
    expect((await ask(env, { key: null })).status).toBe(401);
    expect((await ask(env, { origin: "https://evil.example" })).status).toBe(403);
    expect(env.CHARTAI_SYNC.map.size).toBe(0);
  });

  it("allows the preflight for POST with the key header", async () => {
    const res = await ask({}, { method: "OPTIONS", key: null });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });

  it("merges key by key and answers unchanged revisions briefly", async () => {
    const env = { CHARTAI_SYNC: kv(), SYNC_KEY: KEY };
    let doc = (await (await ask(env, { method: "POST", body: { items: { "chartai.layout.v1": { v: "A", t: 10 }, "chartai.alerts.v1": { v: "X", t: 10 } } } })).json()) as SyncDoc;
    expect(doc.items["chartai.layout.v1"]).toEqual({ v: "A", t: 10 });
    // Older values do not replace newer ones; foreign keys and bad items are dropped.
    doc = (await (
      await ask(env, { method: "POST", body: { items: { "chartai.layout.v1": { v: "old", t: 5 }, "chartai.alerts.v1": { v: null, t: 20 }, evil: { v: "x", t: 99 }, "chartai.x": { v: 1, t: 1 } } } })
    ).json()) as SyncDoc;
    expect(doc.items).toEqual({ "chartai.layout.v1": { v: "A", t: 10 }, "chartai.alerts.v1": { v: null, t: 20 } });
    const same = (await (await ask(env, { path: `/sync?rev=${doc.rev}` })).json()) as { same?: boolean };
    expect(same.same).toBe(true);
    const full = (await (await ask(env, { path: "/sync?rev=1" })).json()) as SyncDoc;
    expect(full.items["chartai.layout.v1"].v).toBe("A");
    expect((await ask(env, { method: "POST", body: "nope" })).status).toBe(400);
  });
});
