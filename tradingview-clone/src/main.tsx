import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { markAppStarted, startSync } from "./sync";
import "./styles.css";

// The stores read localStorage when they load, so the newest state of the other device comes first (src/sync.ts).
void startSync().then(async () => {
  const { default: App } = await import("./App");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  markAppStarted();
});

// Safari zooms the whole page on a pinch (iPad, Mac trackpad); the app zooms only inside the chart.
document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });

// The service worker only matters for the installed (standalone) web app.
if (import.meta.env.PROD && import.meta.env.VITE_STANDALONE === "true" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => undefined));
}
