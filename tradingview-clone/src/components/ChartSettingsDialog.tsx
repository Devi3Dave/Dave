import type { ReactNode } from "react";
import { renkoBoxSize } from "../../shared/chartTypes";
import { DEFAULT_SETTINGS, TIME_ZONES, type ChartSettings } from "../chartSettings";
import { exportChart } from "../chartExport";
import { activeChart, updateSettings, useChartState } from "../store";

type Option<T extends string> = { value: T; label: string; tip?: string };

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Option<T>[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "active" : ""} data-tip={o.tip} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <span data-tip={tip}>{label}</span>
      {children}
    </div>
  );
}

function Toggle({ settingKey, label, tip }: { settingKey: keyof ChartSettings; label: string; tip?: string }) {
  const value = useChartState((s) => s.settings[settingKey]) as boolean;
  return (
    <label className="settings-toggle" data-tip={tip}>
      <input type="checkbox" checked={value} onChange={(e) => updateSettings({ [settingKey]: e.target.checked })} />
      {label}
    </label>
  );
}


/** Number field that only saves valid values (comma or dot as decimal separator). */
function NumberInput({ value, min, max, step, onChange }: { value: number; min: number; max?: number; step?: number; onChange: (v: number) => void }) {
  return (
    <input
      className="settings-number"
      inputMode="decimal"
      defaultValue={String(value).replace(".", ",")}
      key={value}
      onBlur={(e) => {
        let v = Number(e.target.value.trim().replace(",", "."));
        if (!Number.isFinite(v) || v < min) return (e.target.value = String(value).replace(".", ","));
        if (max !== undefined) v = Math.min(max, v);
        if (step === 1) v = Math.round(v);
        onChange(v);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function ChartSettingsDialog({ onClose }: { onClose: () => void }) {
  const st = useChartState((s) => s.settings);
  const bars = useChartState((s) => s.bars);
  // Switching to a fixed box starts from the current ATR, rounded to two digits.
  const atrBox = () => +renkoBoxSize(bars, 0, st.renkoAtr).toPrecision(2) || 1;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Chart-Einstellungen</h2>
          <button onClick={onClose} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>

        <div className="settings-body">
          <section>
            <h3>Preisskala</h3>
            <Row label="Modus" tip="Wie die Preisachse skaliert wird">
              <Segmented
                value={st.scaleMode}
                onChange={(scaleMode) => updateSettings({ scaleMode })}
                options={[
                  { value: "normal", label: "Normal", tip: "Lineare Preisachse" },
                  { value: "log", label: "Log", tip: "Logarithmisch: gleiche prozentuale Bewegungen sind gleich hoch – ideal für lange Krypto-Zeiträume" },
                  { value: "percent", label: "%", tip: "Prozentuale Veränderung ab der ersten sichtbaren Kerze" },
                  { value: "indexed", label: "Index 100", tip: "Auf 100 indexiert ab der ersten sichtbaren Kerze" },
                ]}
              />
            </Row>
            <Row label="Position" tip="Seite, auf der die Preisachse steht">
              <Segmented
                value={st.scalePosition}
                onChange={(scalePosition) => updateSettings({ scalePosition })}
                options={[
                  { value: "left", label: "Links" },
                  { value: "right", label: "Rechts" },
                ]}
              />
            </Row>
            <Toggle settingKey="invertScale" label="Skala invertieren" tip="Preisachse auf den Kopf stellen (hohe Preise unten)" />
          </section>

          <section>
            <h3>Kurs & Beschriftungen</h3>
            <Toggle settingKey="lastPriceLabel" label="Aktueller Kurs auf der Preisachse" tip="Farbiges Label mit dem letzten Kurs rechts auf der Achse" />
            <Toggle settingKey="lastPriceLine" label="Kurslinie" tip="Gestrichelte horizontale Linie auf Höhe des aktuellen Kurses" />
            <Toggle settingKey="countdown" label="Countdown bis Kerzenschluss" tip="Restzeit bis zur nächsten Kerze unter dem Kurslabel, z. B. 00:42 im 1-Minuten-Chart" />
            <Toggle settingKey="highLowLabels" label="Hoch/Tief des sichtbaren Bereichs" tip="Höchst- und Tiefstkurs der sichtbaren Kerzen auf der Preisachse" />
            <Toggle settingKey="headerPrice" label="Aktueller Kurs in der Kopfzeile" tip="Letzter Kurs und Veränderung oben neben dem Symbol" />
          </section>

          <section>
            <h3>Krypto</h3>
            <Toggle settingKey="liveLiquidations" label="Live-Liquidationen im Chart" tip="Echte Liquidationen von Binance Futures als Blasen (rot = Longs, grün = Shorts)" />
            <Toggle
              settingKey="footprint"
              label="Footprint (Kauf/Verkauf je Preis)"
              tip={"Jede Kerze in Preiszeilen: links verkauftes, rechts gekauftes Volumen, POC orange, Delta darunter\nAus Binance-Kerzen einer kleineren Zeiteinheit (Taker-Kaufvolumen); hineinzoomen für Zahlen"}
            />
          </section>

          <section>
            <h3>Zeitachse</h3>
            <Row label="Zeitzone" tip="Zeitzone für Zeitachse und Fadenkreuz">
              <select value={st.timeZone} onChange={(e) => updateSettings({ timeZone: e.target.value })}>
                {TIME_ZONES.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.label}
                  </option>
                ))}
              </select>
            </Row>
            <Toggle settingKey="showSeconds" label="Sekunden anzeigen" tip="Sekunden in Zeitachse und Fadenkreuz-Label" />
          </section>

          <section>
            <h3>Renko & Line Break</h3>
            <Row label="Renko-Boxgröße" tip={"Kursbewegung je Stein\nATR: Average True Range der letzten Kerzen (wie TradingView-Standard)"}>
              <Segmented
                value={st.renkoBox > 0 ? "fixed" : "atr"}
                onChange={(v) => updateSettings({ renkoBox: v === "atr" ? 0 : st.renkoBox || atrBox() })}
                options={[
                  { value: "atr", label: "ATR" },
                  { value: "fixed", label: "Fest" },
                ]}
              />
            </Row>
            {st.renkoBox > 0 ? (
              <Row label="Box (Preis)" tip="Feste Boxgröße in Preiseinheiten, z. B. 100 für BTC">
                <NumberInput value={st.renkoBox} min={0.00000001} onChange={(renkoBox) => updateSettings({ renkoBox })} />
              </Row>
            ) : (
              <Row label="ATR-Länge" tip="Kerzen für die ATR, Standard 14">
                <NumberInput value={st.renkoAtr} min={1} max={500} step={1} onChange={(renkoAtr) => updateSettings({ renkoAtr })} />
              </Row>
            )}
            <Row label="Line Break: Linien" tip={"Linien, die eine Umkehr durchbrechen muss\nNison: 3 (Three Line Break)"}>
              <NumberInput value={st.lineBreakLines} min={1} max={10} step={1} onChange={(lineBreakLines) => updateSettings({ lineBreakLines })} />
            </Row>
          </section>

          <section>
            <h3>Darstellung</h3>
            <Row label="Gitter" tip="Hilfslinien im Chart">
              <Segmented
                value={st.grid}
                onChange={(grid) => updateSettings({ grid })}
                options={[
                  { value: "both", label: "Beide" },
                  { value: "vert", label: "Vertikal" },
                  { value: "horz", label: "Horizontal" },
                  { value: "none", label: "Aus" },
                ]}
              />
            </Row>
            <Row label="Fadenkreuz" tip="Verhalten des Fadenkreuzes">
              <Segmented
                value={st.crosshair}
                onChange={(crosshair) => updateSettings({ crosshair })}
                options={[
                  { value: "normal", label: "Frei", tip: "Folgt der Maus frei" },
                  { value: "magnet", label: "Magnet", tip: "Rastet am Schlusskurs der Kerze ein" },
                  { value: "hidden", label: "Aus", tip: "Fadenkreuz ausblenden" },
                ]}
              />
            </Row>
          </section>
        </div>

        <div className="modal-actions">
          <button onClick={() => void exportChart(activeChart())} data-tip={"Kerzen und alle Indikatorlinien des Charts als Tabelle\n(Excel, Numbers; auch per Rechtsklick in den Chart)"}>
            ⇩ Chartdaten (CSV)
          </button>
          <button onClick={() => updateSettings(DEFAULT_SETTINGS)} data-tip="Alle Chart-Einstellungen auf Standard zurücksetzen">
            Zurücksetzen
          </button>
          <button className="send" onClick={onClose}>
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
}
