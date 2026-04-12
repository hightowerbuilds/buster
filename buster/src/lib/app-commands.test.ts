import { describe, expect, it, vi } from "vitest";

vi.mock("./a11y", () => ({
  announce: vi.fn(),
}));

vi.mock("./session", () => ({
  closeApp: vi.fn(),
}));

import { buildHotkeyDefinitions, DEFAULT_KEYBINDINGS } from "./app-commands";
import type { CommandDeps } from "./app-commands";

function makeDeps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  return {
    handleSave: vi.fn(),
    changeDirectory: vi.fn(),
    handleTabClose: vi.fn(),
    activeTabId: () => null,
    tabs: () => [],
    switchToTab: vi.fn(),
    activeEngine: () => null,
    setFindVisible: vi.fn(),
    setPaletteVisible: vi.fn(),
    setPaletteInitialQuery: vi.fn(),
    createTerminalTab: vi.fn(),
    createSettingsTab: vi.fn(),
    createGitTab: vi.fn(),
    setSidebarVisible: vi.fn(),
    setTourActive: vi.fn(),
    jumpToDiagnostic: vi.fn(),
    tourActive: () => false,
    findVisible: () => false,
    paletteVisible: () => false,
    settings: () => ({ word_wrap: true, font_size: 14, tab_size: 4, minimap: false, line_numbers: true, cursor_blink: true, autocomplete: true, ui_zoom: 100, recent_folders: [], theme_mode: "dark", theme_hue: -1, effect_cursor_glow: 0, effect_vignette: 0, effect_grain: 0 }),
    updateSettings: vi.fn(),
    tabTrapping: () => true,
    setTabTrapping: vi.fn(),
    ...overrides,
  };
}

describe("tab hotkeys", () => {
  it("defines default Mod+1 through Mod+9 bindings", () => {
    for (let position = 1; position <= 9; position++) {
      expect(DEFAULT_KEYBINDINGS[`tabs.${position}`]).toBe(`Mod+${position}`);
    }
  });

  it("defines default previous and next tab bindings", () => {
    expect(DEFAULT_KEYBINDINGS["tabs.prev"]).toBe("Mod+Shift+[");
    expect(DEFAULT_KEYBINDINGS["tabs.next"]).toBe("Mod+Shift+]");
  });

  it("switches to the matching tab index from left to right", () => {
    const switchToTab = vi.fn();
    const deps = makeDeps({
      tabs: () => [{ id: "tab-a" }, { id: "tab-b" }, { id: "tab-c" }],
      switchToTab,
    });
    const defs = buildHotkeyDefinitions(deps);

    defs.find(def => def.hotkey === "Mod+2")?.callback();
    defs.find(def => def.hotkey === "Mod+3")?.callback();

    expect(switchToTab).toHaveBeenNthCalledWith(1, "tab-b");
    expect(switchToTab).toHaveBeenNthCalledWith(2, "tab-c");
  });

  it("ignores tab shortcuts that point past the end of the tab list", () => {
    const switchToTab = vi.fn();
    const deps = makeDeps({
      tabs: () => [{ id: "only-tab" }],
      switchToTab,
    });
    const defs = buildHotkeyDefinitions(deps);

    defs.find(def => def.hotkey === "Mod+4")?.callback();

    expect(switchToTab).not.toHaveBeenCalled();
  });

  it("moves to adjacent tabs with bracket shortcuts and wraps around", () => {
    const switchToTab = vi.fn();
    const deps = makeDeps({
      activeTabId: () => "tab-b",
      tabs: () => [{ id: "tab-a" }, { id: "tab-b" }, { id: "tab-c" }],
      switchToTab,
    });
    const defs = buildHotkeyDefinitions(deps);

    defs.find(def => def.hotkey === "Mod+Shift+[")?.callback();
    defs.find(def => def.hotkey === "Mod+Shift+]")?.callback();

    expect(switchToTab).toHaveBeenNthCalledWith(1, "tab-a");
    expect(switchToTab).toHaveBeenNthCalledWith(2, "tab-c");
  });

  it("wraps previous tab from the first tab to the end", () => {
    const switchToTab = vi.fn();
    const deps = makeDeps({
      activeTabId: () => "tab-a",
      tabs: () => [{ id: "tab-a" }, { id: "tab-b" }, { id: "tab-c" }],
      switchToTab,
    });
    const defs = buildHotkeyDefinitions(deps);

    defs.find(def => def.hotkey === "Mod+Shift+[")?.callback();

    expect(switchToTab).toHaveBeenCalledWith("tab-c");
  });
});
