// Layout sync between the charts of the workspace, like TradingView's: crosshair and time range.
import { workspace } from "./store";

export type SyncEvent = { kind: "crosshair"; time: number | null } | { kind: "range"; from: number; to: number };
type Listener = (fromSlot: number, ev: SyncEvent) => void;

const listeners = new Set<Listener>();
let last = "";

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
