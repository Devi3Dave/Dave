import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

const version = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;

function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}

const build = { version, sha: gitSha(), time: new Date().toISOString() };

/** Writes version.json next to index.html so the installed app can see that a newer build is online. */
function versionFile(): Plugin {
  return {
    name: "version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify(build) });
    },
  };
}

// base './' so the build works from any sub-path (e.g. GitHub Pages /Dave/chartai/).
export default defineConfig({
  base: "./",
  plugins: [react(), versionFile()],
  define: {
    __APP_VERSION__: JSON.stringify(build.version),
    __BUILD_SHA__: JSON.stringify(build.sha),
    __BUILD_TIME__: JSON.stringify(build.time),
  },
  build: { target: "safari15", chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
});
