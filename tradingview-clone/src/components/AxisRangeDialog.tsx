import { useState } from "react";
import { zonedToUtc } from "../../shared/goToDate";
import { intervalSeconds } from "../../shared/marketData";
import { SPAN_PRESETS, SPAN_UNITS, checkPriceRange, formatSpan, parseNumber, spanSeconds, splitSpan, type SpanUnit } from "../../shared/viewRange";
import type { ChartEngine } from "../chart/ChartEngine";
import { resolveTimeZone } from "../chartSettings";
import { updateSettings, useChartState } from "../store";

interface Props {
  getEngine: () => ChartEngine | null;
  onClose: () => void;
}

export const OPEN_AXIS_EVENT = "chartai:open-axis";

/** Date and time of unix seconds in `tz` as the inputs want them. */
function inputsAt(t: number, tz: string): { date: string; time: string } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t * 1000));
  const v = (k: string) => p.find((x) => x.type === k)?.value ?? "00";
  return { date: `${v("year")}-${v("month")}-${v("day")}`, time: `${v("hour")}:${v("minute")}` };
}

const fmt = (t: number, tz: string) => new Date(t * 1000).toLocaleString("de-DE", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Up to 8 significant digits, German decimal comma, no thousands dots (easy to edit). */
const priceText = (v: number) => String(Number(v.toPrecision(8))).replace(".", ",");

/**
 * Axis settings: how much time the x axis shows (a span or a from–to window) and
 * which prices the y axis shows (auto or a fixed min–max).
 */
export function AxisRangeDialog({ getEngine, onClose }: Props) {
  const tz = useChartState((s) => resolveTimeZone(s.settings.timeZone));
  const viewSpan = useChartState((s) => s.settings.viewSpan);
  const interval = useChartState((s) => s.interval);
  const scaleMode = useChartState((s) => s.settings.scaleMode);
  const intraday = intervalSeconds(interval) < 86400;
  const engine = getEngine();

  const [mode, setMode] = useState<"span" | "window">("span");
  const initial = splitSpan(viewSpan > 0 ? viewSpan : 2 * 86400);
  const [value, setValue] = useState(String(initial.value));
  const [unit, setUnit] = useState<SpanUnit>(initial.unit);
  const loaded = engine?.loadedTimes() ?? null;
  const [from, setFrom] = useState(() => inputsAt(loaded ? Math.max(loaded.first, loaded.last - 2 * 86400) : Date.now() / 1000 - 2 * 86400, tz));
  const [to, setTo] = useState(() => inputsAt(loaded ? loaded.last : Date.now() / 1000, tz));
  const [timeMsg, setTimeMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const current = engine?.priceRange() ?? null;
  const [auto, setAuto] = useState(() => engine?.isAutoScale() ?? true);
  const [min, setMin] = useState(current ? priceText(current.min) : "");
  const [max, setMax] = useState(current ? priceText(current.max) : "");
  const [priceMsg, setPriceMsg] = useState<{ text: string; error?: boolean } | null>(null);

  /** Hint for a span on the loaded candles: too short for the timeframe, or longer than the history. */
  const spanHint = (seconds: number): { text: string; error?: boolean } => {
    const w = engine?.spanWindow(seconds);
    const label = formatSpan(seconds);
    if (!w) return { text: `Zeitachse zeigt jetzt ${label}.` };
    if (w.widened) return { text: `${label} ist kürzer als ${w.bars} Kerzen dieser Zeiteinheit. Für mehr Details eine kleinere Zeiteinheit wählen (z. B. 1m).`, error: true };
    if (w.clippedStart && loaded) return { text: `So viel Verlauf ist nicht geladen: Der Chart zeigt alles ab ${fmt(loaded.first, tz)}. Eine größere Zeiteinheit reicht weiter zurück.`, error: true };
    return { text: `Zeitachse zeigt jetzt ${label} (${w.bars} Kerzen). Gilt auch nach Wechsel von Symbol oder Zeiteinheit und bei ⟲.` };
  };

  const applySpan = (seconds: number) => {
    const s = splitSpan(seconds);
    setValue(String(s.value));
    setUnit(s.unit);
    updateSettings({ viewSpan: seconds });
    setTimeMsg(spanHint(seconds));
  };

  const applyCustomSpan = () => {
    const seconds = spanSeconds(parseNumber(value), unit);
    if (seconds === null) return setTimeMsg({ text: "Bitte eine Zahl größer als 0 eingeben.", error: true });
    applySpan(seconds);
  };

  const applyWindow = () => {
    const a = zonedToUtc(from.date, intraday ? from.time : "00:00", tz);
    // A date without time means the whole day.
    const b = zonedToUtc(to.date, intraday ? to.time : "00:00", tz);
    if (a === null || b === null) return setTimeMsg({ text: "Bitte gültige Daten eingeben.", error: true });
    const end = intraday ? b + 1 : b + 86400;
    if (!(end > a)) return setTimeMsg({ text: "„Bis“ muss nach „Von“ liegen.", error: true });
    const w = engine?.showTimes(a, end);
    if (!w) {
      const range = loaded ? ` Geladen: ${fmt(loaded.first, tz)} bis ${fmt(loaded.last, tz)}.` : "";
      return setTimeMsg({ text: `In diesem Zeitraum sind keine Kerzen geladen.${range}`, error: true });
    }
    if (w.clippedStart && loaded) setTimeMsg({ text: `Angezeigt ab der ersten geladenen Kerze (${fmt(loaded.first, tz)}), ${w.bars} Kerzen.`, error: true });
    else if (w.widened) setTimeMsg({ text: `Der Zeitraum ist kürzer als eine Kerze; der Chart zeigt ${w.bars} Kerzen. Eine kleinere Zeiteinheit zeigt mehr Details.`, error: true });
    else setTimeMsg({ text: `${w.bars} Kerzen angezeigt. Scrollen und Zoomen ändert den Ausschnitt wieder.` });
  };

  const applyPrice = () => {
    const lo = parseNumber(min);
    const hi = parseNumber(max);
    const err = checkPriceRange(lo, hi);
    if (err) return setPriceMsg({ text: err, error: true });
    engine?.setPriceRange(lo, hi);
    setAuto(false);
    setPriceMsg({ text: "Preisachse fest eingestellt. „A“ unten an der Preisachse oder „Auto“ hier schaltet zurück." });
  };

  const setAutoPrice = () => {
    engine?.autoScale();
    setAuto(true);
    setPriceMsg({ text: "Preisachse passt sich wieder automatisch an die sichtbaren Kerzen an." });
  };

  const takeCurrent = () => {
    const r = engine?.priceRange();
    if (!r) return;
    setMin(priceText(r.min));
    setMax(priceText(r.max));
    setPriceMsg(null);
  };

  const presetSeconds = SPAN_PRESETS.map((p) => spanSeconds(p.value, p.unit)!);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal axis-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Achsen einstellen">
        <div className="modal-head">
          <h2>Achsen einstellen</h2>
          <button onClick={onClose} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="axis-body">
          <section>
            <h3>Zeitachse (X)</h3>
            <div className="axis-tabs" role="tablist">
              <button role="tab" className={mode === "span" ? "active" : ""} onClick={() => (setMode("span"), setTimeMsg(null))}>
                Letzter Zeitraum
              </button>
              <button role="tab" className={mode === "window" ? "active" : ""} onClick={() => (setMode("window"), setTimeMsg(null))}>
                Von – Bis
              </button>
            </div>
            {mode === "span" ? (
              <>
                <div className="axis-presets">
                  <button className={viewSpan === 0 ? "active" : ""} onClick={() => (updateSettings({ viewSpan: 0 }), setTimeMsg({ text: "Standard: die letzten rund 160 Kerzen." }))} data-tip="Die letzten rund 160 Kerzen (wie bisher)">
                    Standard
                  </button>
                  {SPAN_PRESETS.map((p, i) => (
                    <button key={p.label} className={viewSpan === presetSeconds[i] ? "active" : ""} onClick={() => applySpan(presetSeconds[i])}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <form
                  className="axis-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    applyCustomSpan();
                  }}
                >
                  <span className="axis-label">Eigener:</span>
                  <input className="axis-num" inputMode="decimal" value={value} onChange={(e) => (setValue(e.target.value), setTimeMsg(null))} aria-label="Anzahl" />
                  <select value={unit} onChange={(e) => (setUnit(e.target.value as SpanUnit), setTimeMsg(null))} aria-label="Einheit">
                    {SPAN_UNITS.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                  <button className="send" type="submit">
                    Anzeigen
                  </button>
                </form>
              </>
            ) : (
              <form
                className="axis-window"
                onSubmit={(e) => {
                  e.preventDefault();
                  applyWindow();
                }}
              >
                <label>
                  Von
                  <span className="axis-dt">
                    <input type="date" value={from.date} onChange={(e) => (setFrom({ ...from, date: e.target.value }), setTimeMsg(null))} />
                    {intraday && <input type="time" value={from.time} onChange={(e) => (setFrom({ ...from, time: e.target.value }), setTimeMsg(null))} />}
                  </span>
                </label>
                <label>
                  Bis
                  <span className="axis-dt">
                    <input type="date" value={to.date} onChange={(e) => (setTo({ ...to, date: e.target.value }), setTimeMsg(null))} />
                    {intraday && <input type="time" value={to.time} onChange={(e) => (setTo({ ...to, time: e.target.value }), setTimeMsg(null))} />}
                  </span>
                </label>
                <div className="axis-row">
                  <span className="goto-hint">Zeitzone {tz}</span>
                  <button className="send" type="submit">
                    Anzeigen
                  </button>
                </div>
              </form>
            )}
            {timeMsg && <div className={timeMsg.error ? "goto-error" : "goto-hint"}>{timeMsg.text}</div>}
          </section>
          <section>
            <h3>Preisachse (Y)</h3>
            <div className="axis-tabs" role="tablist">
              <button role="tab" className={auto ? "active" : ""} onClick={setAutoPrice}>
                Auto
              </button>
              <button role="tab" className={!auto ? "active" : ""} onClick={applyPrice}>
                Manuell
              </button>
            </div>
            <form
              className="axis-row"
              onSubmit={(e) => {
                e.preventDefault();
                applyPrice();
              }}
            >
              <label className="axis-inline">
                Min
                <input className="axis-price" inputMode="decimal" value={min} onChange={(e) => (setMin(e.target.value), setPriceMsg(null))} />
              </label>
              <label className="axis-inline">
                Max
                <input className="axis-price" inputMode="decimal" value={max} onChange={(e) => (setMax(e.target.value), setPriceMsg(null))} />
              </label>
              <button type="button" onClick={takeCurrent} data-tip="Aktuell sichtbaren Bereich übernehmen">
                ⤓
              </button>
              <button className="send" type="submit">
                Festlegen
              </button>
            </form>
            {(scaleMode === "percent" || scaleMode === "indexed") && <div className="goto-hint">Bei {scaleMode === "percent" ? "Prozent" : "Index"}-Skala sind Min und Max Werte dieser Skala, nicht Preise.</div>}
            {priceMsg && <div className={priceMsg.error ? "goto-error" : "goto-hint"}>{priceMsg.text}</div>}
          </section>
        </div>
        <div className="modal-actions">
          <button className="send" onClick={onClose}>
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
}
