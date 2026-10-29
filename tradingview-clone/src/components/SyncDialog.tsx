import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { normalizeProxyUrl } from "../../shared/proxy";
import { GIST_TOKEN_URL, makeBackup, makeSyncKey, pairingLink, readBackup, type Backup } from "../../shared/sync";
import { saveFile } from "../saveFile";
import { defaultWorkerUrl, disableSync, enableSync, findOrCreateGist, probeSync, restoreBackup, syncedValues, syncNow, useSyncStatus, type SyncConfig } from "../sync";
import { APP_VERSION } from "../version";

const GUIDE_URL = "https://github.com/Devi3Dave/Dave/blob/master/tradingview-clone/proxy/README.md#geräte-synchronisieren-mac--ipad";

const time = (ms: number) => new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

/** Top-bar button: shows whether this device syncs, opens the settings. */
export function SyncButton() {
  const s = useSyncStatus();
  const [open, setOpen] = useState(false);
  const icon = !s.config ? "☁" : s.state === "error" ? "☁⚠" : s.state === "busy" ? "☁…" : "☁✓";
  const tip = !s.config
    ? "Sync zwischen Mac und iPad\nCharts, Indikatoren, Zeichnungen und Einstellungen automatisch abgleichen"
    : s.state === "error"
      ? `Sync: ${s.detail}`
      : `Sync an${s.last ? `, zuletzt ${time(s.last)}` : ""}${s.detail ? `\n${s.detail}` : ""}`;
  return (
    <>
      <button className={`pill sync-pill ${s.config ? "active" : ""} ${s.state === "error" ? "error" : ""}`} onClick={() => setOpen(true)} aria-label="Sync" data-tip={tip}>
        {icon}
      </button>
      {open && <SyncDialog onClose={() => setOpen(false)} />}
      <AppliedToast />
    </>
  );
}

/** After a reload with the other device's state. */
function AppliedToast() {
  const applied = useSyncStatus().applied;
  const [shown, setShown] = useState(applied);
  useEffect(() => {
    if (!applied) return;
    setShown(true);
    const t = window.setTimeout(() => setShown(false), 5000);
    return () => window.clearTimeout(t);
  }, [applied]);
  if (!shown) return null;
  return createPortal(<div className="sync-toast">☁ Stand vom anderen Gerät übernommen</div>, document.body);
}

type Probe = { ok: true; keys: number; cfg: SyncConfig } | { ok: false; detail: string } | "running" | null;

function SyncDialog({ onClose }: { onClose: () => void }) {
  const s = useSyncStatus();
  const [way, setWay] = useState<"gist" | "worker">("gist");
  const [token, setToken] = useState("");
  const [url, setUrl] = useState(defaultWorkerUrl());
  const [key, setKey] = useState("");
  const [probe, setProbe] = useState<Probe>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(what),
      () => setCopied(null),
    );
  };
  const connect = async () => {
    setProbe("running");
    try {
      let cfg: SyncConfig;
      if (way === "gist") {
        if (!token.trim()) return setProbe({ ok: false, detail: "GitHub-Schlüssel einfügen" });
        cfg = await findOrCreateGist(token);
      } else {
        const u = normalizeProxyUrl(url);
        if (!u || !key.trim()) return setProbe({ ok: false, detail: "Worker-Adresse (https) und Schlüssel eintragen" });
        cfg = { url: u, key: key.trim() };
      }
      const r = await probeSync(cfg);
      setProbe(r.ok ? { ...r, cfg } : r);
    } catch (e) {
      setProbe({ ok: false, detail: (e as Error).message });
    }
  };
  const turnOn = (cfg: SyncConfig, mode: "join" | "upload") => {
    setProbe(null);
    void enableSync(cfg, mode);
  };
  const link = s.config ? pairingLink(location.href.split("#")[0], s.config) : "";
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal sync-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>☁ Sync zwischen Geräten</h2>
          <button onClick={onClose} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>
        <p className="hint">
          Charts, Indikatoren, Zeichnungen, Layouts, Vorlagen, Alarme, Watchlisten, Journal, Demo-Konto und Einstellungen gleichen sich automatisch ab: was du am
          Mac einzeichnest, ist auf dem iPad da, sobald du ChartAI dort öffnest. API-Schlüssel (Claude, Twelve Data) bleiben auf dem jeweiligen Gerät.{" "}
          <a href={GUIDE_URL} target="_blank" rel="noreferrer">
            Anleitung
          </a>
        </p>

        {s.config ? (
          <section className="venue-check">
            <h3>
              Sync ist an <span className={`check-state ${s.state === "error" ? "fail" : "ok"}`}>{s.state === "error" ? "Fehler" : s.state === "busy" ? "gleicht ab …" : "verbunden"}</span>
            </h3>
            <div className={`check-line ${s.state === "error" ? "fail" : "ok"}`}>
              <span className="check-icon">{s.state === "error" ? "✕" : "✓"}</span>{" "}
              {s.state === "error" ? s.detail : `${s.last ? `Zuletzt abgeglichen um ${time(s.last)}` : "Noch nicht abgeglichen"}${s.detail ? ` · ${s.detail}` : ""}`}
            </div>
            <div className="check-line skip">Über: {s.config.kind === "gist" ? "geheimen Gist in deinem GitHub-Konto" : `Worker ${s.config.url}`}</div>
            <h3>Anderes Gerät verbinden</h3>
            <p className="hint">
              Diesen Link auf dem iPad öffnen (z. B. per AirDrop oder Notizen schicken). ChartAI übernimmt dann die Verbindung und lädt deinen Stand. Der Link enthält
              deinen Schlüssel: nur an dich selbst schicken.
            </p>
            <div className="modal-actions">
              <button onClick={() => copy(link, "link")}>{copied === "link" ? "Link kopiert ✓" : "🔗 Kopplungslink kopieren"}</button>
              <button onClick={() => copy(s.config!.kind === "gist" ? s.config!.token : s.config!.key, "key")}>{copied === "key" ? "Schlüssel kopiert ✓" : "Schlüssel kopieren"}</button>
            </div>
            <div className="modal-actions">
              <button onClick={disableSync} data-tip="Dieses Gerät gleicht nicht mehr ab; alles bleibt hier gespeichert">
                Sync ausschalten
              </button>
              <button className="send" onClick={() => void syncNow()} disabled={s.state === "busy"}>
                Jetzt abgleichen
              </button>
            </div>
          </section>
        ) : (
          <section className="venue-check proxy-settings">
            <h3>Einschalten</h3>
            <div className="sync-ways">
              <label className="menu-check">
                <input type="radio" checked={way === "gist"} onChange={() => setWay("gist")} /> Über GitHub (einfach, empfohlen)
              </label>
              <label className="menu-check">
                <input type="radio" checked={way === "worker"} onChange={() => setWay("worker")} /> Über eigenen Cloudflare Worker
              </label>
            </div>
            {way === "gist" ? (
              <>
                <p className="hint">
                  1. Bei GitHub einen Schlüssel erstellen, der nur Gists darf: Link öffnen, bei <b>Expiration</b> „No expiration“ wählen, ganz unten{" "}
                  <b>Generate token</b> und den Schlüssel (beginnt mit ghp_) kopieren.
                </p>
                <div className="modal-actions">
                  <a className="button-link" href={GIST_TOKEN_URL} target="_blank" rel="noreferrer">
                    🔑 Schlüssel bei GitHub erstellen
                  </a>
                </div>
                <label className="field">
                  2. Schlüssel hier einfügen
                  <input
                    type="password"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="ghp_…"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  Adresse deines Cloudflare Workers
                  <input
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="https://chartai-proxy.deinname.workers.dev"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </label>
                <label className="field">
                  Sync-Schlüssel (derselbe wie SYNC_KEY im Worker)
                  <input type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="z. B. mit „Schlüssel erzeugen“" />
                </label>
                <div className="modal-actions">
                  <button onClick={() => setKey(makeSyncKey())} data-tip="Zufälliger Schlüssel aus 32 Zeichen; danach in Cloudflare als Secret SYNC_KEY eintragen">
                    🎲 Schlüssel erzeugen
                  </button>
                  {key.trim() && <button onClick={() => copy(key.trim(), "new")}>{copied === "new" ? "Kopiert ✓" : "Schlüssel kopieren"}</button>}
                </div>
              </>
            )}
            <div className="modal-actions">
              <button className="send" onClick={() => void connect()} disabled={probe === "running"}>
                {probe === "running" ? "Verbinde …" : way === "gist" ? "3. Verbinden" : "Verbinden"}
              </button>
            </div>
            {probe && probe !== "running" && !probe.ok && (
              <div className="check-line fail">
                <span className="check-icon">✕</span> {probe.detail}
              </div>
            )}
            {probe && probe !== "running" && probe.ok && probe.keys === 0 && (
              <>
                <div className="check-line ok">
                  <span className="check-icon">✓</span> Verbunden, noch leer. Dieses Gerät lädt seinen Stand als ersten hoch.
                </div>
                <div className="modal-actions">
                  <button className="primary" onClick={() => turnOn(probe.cfg, "upload")}>
                    Sync einschalten
                  </button>
                </div>
              </>
            )}
            {probe && probe !== "running" && probe.ok && probe.keys > 0 && (
              <>
                <div className="check-line ok">
                  <span className="check-icon">✓</span> Dort liegt schon ein Stand (von deinem anderen Gerät). Welcher soll gelten?
                </div>
                <div className="modal-actions">
                  <button onClick={() => turnOn(probe.cfg, "upload")} data-tip="Charts und Einstellungen dieses Geräts ersetzen den gespeicherten Stand">
                    Dieses Gerät hochladen
                  </button>
                  <button className="primary" onClick={() => turnOn(probe.cfg, "join")} data-tip="Charts und Einstellungen des anderen Geräts kommen hierher (empfohlen)">
                    Stand vom anderen Gerät laden
                  </button>
                </div>
              </>
            )}
          </section>
        )}
        <BackupSection />
      </div>
    </div>,
    document.body,
  );
}

/** Export/import as a file: works without any account (iCloud Drive, AirDrop), and as a backup. */
function BackupSection() {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exportFile = () => {
    const backup = makeBackup(syncedValues(), APP_VERSION, new Date());
    void saveFile(`ChartAI-${backup.exported.slice(0, 10)}.json`, JSON.stringify(backup), "application/json");
  };
  const pick = (file: File | undefined) => {
    setError(null);
    setPending(null);
    if (!file) return;
    void file.text().then((text) => {
      const b = readBackup(text);
      if (typeof b === "string") setError(b);
      else setPending(b);
    });
  };
  return (
    <section className="venue-check">
      <h3>Als Datei übertragen oder sichern</h3>
      <p className="hint">
        Ohne Einrichtung: am Mac exportieren und in iCloud Drive sichern oder per AirDrop schicken, am iPad importieren. Das gleicht nicht von selbst ab, ist aber
        eine gute Sicherung.
      </p>
      <div className="modal-actions">
        <button onClick={exportFile}>📤 Exportieren</button>
        <button onClick={() => input.current?.click()}>📥 Importieren</button>
        <input ref={input} type="file" accept=".json,application/json" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {error && (
        <div className="check-line fail">
          <span className="check-icon">✕</span> {error}
        </div>
      )}
      {pending && (
        <>
          <div className="check-line ok">
            <span className="check-icon">✓</span> Sicherung vom {pending.exported ? new Date(pending.exported).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "?"} (Version{" "}
            {pending.version}, {Object.keys(pending.items).length} Einträge). Sie ersetzt Charts und Einstellungen auf diesem Gerät.
          </div>
          <div className="modal-actions">
            <button onClick={() => setPending(null)}>Abbrechen</button>
            <button className="primary" onClick={() => restoreBackup(pending.items)}>
              Laden
            </button>
          </div>
        </>
      )}
    </section>
  );
}
