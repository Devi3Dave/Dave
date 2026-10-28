import { useState } from "react";
import { createPortal } from "react-dom";
import { setCheckOpen, setCryptoVenue, useAssets } from "../assetStore";
import { fetchJson, isNetworkError, wsRequest } from "../../shared/marketData";
import { checkVenue, type CheckState, type CheckStep } from "../../shared/venueCheck";
import { PICKER_VENUES as VENUES, type VenueId } from "../../shared/venues";

const ICON: Record<CheckState, string> = { ok: "✓", fail: "✕", skip: "–" };

type Result = CheckStep[] | "running";

/** Connection test: which exchange this browser can load (REST candles, WebSocket fallback, live trades, market list). */
export function VenueCheckDialog() {
  const open = useAssets((s) => s.checkOpen);
  const venue = useAssets((s) => s.venue);
  const [results, setResults] = useState<Partial<Record<VenueId, Result>>>({});
  if (!open) return null;
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
          ChartAI die Kerzen über den WebSocket der Börse, wo es einen gibt. Ein Screenshot hiervon hilft bei der Fehlersuche.
        </p>
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
