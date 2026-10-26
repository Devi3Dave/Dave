import { useEffect, useMemo, useState } from "react";
import {
  CONDITION_LABELS,
  FREQUENCY_LABELS,
  describeAlert,
  isChannelCondition,
  type AlertCondition,
  type AlertFrequency,
  type AlertSource,
} from "../../shared/alerts";
import { getIndicator, indicatorLabel, resolveParams } from "../../shared/indicators";
import {
  clearAlertLog,
  createAlert,
  deleteAlert,
  dismissAlertEvent,
  notificationsSupported,
  requestNotifications,
  resumeAlert,
  updateAlert,
  updateAlertSettings,
  useAlerts,
  type AlertLogEntry,
} from "../alerts";
import { formatPrice } from "../chart/DrawingsPrimitive";
import { loadChart, useChartState, type Interval } from "../store";

const parseNum = (s: string) => (s.trim() === "" ? undefined : Number(s.trim().replace(/\s/g, "").replace(",", ".")));
const showNum = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "" : String(+v.toPrecision(8)).replace(".", ","));
const clock = (ms: number) => new Date(ms).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const CONDITIONS = Object.keys(CONDITION_LABELS) as AlertCondition[];
const FREQUENCIES = Object.keys(FREQUENCY_LABELS) as AlertFrequency[];

interface SourceOption {
  key: string;
  label: string;
  source: AlertSource;
  /** Latest value, to prefill the level. */
  last: number | null;
}

/** Price plus every line of the active chart's indicators. */
function useSourceOptions(): SourceOption[] {
  const bars = useChartState((s) => s.bars);
  const indicators = useChartState((s) => s.indicators);
  return useMemo(() => {
    const options: SourceOption[] = [{ key: "price", label: "Kurs", source: { kind: "price" }, last: bars[bars.length - 1]?.close ?? null }];
    for (const inst of indicators) {
      const def = getIndicator(inst.type);
      if (!def) continue;
      const lines = def.outputs.filter((o) => !o.helper && !o.sparse);
      if (!lines.length) continue;
      const params = resolveParams(def, inst.params);
      const name = indicatorLabel(def, params);
      const out = bars.length ? def.compute(bars, params) : {};
      for (const o of lines) {
        const label = lines.length > 1 ? `${name} · ${o.label}` : name;
        const values = out[o.key] ?? [];
        options.push({ key: `${inst.id}:${o.key}`, label, source: { kind: "indicator", type: inst.type, params, output: o.key, label }, last: values[values.length - 1] ?? null });
      }
    }
    return options;
  }, [bars, indicators]);
}

function AlertForm() {
  const symbol = useChartState((s) => s.symbol);
  const interval = useChartState((s) => s.interval);
  const source = useChartState((s) => s.source);
  const replay = useChartState((s) => s.replay !== null);
  const options = useSourceOptions();
  const [sourceKey, setSourceKey] = useState("price");
  const [condition, setCondition] = useState<AlertCondition>("crossing");
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState("");
  const [frequency, setFrequency] = useState<AlertFrequency>("once");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const option = options.find((o) => o.key === sourceKey) ?? options[0];
  const channel = isChannelCondition(condition);

  // A new asset or line: start from its current value.
  useEffect(() => {
    setValue(showNum(option.last));
    setValue2("");
  }, [symbol, sourceKey]);
  useEffect(() => {
    if (!value && option.last !== null) setValue(showNum(option.last));
  }, [option.last]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const v1 = parseNum(value);
  const v2 = parseNum(value2);
  const valid = v1 !== undefined && Number.isFinite(v1) && (!channel || (v2 !== undefined && Number.isFinite(v2)));

  const submit = () => {
    if (!valid) return;
    const a = createAlert({
      symbol,
      interval,
      source: option.source,
      condition,
      target: channel ? { kind: "channel", top: Math.max(v1!, v2!), bottom: Math.min(v1!, v2!) } : { kind: "value", value: v1! },
      frequency,
      message: message.trim(),
    });
    setMessage("");
    setNotice(`Alarm erstellt: ${describeAlert(a)}`);
  };

  return (
    <section className="al-form">
      <h3>Neuer Alarm</h3>
      <div className="dm-muted">
        {symbol} · {interval}
        {source === "demo" && " · ⚠ Demo-Daten: der Alarm prüft nur echte Kurse"}
        {replay && " · Replay läuft: geprüft wird der Live-Kurs"}
      </div>
      <label className="calc-field">
        <span>Bedingung</span>
        <div className="al-row">
          <select value={option.key} onChange={(e) => setSourceKey(e.target.value)} aria-label="Quelle">
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={condition} onChange={(e) => setCondition(e.target.value as AlertCondition)} aria-label="Bedingung">
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      </label>
      <div className="calc-inputs">
        <label className="calc-field">
          <span>{channel ? "Obere Kante" : "Wert"}</span>
          <div className="calc-input">
            <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        </label>
        {channel && (
          <label className="calc-field">
            <span>Untere Kante</span>
            <div className="calc-input">
              <input inputMode="decimal" value={value2} onChange={(e) => setValue2(e.target.value)} />
            </div>
          </label>
        )}
      </div>
      {option.last !== null && (
        <div className="calc-examples">
          <span>Aktuell {formatPrice(option.last)}:</span>
          {[-2, -1, 1, 2].map((p) => (
            <button key={p} onClick={() => setValue(showNum(option.last! * (1 + p / 100)))}>
              {p > 0 ? "+" : ""}
              {p} %
            </button>
          ))}
        </div>
      )}
      <div className="dm-label">Auslösen</div>
      <div className="jr-seg">
        {FREQUENCIES.map((f) => (
          <button key={f} className={frequency === f ? "active" : ""} onClick={() => setFrequency(f)}>
            {FREQUENCY_LABELS[f]}
          </button>
        ))}
      </div>
      <label className="calc-field">
        <span>Nachricht (optional)</span>
        <div className="calc-input">
          <input value={message} placeholder="z. B. Ausbruch prüfen" onChange={(e) => setMessage(e.target.value)} />
        </div>
      </label>
      <button className="dm-primary al-submit" disabled={!valid} onClick={submit}>
        🔔 Alarm erstellen
      </button>
      {notice && <div className="dm-muted al-notice">{notice}</div>}
    </section>
  );
}

function LogRow({ e }: { e: AlertLogEntry }) {
  return (
    <div className="al-log">
      <span className="dm-muted">{clock(e.at)}</span>
      <span>
        {e.text} <strong>({formatPrice(e.value)})</strong>
        {e.message && <em> – {e.message}</em>}
      </span>
    </div>
  );
}

/** Side-panel tab: create alerts, the list of alerts and what fired. */
export function AlertsPanel() {
  const alerts = useAlerts((s) => s.alerts);
  const log = useAlerts((s) => s.log);
  const settings = useAlerts((s) => s.settings);
  const chartSymbol = useChartState((s) => s.symbol);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const active = alerts.filter((a) => a.active).length;

  return (
    <div className="dm al">
      <AlertForm />

      <section>
        <h3>
          Alarme <span className="dm-muted">({active} aktiv)</span>
        </h3>
        {alerts.length === 0 && <div className="dm-muted">Noch keine Alarme. Auch per Rechtsklick / langem Drücken auf eine Linie, Trendlinie oder Zone.</div>}
        {alerts.map((a) => (
          <div key={a.id} className={`al-item ${a.active ? "" : "off"}`}>
            <div className="al-item-text">
              <button className="dm-sym" onClick={() => a.symbol !== chartSymbol && void loadChart(a.symbol, a.interval as Interval)} data-tip="Im Chart öffnen">
                {a.symbol}
              </button>{" "}
              {describeAlert(a).slice(a.symbol.length + 1)}
              <div className="dm-muted dm-small">
                {a.interval} · {FREQUENCY_LABELS[a.frequency]}
                {a.drawing && " · folgt der Zeichnung"}
                {!a.active && " · aus"}
                {a.message && ` · „${a.message}“`}
              </div>
            </div>
            <div className="dm-row-actions">
              {a.active ? (
                <button onClick={() => updateAlert(a.id, { active: false })} data-tip="Pausieren">
                  ⏸
                </button>
              ) : (
                <button onClick={() => resumeAlert(a.id)} data-tip="Wieder aktivieren">
                  ▶
                </button>
              )}
              <button onClick={() => deleteAlert(a.id)} data-tip="Löschen" aria-label="Löschen">
                🗑
              </button>
            </div>
          </div>
        ))}
      </section>

      <section>
        <h3>Benachrichtigung</h3>
        <label className="menu-check">
          <input type="checkbox" checked={settings.sound} onChange={(e) => updateAlertSettings({ sound: e.target.checked })} /> Ton abspielen
        </label>
        {notificationsSupported() && (
          <label className="menu-check">
            <input
              type="checkbox"
              checked={settings.notify}
              onChange={async (e) => {
                if (!e.target.checked) return updateAlertSettings({ notify: false });
                setNotifyError((await requestNotifications()) ? null : "Mitteilungen wurden im Browser nicht erlaubt");
              }}
            />{" "}
            Systemmitteilung
          </label>
        )}
        {notifyError && <div className="dm-muted down">{notifyError}</div>}
        <div className="dm-muted dm-small">
          Alarme werden geprüft, solange ChartAI geöffnet ist (auch im Hintergrund-Tab). Bei geschlossener App kann nichts auslösen – dafür bräuchte es
          einen eigenen Server.
        </div>
      </section>

      <section>
        <h3>
          Verlauf
          {log.length > 0 && (
            <button className="pill al-clear" onClick={clearAlertLog}>
              Leeren
            </button>
          )}
        </h3>
        {log.length === 0 ? <div className="dm-muted">Noch nichts ausgelöst.</div> : [...log].reverse().slice(0, 30).map((e) => <LogRow key={e.id} e={e} />)}
      </section>
    </div>
  );
}

/** Fired alerts as toasts, wherever you are in the app. */
export function AlertToasts({ onOpen }: { onOpen: () => void }) {
  const events = useAlerts((s) => s.events);
  useEffect(() => {
    if (!events.length) return;
    const t = setTimeout(() => dismissAlertEvent(events[0].id), 12000);
    return () => clearTimeout(t);
  }, [events]);
  if (!events.length) return null;
  return (
    <div className="demo-toasts al-toasts">
      {events.map((e) => (
        <div
          key={e.id}
          className="demo-toast al-toast"
          onClick={() => {
            dismissAlertEvent(e.id);
            onOpen();
          }}
        >
          <span>🔔</span>
          <span>
            <strong>{e.text}</strong>
            {e.message && <div className="dm-small">{e.message}</div>}
          </span>
          <strong>{formatPrice(e.value)}</strong>
        </div>
      ))}
    </div>
  );
}
