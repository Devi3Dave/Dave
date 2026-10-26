import { useSyncExternalStore } from "react";
import { clockFromSamples, type ClockSample, type ClockSync } from "../../shared/freshness";

// The device clock is measured against Binance's server clock, the clock that
// stamps the candles and ticks. The app talks to Binance directly in both builds.
const TIME_SERVERS = [
  { url: "https://api.binance.com/api/v3/time", label: "Binance-Serverzeit" },
  { url: "https://data-api.binance.vision/api/v3/time", label: "Binance-Serverzeit (Mirror)" },
  { url: "https://fapi.binance.com/fapi/v1/time", label: "Binance-Futures-Serverzeit" },
];
const SAMPLES = 5;
const REFRESH_MS = 10 * 60 * 1000;

interface ClockState {
  sync: ClockSync | null;
  failed: boolean;
  measuring: boolean;
}

let state: ClockState = { sync: null, failed: false, measuring: false };
const listeners = new Set<() => void>();
let started = false;

function set(patch: Partial<ClockState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

async function sample(url: string): Promise<ClockSample> {
  const sentAt = Date.now();
  const res = await fetch(`${url}?t=${sentAt}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  const json = (await res.json()) as { serverTime?: number };
  const receivedAt = Date.now();
  if (!res.ok || typeof json.serverTime !== "number") throw new Error(`${url} -> HTTP ${res.status}`);
  return { sentAt, serverTime: json.serverTime, receivedAt };
}

/** Measures the clock offset now (several round trips, the shortest one counts). */
export async function measureClock(): Promise<ClockSync | null> {
  if (state.measuring) return state.sync;
  set({ measuring: true });
  for (const server of TIME_SERVERS) {
    const samples: ClockSample[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      try {
        samples.push(await sample(server.url));
      } catch {
        if (samples.length === 0) break; // server unreachable - next one
      }
    }
    const sync = clockFromSamples(samples, server.label);
    if (sync) {
      set({ sync, failed: false, measuring: false });
      return sync;
    }
  }
  set({ failed: true, measuring: false });
  return null;
}

/** Starts measuring on first use; repeats every 10 minutes and when the app comes back to the foreground. */
function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  void measureClock();
  window.setInterval(() => void measureClock(), REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void measureClock();
  });
}

export const clockSync = {
  get: () => state,
  subscribe(l: () => void) {
    start();
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useClockSync(): ClockState {
  return useSyncExternalStore(clockSync.subscribe, clockSync.get);
}
