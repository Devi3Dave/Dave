import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { normalizeProxyUrl } from "../../shared/proxy";
import { makeSyncKey, pairingLink } from "../../shared/sync";
import { defaultWorkerUrl, disableSync, enableSync, probeSync, syncNow, useSyncStatus, type SyncConfig } from "../sync";

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

type Probe = { ok: true; keys: number } | { ok: false; detail: string } | "running" | null;

function SyncDialog({ onClose }: { onClose: () => void }) {
  const s = useSyncStatus();
  const [url, setUrl] = useState(s.config?.url ?? defaultWorkerUrl());
  const [key, setKey] = useState(s.config?.key ?? "");
  const [probe, setProbe] = useState<Probe>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const cfg = (): SyncConfig | null => {
    const u = normalizeProxyUrl(url);
    return u && key.trim() ? { url: u, key: key.trim() } : null;
  };
  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(what),
      () => setCopied(null),
    );
  };
  const check = () => {
    const c = cfg();
    if (!c) return setProbe({ ok: false, detail: "Worker-Adresse (https) und Schlüssel eintragen" });
    setProbe("running");
    void probeSync(c).then(setProbe);
  };
  const turnOn = (mode: "join" | "upload") => {
    const c = cfg();
    if (!c) return;
    setProbe(null);
    void enableSync(c, mode);
  };
  const link = s.config ? pairingLink(location.href.split("#")[0], s.config.url, s.config.key) : "";
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
          Charts, Indikatoren, Zeichnungen, Layouts, Vorlagen, Alarme, Watchlisten, Journal, Demo-Konto und Einstellungen gleichen sich automatisch über deinen
          eigenen Cloudflare Worker ab: was du am Mac einzeichnest, ist auf dem iPad da, sobald du ChartAI dort öffnest. API-Schlüssel (Claude, Twelve Data)
          bleiben auf dem jeweiligen Gerät.{" "}
          <a href={GUIDE_URL} target="_blank" rel="noreferrer">
            Anleitung zum Einrichten
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
            <div className="check-line skip">Worker: {s.config.url}</div>
            <h3>Anderes Gerät verbinden</h3>
            <p className="hint">
              Diesen Link auf dem iPad öffnen (z. B. per AirDrop oder Notizen schicken). ChartAI übernimmt dann Adresse und Schlüssel und lädt deinen Stand. Der Link
              enthält den Schlüssel: nur an dich selbst schicken.
            </p>
            <div className="modal-actions">
              <button onClick={() => copy(link, "link")}>{copied === "link" ? "Link kopiert ✓" : "🔗 Kopplungslink kopieren"}</button>
              <button onClick={() => copy(s.config!.key, "key")}>{copied === "key" ? "Schlüssel kopiert ✓" : "Schlüssel kopieren"}</button>
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
              <button className="send" onClick={check} disabled={probe === "running"}>
                {probe === "running" ? "Prüfe …" : "Verbinden"}
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
                  <span className="check-icon">✓</span> Worker bereit, noch leer. Dieses Gerät lädt seinen Stand als ersten hoch.
                </div>
                <div className="modal-actions">
                  <button className="primary" onClick={() => turnOn("upload")}>
                    Sync einschalten
                  </button>
                </div>
              </>
            )}
            {probe && probe !== "running" && probe.ok && probe.keys > 0 && (
              <>
                <div className="check-line ok">
                  <span className="check-icon">✓</span> Im Worker liegt schon ein Stand (von deinem anderen Gerät). Welcher soll gelten?
                </div>
                <div className="modal-actions">
                  <button onClick={() => turnOn("upload")} data-tip="Charts und Einstellungen dieses Geräts ersetzen den Stand im Worker">
                    Dieses Gerät hochladen
                  </button>
                  <button className="primary" onClick={() => turnOn("join")} data-tip="Charts und Einstellungen des anderen Geräts kommen hierher (empfohlen)">
                    Stand vom anderen Gerät laden
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>,
    document.body,
  );
}
