import { getExchange, tradingDays } from "./exchanges";
import type { Bar } from "./math";

/**
 * Trading sessions as boxes (open → close, session high/low) and the New York open as a
 * vertical line. Hours are the regular sessions of the exchanges in exchanges.ts (Tokyo
 * 09:00–15:30, London 08:00–16:30, New York 09:30–16:00 local time, with daylight saving
 * and exchange holidays), i.e. the NYSE open at 9:30 a.m. New York time.
 */
export interface SessionBox {
  label: string;
  from: number;
  to: number;
  top: number;
  bottom: number;
}

export interface TimeLine {
  time: number;
  label: string;
  color: string;
}

export const SESSION_EXCHANGES = [
  { key: "tokyo", id: "tse", label: "Tokio" },
  { key: "london", id: "lse", label: "London" },
  { key: "newyork", id: "nyse", label: "New York" },
] as const;

export function sessionBoxes(bars: Bar[], exchangeId: string, label: string, maxDays: number): SessionBox[] {
  const ex = getExchange(exchangeId);
  if (!ex || bars.length < 2) return [];
  const out: SessionBox[] = [];
  for (const day of tradingDays(ex, bars[0].time, bars[bars.length - 1].time)) {
    let top = -Infinity;
    let bottom = Infinity;
    for (const b of bars) {
      if (b.time < day.open || b.time >= day.close) continue;
      top = Math.max(top, b.high);
      bottom = Math.min(bottom, b.low);
    }
    if (top >= bottom) out.push({ label, from: day.open, to: day.close, top, bottom });
  }
  return out.slice(-maxDays);
}

/** Vertical line at each NYSE open (9:30 New York) within the bars. */
export function newYorkOpens(bars: Bar[], maxDays: number): TimeLine[] {
  const ex = getExchange("nyse");
  if (!ex || bars.length < 2) return [];
  const [first, last] = [bars[0].time, bars[bars.length - 1].time];
  return tradingDays(ex, first, last)
    .filter((d) => d.open >= first && d.open <= last)
    .slice(-maxDays)
    .map((d) => ({ time: d.open, label: "NY Open 9:30", color: "#f23645" }));
}
