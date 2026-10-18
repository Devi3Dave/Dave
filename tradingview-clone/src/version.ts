import { useCallback, useEffect, useState } from "react";

export const APP_VERSION = __APP_VERSION__;
export const BUILD_SHA = __BUILD_SHA__;
export const BUILD_TIME = __BUILD_TIME__;

interface Deployed {
  version: string;
  sha: string;
  time: string;
}

async function fetchDeployed(): Promise<Deployed | null> {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as Deployed) : null;
  } catch {
    return null;
  }
}

export type UpdateState = "idle" | "checking" | "current" | "available";

/** Compares the running build with version.json on the server (production builds only). */
export function useUpdateCheck() {
  const [state, setState] = useState<UpdateState>("idle");
  const [latest, setLatest] = useState<Deployed | null>(null);

  const check = useCallback(async (): Promise<boolean> => {
    if (!import.meta.env.PROD) return false;
    setState("checking");
    const d = await fetchDeployed();
    const newer = !!d && d.sha !== BUILD_SHA;
    setLatest(d);
    setState(newer ? "available" : "current");
    return newer;
  }, []);

  useEffect(() => {
    void check();
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void check(), 30 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [check]);

  return { state, latest, check };
}

/** Loads the newest build: refresh the service worker, then reload the page from the network. */
export async function reloadToLatest() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    // no service worker - a plain reload is enough
  }
  window.location.reload();
}

export function formatBuildTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}
