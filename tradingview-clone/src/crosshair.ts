import { useSyncExternalStore } from "react";
import type { Bar } from "../shared/math";
import type { ComputedIndicator } from "./chart/ChartEngine";

/** What one chart shows under its crosshair (or at the last candle): read by the data window. */
export interface CrosshairData {
  index: number;
  bars: Bar[];
  computed: ComputedIndicator[];
}

const bySlot = new Map<number, CrosshairData>();
const listeners = new Set<() => void>();

export function publishCrosshair(slot: number, data: CrosshairData) {
  bySlot.set(slot, data);
  listeners.forEach((l) => l());
}

export function useCrosshair(slot: number): CrosshairData | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => bySlot.get(slot) ?? null,
  );
}
