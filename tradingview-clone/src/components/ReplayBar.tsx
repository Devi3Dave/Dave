import { equity } from "../../shared/demoTrading";
import { REPLAY_SPEEDS } from "../../shared/replay";
import { resolveTimeZone } from "../chartSettings";
import { useDemo } from "../demoAccount";
import { exitReplay, pickReplayStart, setReplayPlaying, setReplaySpeed, startReplay, stepBackReplay, stepReplay, useChart, type ChartStore } from "../store";

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

  const bar = replay.all[replay.shown - 1];
  const atEnd = replay.shown >= replay.all.length;
  const date = bar
    ? new Date(bar.time * 1000).toLocaleString("de-DE", {
        timeZone: resolveTimeZone(timeZone),
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        ...(intraday ? { hour: "2-digit", minute: "2-digit" } : {}),
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
        disabled={replay.shown <= 1 || positionsOpen}
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
      <button onClick={() => stepReplay(chart)} disabled={atEnd} data-tip={"Nächste Kerze\nTastatur: Shift + →"} aria-label="Nächste Kerze">
        ⏭
      </button>
      <select value={replay.speed} onChange={(e) => setReplaySpeed(chart, Number(e.target.value))} aria-label="Tempo" data-tip="Tempo: Kerzen pro Sekunde">
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
