import { describe, expect, it } from "vitest";
import { addNote, deleteNote, filterNotes, noteTitle, parseNotes, updateNote, type Note } from "../shared/notes";

const base = (): Note[] => {
  let n: Note[] = [];
  n = addNote(n, "BTC Ausbruch\nüber 70k long", "BTCUSDT", 1000, "a");
  n = addNote(n, "Wochenplan", null, 2000, "b");
  n = addNote(n, "ETH Range 3k–3,5k", "ETHUSDT", 3000, "c");
  return n;
};

describe("notes", () => {
  it("adds trimmed notes and ignores empty text", () => {
    expect(addNote([], "   ", "BTCUSDT", 1, "x")).toEqual([]);
    const [n] = addNote([], "  Idee \n", "BTCUSDT", 5, "x");
    expect(n).toMatchObject({ id: "x", text: "Idee", symbol: "BTCUSDT", pinned: false, createdAt: 5, updatedAt: 5 });
  });

  it("uses the first line as title", () => {
    expect(noteTitle({ text: "Titel\nText" })).toBe("Titel");
    expect(noteTitle({ text: "x".repeat(100) })).toHaveLength(80);
  });

  it("filters per symbol with general notes, pinned first, then newest", () => {
    let n = base();
    expect(filterNotes(n, "symbol", "BTCUSDT").map((x) => x.id)).toEqual(["b", "a"]);
    expect(filterNotes(n, "all", "BTCUSDT").map((x) => x.id)).toEqual(["c", "b", "a"]);
    n = updateNote(n, "a", { pinned: true }, 9000);
    expect(filterNotes(n, "all", "BTCUSDT").map((x) => x.id)).toEqual(["a", "c", "b"]);
    // pinning is not an edit
    expect(n.find((x) => x.id === "a")!.updatedAt).toBe(1000);
  });

  it("searches every word in text and symbol", () => {
    const n = base();
    expect(filterNotes(n, "all", "", "eth range").map((x) => x.id)).toEqual(["c"]);
    expect(filterNotes(n, "all", "", "btcusdt 70k").map((x) => x.id)).toEqual(["a"]);
    expect(filterNotes(n, "all", "", "nichts")).toEqual([]);
  });

  it("edits, keeps text when the edit is empty, deletes", () => {
    let n = updateNote(base(), "b", { text: "Neu" }, 7000);
    expect(n.find((x) => x.id === "b")).toMatchObject({ text: "Neu", updatedAt: 7000 });
    n = updateNote(n, "b", { text: "  " }, 8000);
    expect(n.find((x) => x.id === "b")!.text).toBe("Neu");
    expect(deleteNote(n, "b").map((x) => x.id)).toEqual(["c", "a"]);
  });

  it("parses stored notes and drops broken ones", () => {
    expect(parseNotes(null)).toEqual([]);
    const p = parseNotes([{ id: "a", text: "x", symbol: "", createdAt: 3 }, { id: 1, text: "y" }, { id: "c", text: " " }, "z"]);
    expect(p).toEqual([{ id: "a", text: "x", symbol: null, pinned: false, createdAt: 3, updatedAt: 3 }]);
  });
});
