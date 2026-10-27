// Layout sync between the charts of the workspace, like TradingView's: crosshair and time range.
import { workspace } from "./store";

export type SyncEvent = { kind: "crosshair"; time: number | null } | { kind: "range"; from: number; to: number };
type Listener = (fromSlot: number, ev: SyncEvent) => void;

const listeners = new Set<Listener>();
let last = "";
/** The chart the user's pointer or finger is on: only its crosshair is sent to the others. */
let leader: number | null = null;

/** Marks `slot` as the chart the user is working in (pointer moved or touched there). */
export function setSyncLeader(slot: number) {
  leader = slot;
}

export function isSyncLeader(slot: number): boolean {
  return leader === slot;
}

/** Sends a crosshair or time-range change of one chart to the others (when that sync is on). */
export function publishSync(slot: number, ev: SyncEvent) {
  const w = workspace.get();
  if (ev.kind === "crosshair" ? !w.syncCrosshair : !w.syncTime) return;
  // The same change again (charts echoing each other) is dropped.
  const key = JSON.stringify(ev);
  if (key === last) return;
  last = key;
  listeners.forEach((l) => l(slot, ev));
}

export function subscribeSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
