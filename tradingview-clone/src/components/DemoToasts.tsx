import { useEffect } from "react";
import { REASON_LABELS, openPnl } from "../../shared/demoTrading";
import { dismissEvent, useDemo, type DemoEvent } from "../demoAccount";

const money = (v: number) => {
  const c = Math.round(v * 100) / 100 || 0;
  return `${c > 0 ? "+" : ""}${c.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
};
const ICON = { manual: "✋", stop: "🛑", target: "🎯", liquidation: "💥" };

/** Top-bar button for the demo account; shows the open result while positions are running. */
export function DemoButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  const count = useDemo((s) => s.account.positions.length);
  const pnl = useDemo((s) => openPnl(s.account, s.prices));
  return (
    <button className={`pill ${active ? "active" : ""}`} onClick={onClick} aria-label="Demo" data-tip={"Demo-Trading mit Spielgeld\nAlle Assets kaufen/verkaufen, Long/Short mit Hebel, SL/TP"}>
      {/* With open positions the running result replaces the word, to keep the top bar short. */}
      <span className="pill-icon">💰</span> {count > 0 ? <span className={`demo-pnl ${pnl > 0 ? "up" : pnl < 0 ? "down" : ""}`}>{money(pnl)}</span> : <span className="pill-label">Demo</span>}
    </button>
  );
}

function Toast({ event, onOpen }: { event: DemoEvent; onOpen: () => void }) {
  const t = event.trade;
  useEffect(() => {
    const timer = setTimeout(() => dismissEvent(event.id), 8000);
    return () => clearTimeout(timer);
  }, [event.id]);
  return (
    <div
      className={`demo-toast ${t.pnl >= 0 ? "up" : "down"}`}
      onClick={() => {
        dismissEvent(event.id);
        onOpen();
      }}
    >
      <span>{ICON[t.reason]}</span>
      <span>
        <strong>{REASON_LABELS[t.reason]}</strong> {t.symbol} {t.side === "long" ? "Long" : "Short"}
      </span>
      <strong className={t.pnl >= 0 ? "up" : "down"}>{money(t.pnl)}</strong>
    </div>
  );
}

/** Stop-loss, take-profit and liquidation hits of the demo account, wherever you are in the app. */
export function DemoToasts({ onOpen }: { onOpen: () => void }) {
  const events = useDemo((s) => s.events);
  if (!events.length) return null;
  return (
    <div className="demo-toasts">
      {events.map((e) => (
        <Toast key={e.id} event={e} onOpen={onOpen} />
      ))}
    </div>
  );
}
