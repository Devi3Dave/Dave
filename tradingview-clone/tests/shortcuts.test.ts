import { describe, expect, it } from "vitest";
import {
  SHORTCUT_ACTIONS,
  assignCombo,
  claimsEscape,
  comboFromEvent,
  conflictFor,
  findAction,
  formatCombo,
  matchesCombo,
  parseOverrides,
  removeCombo,
  reservedReason,
  resetAction,
  resolveBindings,
  type KeyLike,
} from "../shared/shortcuts";

const key = (k: string, code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe("shortcut defaults", () => {
  it("has unique ids and no combo used twice", () => {
    expect(new Set(SHORTCUT_ACTIONS.map((a) => a.id)).size).toBe(SHORTCUT_ACTIONS.length);
    for (const mac of [true, false]) {
      const bindings = resolveBindings({}, mac);
      for (const [id, combos] of Object.entries(bindings)) for (const c of combos) expect(conflictFor(c, bindings, mac, id)).toBeNull();
    }
  });

  it("never defaults to a key the browser or system keeps", () => {
    for (const mac of [true, false]) for (const combos of Object.values(resolveBindings({}, mac))) for (const c of combos) expect(reservedReason(c, mac)).toBeNull();
  });

  it("uses the TradingView keys", () => {
    const b = resolveBindings({}, false);
    expect(b["tool.trendline"]).toEqual(["Alt+KeyT"]);
    expect(b["tool.zone"]).toEqual(["Alt+Shift+KeyR"]);
    expect(b["panel.alerts"]).toEqual(["Alt+KeyA"]);
    expect(b["edit.redo"]).toEqual(["Mod+KeyY"]);
    // ⌘Y opens Safari's history, so the Mac redo is ⌘⇧Z.
    expect(resolveBindings({}, true)["edit.redo"]).toEqual(["Mod+Shift+KeyZ"]);
  });
});

describe("matching", () => {
  it("matches Option combos on a Mac even though Option changes the character", () => {
    // ⌥T types "†", ⌥I is a dead key.
    expect(findAction(key("†", "KeyT", { altKey: true }), resolveBindings({}, true), true)).toBe("tool.trendline");
    expect(findAction(key("Dead", "KeyI", { altKey: true }), resolveBindings({}, true), true)).toBe("scale.invert");
    expect(findAction(key("‰", "KeyR", { altKey: true, shiftKey: true }), resolveBindings({}, true), true)).toBe("tool.zone");
  });

  it("follows the printed letter with modifiers (German QWERTZ swaps Y and Z)", () => {
    // Z on a German keyboard sits where KeyY is.
    expect(matchesCombo(key("z", "KeyY", { metaKey: true }), "Mod+KeyZ", true)).toBe(true);
    expect(matchesCombo(key("z", "KeyY", { ctrlKey: true }), "Mod+KeyZ", false)).toBe(true);
    expect(matchesCombo(key("y", "KeyZ", { ctrlKey: true }), "Mod+KeyZ", false)).toBe(false);
  });

  it("keeps ⌘ and ⌃ apart on a Mac, but not elsewhere", () => {
    expect(matchesCombo(key("z", "KeyZ", { ctrlKey: true }), "Mod+KeyZ", true)).toBe(false);
    expect(matchesCombo(key("h", "KeyH", { ctrlKey: true, altKey: true }), "Ctrl+Alt+KeyH", true)).toBe(true);
    expect(matchesCombo(key("h", "KeyH", { metaKey: true, altKey: true }), "Ctrl+Alt+KeyH", true)).toBe(false);
    expect(matchesCombo(key("h", "KeyH", { ctrlKey: true, altKey: true }), "Ctrl+Alt+KeyH", false)).toBe(true);
  });

  it("matches a printed character whatever Shift it takes", () => {
    // "/" is Shift + 7 on a German keyboard.
    expect(findAction(key("/", "Digit7", { shiftKey: true }), resolveBindings({}, false), false)).toBe("dialog.indicators");
    expect(findAction(key("/", "Slash"), resolveBindings({}, false), false)).toBe("dialog.indicators");
    expect(findAction(key("/", "Digit7", { shiftKey: true, metaKey: true }), resolveBindings({}, true), true)).toBe("dialog.shortcuts");
  });

  it("needs the exact modifiers", () => {
    expect(matchesCombo(key("ArrowRight", "ArrowRight"), "Shift+ArrowRight", false)).toBe(false);
    expect(findAction(key("ArrowRight", "ArrowRight", { shiftKey: true }), resolveBindings({}, false), false)).toBe("replay.next");
    expect(findAction(key("ArrowRight", "ArrowRight"), resolveBindings({}, false), false)).toBe("chart.scrollRight");
  });
});

describe("recording", () => {
  it("turns key presses into combos", () => {
    expect(comboFromEvent(key("Alt", "AltLeft", { altKey: true }), true)).toBeNull();
    expect(comboFromEvent(key("ø", "KeyO", { altKey: true }), true)).toBe("Alt+KeyO");
    expect(comboFromEvent(key("k", "KeyK", { metaKey: true }), true)).toBe("Mod+KeyK");
    expect(comboFromEvent(key("z", "KeyY", { ctrlKey: true, shiftKey: true }), false)).toBe("Mod+Shift+KeyZ");
    expect(comboFromEvent(key("!", "Digit1", { shiftKey: true }), false)).toBe("Shift+Digit1");
    expect(comboFromEvent(key("ArrowUp", "ArrowUp", { metaKey: true }), true)).toBe("Mod+ArrowUp");
    expect(comboFromEvent(key("?", "Minus", { shiftKey: true }), false)).toBe("?");
  });

  it("round-trips: a recorded combo matches the same key press", () => {
    const presses = [key("†", "KeyT", { altKey: true, shiftKey: true }), key("5", "Digit5"), key("Delete", "Delete"), key("?", "Minus", { shiftKey: true }), key(" ", "Space", { altKey: true })];
    for (const mac of [true, false]) {
      for (const p of presses) {
        const combo = comboFromEvent(p, mac)!;
        expect(matchesCombo(p, combo, mac)).toBe(true);
      }
    }
  });
});

describe("display", () => {
  it("uses Mac symbols in Apple's order and words elsewhere", () => {
    expect(formatCombo("Mod+Alt+Shift+KeyR", true)).toBe("⌥⇧⌘R");
    expect(formatCombo("Ctrl+Alt+KeyH", true)).toBe("⌃⌥H");
    expect(formatCombo("Mod+Alt+Shift+KeyR", false)).toBe("Strg + Alt + Umschalt + R");
    expect(formatCombo("Delete", false)).toBe("Entf");
    expect(formatCombo("Mod+/", true)).toBe("⌘/");
  });
});

describe("editing", () => {
  it("moves a combo from one action to another and resets", () => {
    let o = assignCombo({}, "tool.ray", "Alt+KeyT", false);
    let b = resolveBindings(o, false);
    expect(b["tool.ray"]).toEqual(["Alt+KeyT"]);
    expect(b["tool.trendline"]).toEqual([]);
    o = resetAction(o, "tool.trendline");
    expect(resolveBindings(o, false)["tool.trendline"]).toEqual(["Alt+KeyT"]);
    o = removeCombo(o, "tool.ray", "Alt+KeyT", false);
    // Back at the default (none) → nothing stored for it.
    expect(o["tool.ray"]).toBeUndefined();
  });

  it("treats Ctrl and Mod as the same key off Apple devices", () => {
    const o = assignCombo({}, "tool.ray", "Ctrl+KeyZ", false);
    expect(resolveBindings(o, false)["edit.undo"]).toEqual([]);
  });

  it("finds reserved keys", () => {
    expect(reservedReason("Mod+KeyW", true)).toContain("schließt den Tab");
    expect(reservedReason("Mod+Alt+KeyH", true)).toContain("anderen Apps");
    expect(reservedReason("Mod+Alt+KeyH", false)).toBeNull();
  });

  it("reads stored overrides defensively", () => {
    expect(parseOverrides("not json")).toEqual({});
    expect(parseOverrides('{"tool.ray":["Alt+KeyJ",3],"nope":["Alt+KeyX"]}')).toEqual({ "tool.ray": ["Alt+KeyJ"] });
  });
});

describe("Esc and full screen", () => {
  it("claims plain Esc so the browser keeps the full-screen window", () => {
    expect(claimsEscape(key("Escape", "Escape"))).toBe(true);
    expect(claimsEscape({ ...key("Escape", "Escape"), isComposing: true })).toBe(false);
    expect(claimsEscape(key("Escape", "Escape", { metaKey: true }))).toBe(false);
    expect(claimsEscape(key("a", "KeyA"))).toBe(false);
  });
});
