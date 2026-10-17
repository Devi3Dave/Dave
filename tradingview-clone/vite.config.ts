import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base './' so the build works from any sub-path (e.g. GitHub Pages /Dave/chartai/).
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { target: "safari15", chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
});
