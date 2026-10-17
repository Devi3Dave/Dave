import { useSyncExternalStore } from "react";
import { DEFAULT_MODEL } from "../shared/models";

/**
 * Standalone builds (GitHub Pages / iPad PWA) run without the Node server:
 * market data is fetched from the browser and Claude is called directly with
 * the user's own API key, which is kept in this device's localStorage only.
 */
export const STANDALONE = import.meta.env.VITE_STANDALONE === "true";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
];

export interface ClaudeSettings {
  apiKey: string;
  model: string;
}

const KEY = "chartai.claude.v1";
const listeners = new Set<() => void>();

function read(): ClaudeSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { apiKey: "", model: DEFAULT_MODEL, ...(JSON.parse(raw) as Partial<ClaudeSettings>) };
  } catch {
    // storage unavailable
  }
  return { apiKey: "", model: DEFAULT_MODEL };
}

let settings = read();

export const claudeSettings = {
  get: () => settings,
  set(patch: Partial<ClaudeSettings>) {
    settings = { ...settings, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // storage unavailable - settings last for this session only
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useClaudeSettings(): ClaudeSettings {
  return useSyncExternalStore(claudeSettings.subscribe, claudeSettings.get);
}
