import { equity } from "../../shared/demoTrading";
import { intervalSeconds } from "../../shared/marketData";
import { REPLAY_SPEEDS, intrabarIntervals, subBarsOf } from "../../shared/replay";
import { resolveTimeZone } from "../chartSettings";
import { useDemo } from "../demoAccount";
import { exitReplay, pickReplayStart, setReplayIntrabar, setReplayPlaying, setReplaySpeed, startReplay, stepBackReplay, stepReplay, useChart, type ChartStore } from "../store";

/** Lower time frames an intrabar replay can step in (Binance native). */
const INTRABAR_CANDIDATES = ["1s", "1m", "5m", "15m", "30m", "1h", "4h", "1d"].map((id) => ({ id, seconds: intervalSeconds(id) }));

/** Step size: whole candles or a lower time frame that builds each candle (TradingView's replay update interval). */
function StepSelect({ chart }: { chart: ChartStore }) {
  const interval = useChart(chart, (s) => s.interval);
  const demo = useChart(chart, (s) => s.source === "demo");
  const current = useChart(chart, (s) => s.replay?.intrabar?.interval ?? "");
  const options = intrabarIntervals(intervalSeconds(interval), INTRABAR_CANDIDATES);
  if (!options.length || demo) return null;
  return (
    <select
      value={current}
      onChange={(e) => setReplayIntrabar(chart, e.target.value || null)}
      aria-label="Schritt"
      data-tip={"Schritt: ganze Kerzen oder Intrabar\nMit z. B. 1m baut sich jede Kerze Minute für Minute auf, wie beim TradingView-Replay"}
    >
      <option value="">Kerze</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

const money = (v: number) => {
  const c = Math.round(v * 100) / 100 || 0;
  return `${c > 0 ? "+" : ""}${c.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
};
const speedText = (v: number) => `${String(v).replace(".", ",")}×`;

/** Replay controls at the bottom of a replaying chart: start, step, play/pause, speed, replay account. */
export function ReplayBar({ chart }: { chart: ChartStore }) {
  const replay = useChart(chart, (s) => s.replay);
  const timeZone = useChart(chart, (s) => s.settings.timeZone);
  const intraday = useChart(chart, (s) => !["1d", "1w", "1M", "3M", "1y", "all"].includes(s.interval));
  const book = useDemo((s) => (s.replay?.slot === chart.slot ? s.replay : null));
  if (!replay) return null;

  if (replay.phase === "select") {
    return (
      <div className="replay-bar select">
        <span className="replay-title">⏪ Replay</span>
        <span className="replay-hint">{replay.shown ? "Frühere Kerze antippen, dort geht es weiter" : "Startkerze im Chart antippen"}</span>
        <button onClick={() => pickReplayStart(chart, "random")} data-tip="Zufälligen Startpunkt wählen (ohne zu sehen, was danach kommt)">
          🎲 Zufällig
        </button>
        <button onClick={() => exitReplay(chart)} data-tip="Replay beenden, zurück zum Live-Chart" aria-label="Replay beenden">
          ✕
        </button>
      </div>
    );
  }

  // While a candle builds up, the time of its newest lower-time-frame part.
  const part = replay.intrabar && replay.sub > 0 ? subBarsOf(replay.intrabar.bars, replay.all, replay.shown)[replay.sub - 1] : undefined;
  const bar = part ?? replay.all[replay.shown - 1];
  const atEnd = replay.shown >= replay.all.length;
  const date = bar
    ? new Date(bar.time * 1000).toLocaleString("de-DE", {
        timeZone: resolveTimeZone(timeZone),
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        ...(intraday || part ? { hour: "2-digit", minute: "2-digit" } : {}),
      })
    : "";
  const result = book ? equity(book.account, book.prices) - book.account.startBalance : 0;
  const trades = book ? book.account.history.length + book.account.positions.length : 0;
  const positionsOpen = !!book && book.account.positions.length > 0;

  return (
    <div className="replay-bar">
      <span className="replay-title">Replay</span>
      <button
        onClick={() => startReplay(chart)}
        data-tip={"Zurückspulen: im Chart eine frühere Kerze antippen\nDas Replay-Konto beginnt dann von vorn"}
        aria-label="Zurückspulen zu einer früheren Kerze"
      >
        ⏪
      </button>
      <button
        onClick={() => stepBackReplay(chart)}
        disabled={(replay.shown <= 1 && !replay.sub) || positionsOpen}
        data-tip={positionsOpen ? "Zurück geht nur ohne offene Replay-Position" : "Eine Kerze zurück\nTastatur: Shift + ←"}
        aria-label="Eine Kerze zurück"
      >
        ⏮
      </button>
      <button
        className="replay-play"
        onClick={() => setReplayPlaying(chart, !replay.playing)}
        disabled={atEnd}
        data-tip={replay.playing ? "Pause" : "Abspielen"}
        aria-label={replay.playing ? "Pause" : "Abspielen"}
      >
        {replay.playing ? "⏸" : "▶"}
      </button>
      <button
        onClick={() => stepReplay(chart)}
        disabled={atEnd}
        data-tip={replay.intrabar ? `Nächster ${replay.intrabar.interval}-Schritt\nTastatur: Shift + →` : "Nächste Kerze\nTastatur: Shift + →"}
        aria-label="Nächste Kerze"
      >
        ⏭
      </button>
      <StepSelect chart={chart} />
      <select value={replay.speed} onChange={(e) => setReplaySpeed(chart, Number(e.target.value))} aria-label="Tempo" data-tip={replay.intrabar ? "Tempo: Schritte pro Sekunde" : "Tempo: Kerzen pro Sekunde"}>
        {REPLAY_SPEEDS.map((v) => (
          <option key={v} value={v}>
            {speedText(v)}
          </option>
        ))}
      </select>
      <span className="replay-date" data-tip={`Kerze ${replay.shown} von ${replay.all.length}`}>
        {atEnd ? "Ende erreicht" : date}
      </span>
      {book && trades > 0 && (
        <span className={`replay-pnl ${result > 0 ? "up" : result < 0 ? "down" : ""}`} data-tip={"Ergebnis im Replay-Konto\nTrades über 💰 Demo, solange dieser Chart aktiv ist"}>
          {money(result)}
        </span>
      )}
      <button onClick={() => exitReplay(chart)} data-tip={"Replay beenden, zurück zum Live-Chart\nDas Replay-Konto wird verworfen"} aria-label="Replay beenden">
        ✕
      </button>
    </div>
  );
}
