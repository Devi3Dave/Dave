import { describe, expect, it } from "vitest";
import { INDICATORS } from "../shared/indicators";
import { INDICATOR_REFERENCES, REFERENCE_KIND_LABEL } from "../shared/indicatorReferences";

describe("indicator references", () => {
  it("names a source for every indicator", () => {
    for (const d of INDICATORS) {
      const ref = INDICATOR_REFERENCES[d.id];
      expect(ref, d.id).toBeDefined();
      expect(ref.source.length, d.id).toBeGreaterThan(5);
      expect(REFERENCE_KIND_LABEL[ref.kind], d.id).toBeDefined();
    }
  });

  it("has no references for indicators that do not exist", () => {
    const ids = new Set(INDICATORS.map((d) => d.id));
    expect(Object.keys(INDICATOR_REFERENCES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("marks the Percoco approximations and the liquidation estimate", () => {
    expect(INDICATOR_REFERENCES.sessions.kind).toBe("approx");
    expect(INDICATOR_REFERENCES.rsicloud.kind).toBe("approx");
    expect(INDICATOR_REFERENCES.liqheatmap.kind).toBe("estimate");
  });
});
