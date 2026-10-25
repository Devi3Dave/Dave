import { useSyncExternalStore } from "react";
import { getExchange } from "../shared/exchanges";

const KEY = "chartai.exchanges.v1";

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '["nyse"]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!getExchange(x)) : [];
  } catch {
    return [];
  }
}

let selected = load();
const listeners = new Set<() => void>();

export function subscribeExchanges(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Exchanges whose sessions are shaded in every chart. */
export function getSelectedExchanges(): string[] {
  return selected;
}

export function useSelectedExchanges(): string[] {
  return useSyncExternalStore(subscribeExchanges, getSelectedExchanges);
}

export function setSelectedExchanges(ids: string[]) {
  selected = ids;
  try {
    localStorage.setItem(KEY, JSON.stringify(selected));
  } catch {
    // not remembered
  }
  listeners.forEach((l) => l());
}

export function toggleExchange(id: string) {
  setSelectedExchanges(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
}
