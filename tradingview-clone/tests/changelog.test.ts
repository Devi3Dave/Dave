import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHANGELOG, formatReleaseDate, searchChangelog } from "../src/changelog";

const pkgVersion = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

const parts = (v: string) => v.split(".").map(Number);
const compare = (a: string, b: string) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

describe("changelog", () => {
  it("starts with the version in package.json", () => {
    expect(CHANGELOG[0].version, "Neue Version in package.json? Bitte oben in src/changelog.ts einen Eintrag ergänzen").toBe(pkgVersion);
  });

  it("lists every version once, newest first, with date and changes", () => {
    for (let i = 0; i < CHANGELOG.length; i++) {
      const r = CHANGELOG[i];
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.changes.length).toBeGreaterThan(0);
      if (i > 0) {
        expect(compare(CHANGELOG[i - 1].version, r.version)).toBeGreaterThan(0);
        expect(CHANGELOG[i - 1].date >= r.date).toBe(true);
      }
    }
  });

  it("searches version, title and changes", () => {
    expect(searchChangelog(CHANGELOG, "").length).toBe(CHANGELOG.length);
    expect(searchChangelog(CHANGELOG, "0.30.0").map((r) => r.version)).toEqual(["0.30.0"]);
    expect(searchChangelog(CHANGELOG, "renko").map((r) => r.version)).toContain("0.29.0");
    expect(searchChangelog(CHANGELOG, "gibt es nicht")).toEqual([]);
  });

  it("formats dates the German way", () => {
    expect(formatReleaseDate("2026-10-27")).toBe("27.10.2026");
  });
});
