import { useEffect } from "react";
import { createPortal } from "react-dom";
import { refreshVenueMarkets, setCryptoVenue, setEuMode, setMicaOpen, setOnlyAllowedVenues, setResidence, useAssets } from "../assetStore";
import { availabilityIn, countryName, EEA_COUNTRIES, isEea, MICA, MICA_AS_OF, MICA_REGISTER_URL, MICA_STATUS_ICON, MICA_STATUS_LABEL, OTHER_COUNTRIES, type Availability } from "../../shared/mica";
import { pickerVenues } from "../../shared/venues";
import { useProxyUrl } from "../proxySettings";

const AVAIL: Record<Availability, { icon: string; label: string }> = {
  yes: { icon: "✓", label: "erlaubt" },
  no: { icon: "✕", label: "nicht erlaubt" },
  pending: { icon: "⏳", label: "beantragt" },
  unclear: { icon: "?", label: "unklar" },
  local: { icon: "–", label: "lokale Regeln" },
};

const day = (iso: string) => iso.split("-").reverse().join(".");

/** Country of residence, EU mode and the MiCA status of every crypto exchange, with sources and the day they were checked. */
export function MicaDialog() {
  const open = useAssets((s) => s.micaOpen);
  const country = useAssets((s) => s.country);
  const euMode = useAssets((s) => s.euMode);
  const onlyAllowed = useAssets((s) => s.onlyAllowed);
  const venue = useAssets((s) => s.venue);
  useProxyUrl();
  // The EU mode needs the market list of the chosen exchange to find its EUR and USDC pairs.
  useEffect(() => {
    if (open && euMode) void refreshVenueMarkets(venue).catch(() => undefined);
  }, [open, euMode, venue]);
  if (!open) return null;
  const close = () => setMicaOpen(false);
  const eea = isEea(country);
  return createPortal(
    <div className="modal-backdrop" onClick={close}>
      <div className="modal mica-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>🇪🇺 MiCA und Länder</h2>
          <button onClick={close} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="mica-controls">
          <label className="field">
            Wohnsitzland
            <select value={country ?? ""} onChange={(e) => setResidence(e.target.value || null)}>
              <option value="">– wählen –</option>
              <optgroup label="EU und EWR (MiCA gilt)">
                {Object.entries(EEA_COUNTRIES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Außerhalb des EWR">
                {Object.entries(OTHER_COUNTRIES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={euMode} onChange={(e) => setEuMode(e.target.checked)} />
            EU-Modus: EUR- und USDC-Paare statt USDT
          </label>
          <label className="check">
            <input type="checkbox" checked={onlyAllowed} disabled={!eea} onChange={(e) => setOnlyAllowedVenues(e.target.checked)} />
            Nur Börsen zeigen, die in {country ? countryName(country) : "meinem Land"} erlaubt sind
          </label>
        </div>
        <p className="hint">
          {euMode
            ? "EU-Modus an: Krypto aus der Liste lädt bei der gewählten Börse das Euro-Paar (BTCEUR), sonst USDC, EURC oder USD. Die Suche zeigt diese Paare zuerst. Perpetuals bleiben wie sie sind."
            : "EU-Modus aus: Krypto lädt wie bisher das USDT-Paar."}{" "}
          Seit MiCA dürfen lizenzierte Börsen USDT in der EU nicht mehr zum Handel anbieten, besitzen ist erlaubt. USDT-Charts zeigen trotzdem den Markt mit dem meisten Volumen, ChartAI handelt nichts.
        </p>
        <div className="indicator-list mica-list">
          {pickerVenues().map((v) => {
            const info = MICA[v.id];
            const here = availabilityIn(country, v.id);
            return (
              <section key={v.id} className={`mica-venue ${info.status}`}>
                <h3>
                  <button className="link" onClick={() => setCryptoVenue(v.id)} data-tip={`Krypto von ${v.name} laden`}>
                    {v.name}
                  </button>{" "}
                  <span className={`mica-status ${info.status}`}>
                    {MICA_STATUS_ICON[info.status]} {MICA_STATUS_LABEL[info.status]}
                  </span>
                  {venue === v.id && <span className="count">gewählt</span>}
                </h3>
                {info.entity && (
                  <div className="mica-line">
                    {info.entity}
                    {info.country && ` · ${countryName(info.country)}`}
                    {info.authority && ` · ${info.authority}`}
                    {info.since && ` · ${info.status === "licensed" ? "seit" : "Stand"} ${day(info.since)}`}
                  </div>
                )}
                {info.services && <div className="mica-line">Dienste: {info.services}</div>}
                {info.euSite && <div className="mica-line">EU-Plattform: {info.euSite}</div>}
                <div className="mica-line">Derivate: {info.derivatives.text}</div>
                <div className="mica-line">{info.note}</div>
                {info.warning && <div className="mica-line mica-warning">⚠ {info.warning}</div>}
                {country && (
                  <div className="mica-line mica-here">
                    {countryName(country)}: Spot {AVAIL[here.spot].icon} {AVAIL[here.spot].label} · Derivate {AVAIL[here.derivatives].icon} {AVAIL[here.derivatives].label}. {here.text}
                  </div>
                )}
                <div className="mica-sources">
                  Quellen:{" "}
                  {info.sources.map((s, i) => (
                    <span key={s.url}>
                      {i > 0 && " · "}
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.label}
                      </a>
                    </span>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        <p className="hint">
          Stand {day(MICA_AS_OF)}. Nur ein Hinweis, keine Rechtsberatung: Lizenzen werden erteilt, eingeschränkt und entzogen. Verbindlich ist das{" "}
          <a href={MICA_REGISTER_URL} target="_blank" rel="noreferrer">
            MiCA-Register der ESMA
          </a>{" "}
          (Interim MiCA Register, CASPs) und die Aufsicht deines Landes. Eine MiCA-Lizenz gilt per Passport im ganzen EWR; Ausnahmen einzelner Länder sind hier nicht erfasst.
          Perpetuals, Futures und Optionen fallen nicht unter MiCA, sondern unter MiFID II.
        </p>
      </div>
    </div>,
    document.body,
  );
}
