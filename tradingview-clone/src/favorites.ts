import { useSyncExternalStore } from "react";

const KEY = "chartai.favorites.v1";

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

let favorites = load();
const listeners = new Set<() => void>();

/** Indicator ids the user starred, in the order they were added. */
export function useFavorites(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => favorites,
  );
}

export function toggleFavorite(id: string) {
  favorites = favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
  try {
    localStorage.setItem(KEY, JSON.stringify(favorites));
  } catch {
    // not remembered
  }
  listeners.forEach((l) => l());
}
