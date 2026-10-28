import { useSyncExternalStore } from "react";
import { normalizeProxyUrl, setProxyBase } from "../shared/proxy";

/** Address of the own relay (proxy/worker.js) for exchanges the browser may not load; kept on this device only. */
const KEY = "chartai.proxy.v1";
const listeners = new Set<() => void>();

function read(): string {
  try {
    return normalizeProxyUrl(localStorage.getItem(KEY) ?? "") ?? "";
  } catch {
    return "";
  }
}

let url = read();
setProxyBase(url);

export function getProxyUrl(): string {
  return url;
}

/** Sets or clears ("") the relay; an address that is not https is refused (returns false). */
export function setProxyUrl(next: string): boolean {
  const normalized = next.trim() ? normalizeProxyUrl(next) : "";
  if (normalized === null) return false;
  url = normalized;
  setProxyBase(url);
  try {
    if (url) localStorage.setItem(KEY, url);
    else localStorage.removeItem(KEY);
  } catch {
    // not remembered
  }
  listeners.forEach((l) => l());
  return true;
}

export function useProxyUrl(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getProxyUrl,
  );
}
