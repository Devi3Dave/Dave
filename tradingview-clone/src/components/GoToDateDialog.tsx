import { useState } from "react";
import { zonedToUtc } from "../../shared/goToDate";
import type { ChartEngine } from "../chart/ChartEngine";
import { resolveTimeZone } from "../chartSettings";
import { useChartState } from "../store";

interface Props {
  getEngine: () => ChartEngine | null;
  onClose: () => void;
}

export const OPEN_GOTO_EVENT = "chartai:open-goto";


/** Today's date and time in `tz` as the inputs want them. */
function nowIn(tz: string): { date: string; time: string } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return { date: `${v("year")}-${v("month")}-${v("day")}`, time: `${v("hour")}:${v("minute")}` };
}

const fmt = (t: number, tz: string) => new Date(t * 1000).toLocaleString("de-DE", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** TradingView's "Gehe zu" (Alt+G): scrolls the active chart to a date in the chart's time zone. */
export function GoToDateDialog({ getEngine, onClose }: Props) {
  const tz = useChartState((s) => resolveTimeZone(s.settings.timeZone));
  const interval = useChartState((s) => s.interval);
  const intraday = /^\d+[smh]$/.test(interval);
  const [{ date, time }, setValue] = useState(() => nowIn(tz));
  const [error, setError] = useState<string | null>(null);

  const go = () => {
    const t = zonedToUtc(date, intraday ? time : "00:00", tz);
    const engine = getEngine();
    if (t === null || !engine) return setError("Bitte ein gültiges Datum eingeben.");
    const r = engine.goToTime(t);
    if (r.kind === "ok") return onClose();
    if (r.kind === "before") setError(`So weit zurück sind keine Kerzen geladen. Die erste Kerze ist vom ${fmt(r.first, tz)}. Eine größere Zeiteinheit reicht weiter zurück.`);
    else if (r.kind === "after") setError(`Das Datum liegt nach der letzten Kerze (${fmt(r.last, tz)}).`);
    else setError("Keine Kursdaten geladen.");
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal goto-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Gehe zu">
        <div className="modal-head">
          <h2>Gehe zu</h2>
          <button onClick={onClose} data-tip="Schließen" aria-label="Schließen">
            ✕
          </button>
        </div>
        <form
          className="goto-form"
          onSubmit={(e) => {
            e.preventDefault();
            go();
          }}
        >
          <label>
            Datum
            <input type="date" value={date} autoFocus onChange={(e) => (setValue({ date: e.target.value, time }), setError(null))} />
          </label>
          {intraday && (
            <label>
              Uhrzeit
              <input type="time" value={time} onChange={(e) => (setValue({ date, time: e.target.value }), setError(null))} />
            </label>
          )}
          <div className="goto-hint">Zeitzone {tz}</div>
          {error && <div className="goto-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Abbrechen
            </button>
            <button className="send" type="submit">
              Gehe zu
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
