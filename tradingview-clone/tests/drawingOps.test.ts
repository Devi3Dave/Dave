import { describe, expect, it } from "vitest";
import { arrangeDrawing, cloneDrawing, moveAnchor, shiftDrawing } from "../src/drawingOps";
import type { Drawing } from "../src/store";

const line: Drawing = { id: "l", author: "claude", kind: "trendline", a: { time: 100, price: 10 }, b: { time: 200, price: 20 }, extend: "none", color: "#2962ff", style: "solid", width: 2, locked: true };
const plus = (dt: number) => (t: number) => t + dt;

describe("drawing operations", () => {
  it("moves a line in parallel", () => {
    const moved = shiftDrawing(line, plus(50), 5);
    expect(moved).toMatchObject({ a: { time: 150, price: 15 }, b: { time: 250, price: 25 } });
    // Same slope as before.
    if (moved.kind !== "trendline" || line.kind !== "trendline") throw new Error();
    expect((moved.b.price - moved.a.price) / (moved.b.time - moved.a.time)).toBe((line.b.price - line.a.price) / (line.b.time - line.a.time));
  });

  it("keeps open zone ends open", () => {
    const zone: Drawing = { id: "z", author: "user", kind: "zone", top: 10, bottom: 5, extendRight: true, color: "#fff" };
    expect(shiftDrawing(zone, plus(10), 1)).toMatchObject({ top: 11, bottom: 6, from: undefined, to: undefined });
  });

  it("moves all prices of a position", () => {
    const pos: Drawing = { id: "p", author: "user", kind: "position", color: "#089981", side: "long", entry: 100, stop: 95, target: 110, from: 0, to: 10, account: 1000, risk: 1, leverage: 1 };
    expect(shiftDrawing(pos, plus(5), -10)).toMatchObject({ entry: 90, stop: 85, target: 100, from: 5, to: 15 });
  });

  it("drags single anchors", () => {
    expect(moveAnchor(line, 1, { time: 300, price: 30 })).toMatchObject({ a: line.kind === "trendline" ? line.a : null, b: { time: 300, price: 30 } });
    expect(moveAnchor(line, 2, { time: 0, price: 0 })).toBeNull();
    const channel: Drawing = { id: "c", author: "user", kind: "channel", a: { time: 0, price: 10 }, b: { time: 10, price: 20 }, offset: 3, color: "#fff" };
    expect(moveAnchor(channel, 2, { time: 0, price: 16 })).toMatchObject({ offset: 6 });
  });

  it("clones as an unlocked user drawing with its own data", () => {
    const copy = cloneDrawing(line, "copy");
    expect(copy).toMatchObject({ id: "copy", author: "user" });
    expect(copy.locked).toBeUndefined();
    if (copy.kind !== "trendline") throw new Error();
    copy.a.price = 99;
    expect(line.kind === "trendline" && line.a.price).toBe(10);
  });

  it("changes the paint order", () => {
    const list = ["a", "b", "c", "d"].map((id) => ({ ...line, id }));
    const ids = (l: Drawing[]) => l.map((d) => d.id).join("");
    expect(ids(arrangeDrawing(list, "b", "front"))).toBe("acdb");
    expect(ids(arrangeDrawing(list, "c", "back"))).toBe("cabd");
    expect(ids(arrangeDrawing(list, "b", "forward"))).toBe("acbd");
    expect(ids(arrangeDrawing(list, "b", "backward"))).toBe("bacd");
    expect(ids(arrangeDrawing(list, "d", "forward"))).toBe("abcd");
  });
});
