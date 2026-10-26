import { useEffect, useMemo, useState } from "react";
import { assessFreshness, freshnessReport, type FreshnessInput, type Level } from "../../shared/freshness";
import { measureClock, useClockSync } from "../market/clockSync";
import { useFeedSettings } from "../market/exchangeFeed";
import { crossCheckLatest, refreshAll, useChart, type ChartStore } from "../store";
import { FeedSettingsDialog } from "./FeedSettingsDialog";

const ICON: Record<Level, string> = { ok: "✓", warn: "!", bad: "✕", info: "i" };

/** Ticks once a second while mounted, so ages stay current. */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Device-local time of a unix-seconds instant; the date only when it is not today. */
function formatTime(sec: number): string {
  const d = new Date(sec * 1000);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return today ? time : `${d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })} ${time}`;
}

/** Status light in the chart legend; opens the proof that chart, data and clock are current. */
export function FreshnessBadge({ chart }: { chart: ChartStore }) {
  const symbol = useChart(chart, (s) => s.symbol);
  const interval = useChart(chart, (s) => s.interval);
  const source = useChart(chart, (s) => s.source);
  const loading = useChart(chart, (s) => s.loading);
  const lastBarTime = useChart(chart, (s) => {
    const series = s.replay ? s.replay.all : s.bars;
    return series.length ? series[series.length - 1].time : null;
  });
  const replay = useChart(chart, (s) => s.replay !== null);
  const tick = useChart(chart, (s) => s.liveTick);
  const loadedAt = useChart(chart, (s) => s.loadedAt);
  const rest = useChart(chart, (s) => s.restCheck);
  const clock = useClockSync();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const feedKey = useFeedSettings().apiKey.length > 0;

  const input: FreshnessInput = {
    symbol,
    interval,
    source: loading ? null : source,
    lastBarTime: loading ? null : lastBarTime,
    deviceNow: now,
    clock: clock.sync,
    clockFailed: clock.failed,
    tick,
    loadedAt,
    rest,
    replay,
  };
  const result = useMemo(() => assessFreshness(input, formatTime), [now, symbol, interval, source, loading, lastBarTime, clock, tick, loadedAt, rest, replay]); // eslint-disable-line react-hooks/exhaustive-deps

  const runCheck = async (reload = false) => {
    setChecking(true);
    setCheckError(null);
    try {
      if (reload) await chart.refresh();
      await Promise.all([measureClock(), crossCheckLatest(chart)]);
    } catch (err) {
      setCheckError((err as Error).message);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (open && !loading) void runCheck();
  }, [open, symbol, interval, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(freshnessReport(input, result));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCheckError("Kopieren nicht möglich");
    }
  };

  if (loading) return null;
  const tip = `Aktualität: ${result.checks.filter((c) => c.level !== "info").map((c) => `${ICON[c.level]} ${c.label}`).join(" · ")}\nAntippen für den Nachweis`;

  return (
    <>
      <button className={`fresh-badge ${result.level}`} onClick={() => setOpen((o) => !o)} data-tip={tip} aria-expanded={open}>
        <span className="fresh-dot" />
        {result.summary}
      </button>
      {open && (
        <div className="fresh-panel" onPointerDown={(e) => e.stopPropagation()}>
          <div className="fresh-head">
            <strong>Aktualitäts-Nachweis</strong>
            <button onClick={() => setOpen(false)} aria-label="Schließen">
              ✕
            </button>
          </div>
          <div className={`fresh-verdict ${result.level}`}>
            {result.level === "ok" ? "Chart und Uhrzeit sind aktuell" : result.level === "warn" ? "Bitte prüfen: nicht alles bestätigt" : "Nicht aktuell oder nicht nachweisbar"}
            <span>Serverzeit {formatTime(Math.floor(result.trueNow / 1000))}</span>
          </div>
          <ul className="fresh-checks">
            {result.checks.map((c) => (
              <li key={c.id} className={c.level}>
                <span className="fresh-icon">{ICON[c.level]}</span>
                <span>
                  <b>{c.label}</b> {c.detail}
                </span>
              </li>
            ))}
          </ul>
          {checkError && <div className="fresh-error">Abgleich fehlgeschlagen: {checkError}</div>}
          <div className="fresh-actions">
            <button className="pill" onClick={() => void runCheck(true)} disabled={checking} data-tip={"Kerzen neu laden, Live-Verbindung neu aufbauen\nund Uhr sowie Server erneut abgleichen"}>
              {checking ? "Aktualisiere …" : "⟳ Aktualisieren"}
            </button>
            <button className="pill" onClick={() => void copy()}>
              {copied ? "Kopiert ✓" : "Nachweis kopieren"}
            </button>
            {result.market.kind !== "24/7" && (
              <button className="pill" onClick={() => setFeedOpen(true)} data-tip={"Eigener Twelve-Data-Schlüssel für Börsenkurse\nvon Aktien, Indizes und Forex"}>
                {feedKey ? "Börsenkurs-Einstellungen" : "Börsenkurs einrichten"}
              </button>
            )}
          </div>
        </div>
      )}
      {feedOpen && <FeedSettingsDialog onClose={() => setFeedOpen(false)} />}
    </>
  );
}

/** Top-bar button: reloads all charts, reconnects their live streams and measures the clock again. */
export function RefreshButton() {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await refreshAll();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      className={`pill refresh-btn ${busy ? "busy" : ""}`}
      onClick={() => void run()}
      disabled={busy}
      aria-label="Kurse aktualisieren"
      data-tip={"Kurse aktualisieren\nLädt alle Charts neu, verbindet den Live-Stream neu\nund gleicht die Uhr mit dem Server ab.\nAutomatisch: beim Zurückkehren zur App, wenn das Netz\nwieder da ist und wenn der Live-Stream 1 min stillsteht"}
    >
      <span className="refresh-icon">⟳</span>
    </button>
  );
}
