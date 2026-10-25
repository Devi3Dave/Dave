import { useEffect, useState } from "react";
import {
  EXCHANGES,
  clock,
  dayShift,
  formatDuration,
  holidayName,
  localTimeZone,
  marketStatus,
  nextClockChange,
  tradingDays,
  upcomingHolidays,
  wallTime,
  zoneOffset,
  zonedToUtc,
  type Exchange,
} from "../../shared/exchanges";
import { INTERVAL_SECONDS } from "../../shared/marketData";
import { resolveTimeZone } from "../chartSettings";
import { setSelectedExchanges, toggleExchange, useSelectedExchanges } from "../exchangeSelection";
import { updateSettings, useChartState } from "../store";

const nowSec = () => Math.floor(Date.now() / 1000);

function useNow(): number {
  const [now, setNow] = useState(nowSec);
  useEffect(() => {
    const t = window.setInterval(() => setNow(nowSec()), 15000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function offsetLabel(min: number): string {
  const sign = min < 0 ? "−" : "+";
  const a = Math.abs(min);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""}`;
}

function zoneName(tz: string, sec: number): string {
  const part = new Intl.DateTimeFormat("de-DE", { timeZone: tz, timeZoneName: "long" }).formatToParts(new Date(sec * 1000)).find((p) => p.type === "timeZoneName");
  return part?.value ?? tz;
}

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
};

/** The viewer's local date of an instant, "YYYY-MM-DD". */
function localDate(sec: number, tz: string): string {
  const w = wallTime(sec * 1000, tz);
  return `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

/** Minutes since local midnight. */
function minuteOfDay(sec: number, tz: string): number {
  const w = wallTime(sec * 1000, tz);
  return w.hh * 60 + w.mm;
}

/** 24-hour strip of the viewer's day with the exchange's trading parts and the current time. */
function DayStrip({ ex, now, tz, at }: { ex: Exchange; now: number; tz: string; at: number }) {
  // The viewer's calendar day that contains the shown session.
  const w = wallTime(at * 1000, tz);
  const dayStart = zonedToUtc(w.y, w.m, w.d, 0, 0, tz) / 1000;
  const dayEnd = zonedToUtc(w.y, w.m, w.d + 1, 0, 0, tz) / 1000;
  const segments: { left: number; width: number }[] = [];
  for (const day of tradingDays(ex, dayStart, dayEnd)) {
    for (const p of day.parts) {
      const s = Math.max(p.start, dayStart);
      const e = Math.min(p.end, dayEnd);
      if (e <= s) continue;
      const left = minuteOfDay(s, tz);
      const width = e >= dayEnd ? 1440 - left : minuteOfDay(e, tz) - left;
      if (width > 0) segments.push({ left: (left / 1440) * 100, width: (width / 1440) * 100 });
    }
  }
  const nowLeft = now >= dayStart && now < dayEnd ? (minuteOfDay(now, tz) / 1440) * 100 : null;
  return (
    <div className="ex-strip" data-tip={"Der Handelstag auf deiner Uhr (0–24 Uhr)\nfarbig = Börse offen, weiße Linie = jetzt"}>
      {[6, 12, 18].map((h) => (
        <span key={h} className="ex-strip-tick" style={{ left: `${(h / 24) * 100}%` }}>
          {h}
        </span>
      ))}
      {segments.map((s, i) => (
        <span key={i} className="ex-strip-seg" style={{ left: `${s.left}%`, width: `${s.width}%`, background: ex.color }} />
      ))}
      {nowLeft !== null && <span className="ex-strip-now" style={{ left: `${nowLeft}%` }} />}
    </div>
  );
}

function ExchangeRow({ ex, now, tz, checked }: { ex: Exchange; now: number; tz: string; checked: boolean }) {
  const status = marketStatus(ex, now);
  const day = status.day;
  const change = nextClockChange(ex, now, tz);
  const sameZone = zoneOffset(now * 1000, ex.timeZone) === zoneOffset(now * 1000, tz);
  const holidayToday = holidayName(ex, localDate(now, ex.timeZone));
  const nextHoliday = upcomingHolidays(ex, now).find((h) => h.date > localDate(now, ex.timeZone));
  const [statusText, statusSub] =
    status.phase === "open"
      ? ["● Offen", `schließt in ${formatDuration(status.next - now)}`]
      : status.phase === "lunch"
        ? ["◐ Mittagspause", `weiter in ${formatDuration(status.next - now)}`]
        : [holidayToday ? `○ Feiertag: ${holidayToday}` : "○ Geschlossen", `öffnet in ${formatDuration(status.next - now)}`];
  const openDate = day ? localDate(day.open, tz) : "";
  const today = openDate === localDate(now, tz);

  return (
    <label className={`ex-row ${checked ? "on" : ""}`} style={{ borderLeftColor: ex.color }}>
      <input type="checkbox" checked={checked} onChange={() => toggleExchange(ex.id)} aria-label={`${ex.short} im Chart zeigen`} />
      <div className="ex-name">
        <strong>
          {ex.country} {ex.short}
        </strong>
        <span className="ex-muted">{ex.name}</span>
      </div>
      <div className={`ex-status ${status.phase}`}>
        {statusText}
        <span className="ex-muted">{statusSub}</span>
      </div>
      <div className="ex-times">
        {day ? (
          <>
            <div>
              <span className="ex-muted">{today ? "Heute" : fmtDate(openDate)}, deine Zeit: </span>
              <strong>
                {clock(day.open, tz)}–{clock(day.close, tz)}
              </strong>
              {dayShift(day.open, day.date, tz) !== 0 && <span className="ex-muted"> · Börsentag {fmtDate(day.date)}</span>}
              {day.parts.length > 1 && (
                <span className="ex-muted">
                  {" "}
                  · Pause {clock(day.parts[0].end, tz)}–{clock(day.parts[1].start, tz)}
                </span>
              )}
            </div>
            {!sameZone && (
              <div className="ex-muted">
                Vor Ort ({ex.city}): {ex.open}–{ex.close} · {offsetLabel(zoneOffset(now * 1000, ex.timeZone))}
              </div>
            )}
            {change && (
              <div className="ex-change">
                ⏰ Zeitumstellung: ab {fmtDate(change.date)} {change.open}–{change.close}
              </div>
            )}
            {nextHoliday && (
              <div className="ex-muted">
                🎌 Feiertag {fmtDate(nextHoliday.date)}: {nextHoliday.name} (geschlossen)
              </div>
            )}
          </>
        ) : (
          <span className="ex-muted">–</span>
        )}
      </div>
      <DayStrip ex={ex} now={now} tz={tz} at={day?.open ?? now} />
    </label>
  );
}

export function ExchangesView({ onClose }: { onClose: () => void }) {
  const now = useNow();
  const selected = useSelectedExchanges();
  const tz = localTimeZone();
  const interval = useChartState((s) => s.interval);
  const chartTz = useChartState((s) => s.settings.timeZone);
  const offset = zoneOffset(now * 1000, tz);
  const openCount = EXCHANGES.filter((e) => marketStatus(e, now).phase === "open").length;
  const daily = (INTERVAL_SECONDS[interval] ?? 0) >= 86400;
  const chartZoneDiffers = resolveTimeZone(chartTz) !== tz;

  return (
    <div className="heatmap-view calc-view ex-view">
      <div className="heatmap-head">
        <strong>Börsenzeiten</strong>
        <span className="heatmap-symbol">
          {openCount} von {EXCHANGES.length} Börsen gerade offen
        </span>
        <div className="spacer" />
        {selected.length > 0 && (
          <button onClick={() => setSelectedExchanges([])} data-tip="Keine Börsenzeiten mehr im Chart zeigen">
            Auswahl leeren
          </button>
        )}
        <button className="pill" onClick={onClose} data-tip="Zurück zum Chart">
          ✕ Chart
        </button>
      </div>

      <div className="calc-body">
        <div className="ex-zone">
          <div>
            <span className="ex-muted">Deine Zeitzone (automatisch erkannt): </span>
            <strong>{tz.replace(/_/g, " ")}</strong> · {zoneName(tz, now)} ({offsetLabel(offset)})
          </div>
          <div className="ex-clock">{clock(now, tz)} Uhr</div>
        </div>

        <p className="calc-intro">
          Hake die Börsen an, deren Handelszeiten du im Chart sehen willst. Sie erscheinen dort als farbige Bereiche mit gestrichelten Linien
          bei Eröffnung und Schluss – in jedem Chart und jeder Zeiteinheit bis 4 h. Alle Zeiten werden in deine Zeitzone umgerechnet, Sommer-
          und Winterzeit (auch wenn Börse und du an verschiedenen Tagen umstellen) sind berücksichtigt. An Wochenenden und an den Feiertagen des
          jeweiligen Börsenlandes (z. B. Karfreitag, Thanksgiving, Chinesisches Neujahr) ist die Börse geschlossen und erscheint nicht im Chart.
          Kurzfristige Sonderschließungen und verkürzte Handelstage kennt die App nicht.
        </p>

        {daily && selected.length > 0 && (
          <div className="jr-verdict">Im Tages- oder Wochenchart ist eine Kerze schon ein ganzer Handelstag. Die Börsenzeiten siehst du ab 4 h abwärts.</div>
        )}
        {chartZoneDiffers && (
          <div className="jr-verdict">
            Die Zeitachse des aktiven Charts steht auf {chartTz}. Die Börsenbereiche stimmen trotzdem, nur die Uhrzeiten an der Achse weichen von
            dieser Liste ab.{" "}
            <button className="pill" onClick={() => updateSettings({ timeZone: "local" })}>
              Chart auf meine Zeitzone stellen
            </button>
          </div>
        )}

        <div className="ex-list">
          {EXCHANGES.map((ex) => (
            <ExchangeRow key={ex.id} ex={ex} now={now} tz={tz} checked={selected.includes(ex.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}
