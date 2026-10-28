import { useState } from "react";
import { createPortal } from "react-dom";
import { setCheckOpen, setCryptoVenue, symbolFor, useAssets } from "../assetStore";
import { fetchJson, isNetworkError, wsRequest } from "../../shared/marketData";
import { checkProxy } from "../../shared/proxy";
import { checkVenue, type CheckState, type CheckStep } from "../../shared/venueCheck";
import { pickerVenues, type VenueId } from "../../shared/venues";
import { setProxyUrl, useProxyUrl } from "../proxySettings";
import { charts } from "../store";

const GUIDE_URL = "https://github.com/Devi3Dave/Dave/blob/master/tradingview-clone/proxy/README.md";

const ICON: Record<CheckState, string> = { ok: "✓", fail: "✕", skip: "–" };

type Result = CheckStep[] | "running";

/** Connection test: which exchange this browser can load (REST candles, WebSocket fallback, live trades, market list). */
export function VenueCheckDialog() {
  const open = useAssets((s) => s.checkOpen);
  const venue = useAssets((s) => s.venue);
  const [results, setResults] = useState<Partial<Record<VenueId, Result>>>({});
  const proxyUrl = useProxyUrl();
  const [proxyInput, setProxyInput] = useState(proxyUrl);
  const [proxyState, setProxyState] = useState<{ ok: boolean; detail: string } | "running" | null>(null);
  if (!open) return null;
  const VENUES = pickerVenues();
  const testProxy = (url: string) => {
    setProxyState("running");
    void checkProxy(url).then(setProxyState);
  };
  const saveProxy = (url: string) => {
    if (!setProxyUrl(url)) return setProxyState({ ok: false, detail: "keine gültige https-Adresse" });
    setProxyInput(url.trim() ? url.trim() : "");
    setResults({});
    // Charts of exchanges reload, now with or without the relay.
    for (const c of charts) if (c.get().source === "venue") void c.load(symbolFor(c.get().symbol), c.get().interval);
    if (url.trim()) testProxy(url);
    else setProxyState(null);
  };
  const close = () => setCheckOpen(false);
  const run = (id: VenueId) => {
    setResults((r) => ({ ...r, [id]: "running" }));
    void checkVenue(id, { fetchJson, wsRequest, isNetworkError })
      .catch((e: Error): CheckStep[] => [{ label: "Test", state: "fail", detail: e.message }])
      .then((steps) => setResults((r) => ({ ...r, [id]: steps })));
  };
  const runAll = () => VENUES.forEach((v) => run(v.id));
  return createPortal(
    <div className="modal-backdrop" onClick={close}>
      <div className="modal venue-check-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>🩺 Börsen testen</h2>
          <button onClick={close} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>
        <p className="hint">
          Prüft mit BTC, was dieser Browser von jeder Börse laden darf. Manche Börsen sperren Abrufe aus dem Browser (CORS, in Safari „Load failed“). Dann lädt
          ChartAI die Kerzen über den WebSocket der Börse, wo es einen gibt, oder über deinen eigenen Proxy. Ein Screenshot hiervon hilft bei der Fehlersuche.
        </p>
        <section className="venue-check proxy-settings">
          <h3>
            Eigener Proxy für gesperrte Börsen
            {proxyUrl && <span className="count">aktiv</span>}
          </h3>
          <label className="field">
            Adresse deines Cloudflare Workers
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="https://chartai-proxy.deinname.workers.dev"
              value={proxyInput}
              onChange={(e) => setProxyInput(e.target.value)}
            />
          </label>
          <p className="hint">
            Damit laden auch KuCoin, BitMEX, die Kraken-Perps und die Binance-Optionen. Der Proxy reicht nur öffentliche Kurse weiter, ohne Login und ohne
            Schlüssel; deine Einstellungen und Trades bleiben auf diesem Gerät, außer du schaltest oben ☁ Sync ein.{" "}
            <a href={GUIDE_URL} target="_blank" rel="noreferrer">
              Anleitung zum Einrichten
            </a>
          </p>
          {proxyState && (
            <div className={`check-line ${proxyState === "running" ? "skip" : proxyState.ok ? "ok" : "fail"}`}>
              <span className="check-icon">{proxyState === "running" ? "…" : proxyState.ok ? ICON.ok : ICON.fail}</span> Proxy:{" "}
              {proxyState === "running" ? "teste …" : proxyState.detail}
            </div>
          )}
          <div className="modal-actions">
            {proxyUrl && <button onClick={() => saveProxy("")}>Proxy entfernen</button>}
            {proxyUrl && (
              <button onClick={() => testProxy(proxyUrl)} disabled={proxyState === "running"}>
                Proxy testen
              </button>
            )}
            <button className="send" onClick={() => saveProxy(proxyInput)} disabled={!proxyInput.trim() || proxyInput.trim() === proxyUrl}>
              Speichern
            </button>
          </div>
        </section>
        <div className="modal-actions">
          <button className="primary" onClick={runAll}>
            Alle testen
          </button>
        </div>
        <div className="indicator-list venue-check-list">
          {VENUES.map((v) => {
            const r = results[v.id];
            const steps = Array.isArray(r) ? r : [];
            const verdict = !Array.isArray(r) ? null : steps.some((s) => s.label.includes("Kerzen") && s.state === "ok") ? "ok" : "fail";
            return (
              <section key={v.id} className="venue-check">
                <h3>
                  <button className="link" onClick={() => setCryptoVenue(v.id)} data-tip={`Krypto von ${v.name} laden`}>
                    {v.name}
                  </button>
                  {venue === v.id && <span className="count">gewählt</span>}
                  {verdict && <span className={`check-state ${verdict}`}>{verdict === "ok" ? "Charts laden" : "Charts gesperrt"}</span>}
                  <button className="venue-check-run" onClick={() => run(v.id)} disabled={r === "running"}>
                    {r === "running" ? "Teste …" : r ? "Nochmal" : "Testen"}
                  </button>
                </h3>
                {steps.map((s) => (
                  <div key={s.label} className={`check-line ${s.state}`}>
                    <span className="check-icon">{ICON[s.state]}</span> {s.label}: {s.detail}
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
