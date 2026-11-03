import { useState, type ReactNode } from "react";
import { PALETTE_HUES, PALETTE_SHADES, TV_PALETTE, presetsFor, readableOn, resolveCandleColors, type CandlePair, type ChartTheme } from "../../shared/candleColors";
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

/** TradingView's palette as a grid (hues across, shades down); colours too faint on the background are left out. */
function PaletteGrid({ theme, value, onPick }: { theme: ChartTheme; value: string; onPick: (c: string) => void }) {
  return (
    <div className="candle-palette" role="listbox">
      {PALETTE_SHADES.filter((shade) => PALETTE_HUES.some((h) => readableOn(TV_PALETTE[`${h.id}-${shade}`], theme))).map((shade) =>
        PALETTE_HUES.map((h) => {
          const c = TV_PALETTE[`${h.id}-${shade}`];
          if (!readableOn(c, theme)) return <span key={h.id + shade} className="candle-swatch empty" />;
          return (
            <button
              key={h.id + shade}
              role="option"
              aria-selected={c === value}
              aria-label={`${h.label} ${shade} ${c}`}
              data-tip={`${h.label} ${shade}\n${c.toUpperCase()}`}
              className={`candle-swatch${c === value ? " active" : ""}`}
              style={{ background: c }}
              onClick={() => onPick(c)}
            />
          );
        }),
      )}
    </div>
  );
}

/** Background and candle colours; each background keeps its own pair. */
function CandleColorsSection() {
  const st = useChartState((s) => s.settings);
  const theme: ChartTheme = st.chartTheme === "light" ? "light" : "dark";
  const colors = resolveCandleColors(theme, st.candleColors);
  const [open, setOpen] = useState<"up" | "down" | null>(null);
  const set = (pair: CandlePair) => updateSettings({ candleColors: { ...st.candleColors, [theme]: pair } });
  const pickerRow = (side: "up" | "down", label: string) => (
    <>
      <Row label={label} tip={side === "up" ? "Kerzen, die über dem Eröffnungskurs schließen" : "Kerzen, die unter dem Eröffnungskurs schließen"}>
        <button className={`candle-color-btn${open === side ? " active" : ""}`} onClick={() => setOpen(open === side ? null : side)} data-tip="Farbe aus der TradingView-Palette wählen">
          <span className="candle-swatch" style={{ background: colors[side] }} />
          {colors[side].toUpperCase()}
        </button>
      </Row>
      {open === side && <PaletteGrid theme={theme} value={colors[side]} onPick={(c) => set({ ...colors, [side]: c })} />}
    </>
  );
  return (
    <section>
      <h3>Hintergrund & Kerzen</h3>
      <Row label="Hintergrund" tip={"Dunkler oder heller Chart wie bei TradingView\nKerzenfarben werden je Hintergrund getrennt gespeichert"}>
        <Segmented
          value={theme}
          onChange={(chartTheme) => updateSettings({ chartTheme })}
          options={[
            { value: "dark", label: "Dunkel" },
            { value: "light", label: "Hell" },
          ]}
        />
      </Row>
      <Row label="Vorlage" tip={"TradingView-Standardpaare\nNur Paare, die auf diesem Hintergrund gut lesbar sind"}>
        <div className="segmented">
          {presetsFor(theme).map((p) => (
            <button key={p.id} className={p.up === colors.up && p.down === colors.down ? "active" : ""} data-tip={p.tip} onClick={() => set({ up: p.up, down: p.down })}>
              <span className="candle-swatch mini" style={{ background: p.up }} />
              <span className="candle-swatch mini" style={{ background: p.down }} /> {p.label}
            </button>
          ))}
        </div>
      </Row>
      {pickerRow("up", "Steigend")}
      {pickerRow("down", "Fallend")}
      <p className="settings-note">
        Nur Farben aus der TradingView-Palette, die auf {theme === "light" ? "hellem" : "dunklem"} Hintergrund mindestens 3:1 Kontrast haben (WCAG 2.1).
      </p>
    </section>
  );
}

export function ChartSettingsDialog({ onClose }: { onClose: () => void }) {
  const st = useChartState((s) => s.settings);
  const bars = useChartState((s) => s.bars);
  // Switching to a fixed box starts from the current ATR, rounded to two digits.
  const atrBox = () => +renkoBoxSize(bars, 0, st.renkoAtr).toPrecision(2) || 1;
  /** ATR or a fixed price for one size; 0 in the settings means ATR. */
  const sizeRows = (key: "renkoBox" | "kagiReversal" | "pnfBox" | "rangeSize", label: string, tip: string) => (
    <>
      <Row label={label} tip={`${tip}\nATR: Average True Range der letzten Kerzen (wie TradingView-Standard)`}>
        <Segmented
          value={st[key] > 0 ? "fixed" : "atr"}
          onChange={(v) => updateSettings({ [key]: v === "atr" ? 0 : st[key] || atrBox() })}
          options={[
            { value: "atr", label: "ATR" },
            { value: "fixed", label: "Fest" },
          ]}
        />
      </Row>
      {st[key] > 0 && (
        <Row label="Größe (Preis)" tip="Feste Größe in Preiseinheiten, z. B. 100 für BTC">
          <NumberInput value={st[key]} min={0.00000001} onChange={(v) => updateSettings({ [key]: v })} />
        </Row>
      )}
    </>
  );

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
            <h3>Preisbasierte Charttypen</h3>
            {sizeRows("renkoBox", "Renko-Boxgröße", "Kursbewegung je Stein")}
            {sizeRows("kagiReversal", "Kagi-Umkehrbetrag", "Gegenbewegung, ab der die Kagi-Linie dreht (Nison)")}
            {sizeRows("pnfBox", "P&F-Boxgröße", "Preis je X oder O")}
            <Row label="P&F-Umkehr (Boxen)" tip={"Boxen, die eine neue Spalte braucht\nDorsey, du Plessis: 3"}>
              <NumberInput value={st.pnfReversal} min={1} max={10} step={1} onChange={(pnfReversal) => updateSettings({ pnfReversal })} />
            </Row>
            <Row label="P&F-Quelle" tip={"Hoch/Tief: Hochs füllen X, Tiefs füllen O (du Plessis)\nSchluss: nur Schlusskurse"}>
              <Segmented
                value={st.pnfSource}
                onChange={(pnfSource) => updateSettings({ pnfSource })}
                options={[
                  { value: "hl", label: "Hoch/Tief" },
                  { value: "close", label: "Schluss" },
                ]}
              />
            </Row>
            {sizeRows("rangeSize", "Range-Größe", "Hoch bis Tief jeder Range-Kerze")}
            <Row label="ATR-Länge" tip="Kerzen für die ATR aller Größen auf „ATR“, Standard 14 (wie TradingView)">
              <NumberInput value={st.renkoAtr} min={1} max={500} step={1} onChange={(renkoAtr) => updateSettings({ renkoAtr })} />
            </Row>
            <Row label="Line Break: Linien" tip={"Linien, die eine Umkehr durchbrechen muss\nNison: 3 (Three Line Break)"}>
              <NumberInput value={st.lineBreakLines} min={1} max={10} step={1} onChange={(lineBreakLines) => updateSettings({ lineBreakLines })} />
            </Row>
          </section>

          <CandleColorsSection />

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
