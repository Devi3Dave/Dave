import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Safari zooms the whole page on a pinch (iPad, Mac trackpad); the app zooms only inside the chart.
document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });

// The service worker only matters for the installed (standalone) web app.
if (import.meta.env.PROD && import.meta.env.VITE_STANDALONE === "true" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => undefined));
}
