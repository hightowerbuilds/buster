import { describe, expect, it } from "vitest";
import { findKeybindingConflicts, normalizeHotkey } from "./keybinding-conflicts";

describe("normalizeHotkey", () => {
  it("normalizes modifier order and key casing", () => {
    expect(normalizeHotkey("Shift+Mod+F")).toBe("Mod+Shift+f");
  });

  it("treats platform control aliases as Mod", () => {
    expect(normalizeHotkey("Ctrl+Shift+p")).toBe("Mod+Shift+p");
    expect(normalizeHotkey("Cmd+Shift+p")).toBe("Mod+Shift+p");
  });

  it("normalizes two-step chords", () => {
    expect(normalizeHotkey("Cmd+K Cmd+S")).toBe("Mod+k Mod+s");
  });
});

describe("findKeybindingConflicts", () => {
  it("returns duplicated hotkeys with command labels", () => {
    const conflicts = findKeybindingConflicts([
      { id: "a", label: "Alpha", currentKey: "Mod+Shift+p" },
      { id: "b", label: "Beta", currentKey: "Shift+Mod+P" },
      { id: "c", label: "Gamma", currentKey: "Mod+g" },
    ]);

    expect(conflicts).toEqual([
      {
        hotkey: "Mod+Shift+p",
        commandIds: ["a", "b"],
        labels: ["Alpha", "Beta"],
      },
    ]);
  });

  it("ignores blank keybindings", () => {
    expect(findKeybindingConflicts([
      { id: "a", label: "Alpha", currentKey: "" },
      { id: "b", label: "Beta", currentKey: "" },
    ])).toEqual([]);
  });
});
