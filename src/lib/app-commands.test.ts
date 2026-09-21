import { describe, expect, it, vi } from "vitest";

vi.mock("./a11y", () => ({
  announce: vi.fn(),
}));

vi.mock("./session", () => ({
  closeApp: vi.fn(),
}));

import { buildHotkeyDefinitions, DEFAULT_KEYBINDINGS } from "./app-commands";
import type { CommandDeps } from "./app-commands";
import { createEditorEngine } from "../editor/engine";

function makeDeps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  return {
    createNewFile: vi.fn(),
    handleSaveAs: vi.fn(),
    splitRight: vi.fn(),
    splitDown: vi.fn(),
    closeSplit: vi.fn(),
    navigatePane: vi.fn(), resizePane: vi.fn(), zoomPane: vi.fn(),
    closeTabOrSplit: vi.fn(),
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
    createKeybindingsTab: vi.fn(),
    createGitTab: vi.fn(),
    createBrowserTab: vi.fn(),
    setSidebarVisible: vi.fn(),
    jumpToDiagnostic: vi.fn(),
    findVisible: () => false,
    paletteVisible: () => false,
    settings: () => ({ word_wrap: true, font_size: 14, font_family: "JetBrains Mono, Menlo, Monaco, Consolas, monospace", tab_size: 4, use_spaces: true, minimap: false, line_numbers: true, cursor_blink: true, autocomplete: true, ui_zoom: 100, recent_folders: [], theme_mode: "dark", theme_hue: -1, effect_cursor_glow: 0, effect_vignette: 0, effect_grain: 0, syntax_colors: {}, format_on_save: false, auto_save: false, auto_save_delay_ms: 1500, language_settings: {}, blog_theme: "normal", show_indent_guides: true, show_whitespace: false, terminal_font_family: "", terminal_shell: "", terminal_bell_mode: "visual", terminal_scrollback_rows: 10_000, ai_completion_enabled: false, ai_provider: "ollama", ai_api_key: "", ai_model: "claude-haiku-4-5-20250514", ai_local_model: "gemma3:4b", ai_ollama_url: "http://localhost:11434", ai_stop_on_newline: true, ai_debounce_local_ms: 1500, ai_debounce_cloud_ms: 500, ai_min_prefix_chars: 3, ai_cache_enabled: true, ai_cache_size: 24, ai_disabled_languages: [], ai_token_budget_monthly: 0 }),
    updateSettings: vi.fn(),
    tabTrapping: () => true,
    setTabTrapping: vi.fn(),
    navigateBack: vi.fn(),
    navigateForward: vi.fn(),
    ...overrides,
  };
}

function fireHotkey(defs: ReturnType<typeof buildHotkeyDefinitions>, hotkey: string) {
  const definition = defs.find(def => String(def.hotkey) === hotkey);
  expect(definition, `Missing shortcut: ${hotkey}`).toBeDefined();
  if (definition) definition.callback({} as KeyboardEvent, {} as Parameters<typeof definition.callback>[1]);
}

describe("tab hotkeys", () => {
  it("registers pane shortcuts once and keeps tab-close distinct from pane-close", () => {
    const deps = makeDeps();
    const defs = buildHotkeyDefinitions(deps);
    const keys = defs.map(def => String(def.hotkey));
    expect(new Set(keys).size).toBe(keys.length);
    fireHotkey(defs, "Mod+w");
    expect(deps.closeTabOrSplit).toHaveBeenCalledOnce();
    expect(deps.closeSplit).not.toHaveBeenCalled();
    fireHotkey(defs, "Mod+Shift+w");
    expect(deps.closeSplit).toHaveBeenCalledOnce();
    fireHotkey(defs, "Mod+Alt+ArrowRight");
    expect(deps.navigatePane).toHaveBeenCalledWith("right");
  });

  it("lets terminal find and Escape reach the focused panel", () => {
    const terminalDefs = buildHotkeyDefinitions(makeDeps());
    expect(terminalDefs.find(def => String(def.hotkey) === "Mod+f")?.options?.enabled).toBe(false);
    expect(terminalDefs.find(def => def.hotkey === "Escape")?.options?.stopPropagation).toBe(false);
    const engine = createEditorEngine("draft");
    const deps = makeDeps({ activeEngine: () => engine });
    const editorDefs = buildHotkeyDefinitions(deps);
    expect(editorDefs.find(def => String(def.hotkey) === "Mod+f")?.options?.enabled).toBe(true);
    fireHotkey(editorDefs, "Mod+f");
    expect(deps.setFindVisible).toHaveBeenCalledWith(true);
  });

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

    fireHotkey(defs, "Mod+2");
    fireHotkey(defs, "Mod+3");

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

    fireHotkey(defs, "Mod+4");

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

    fireHotkey(defs, "Mod+Shift+[");
    fireHotkey(defs, "Mod+Shift+]");

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

    fireHotkey(defs, "Mod+Shift+[");

    expect(switchToTab).toHaveBeenCalledWith("tab-c");
  });
});

describe("keybinding cheat sheet hotkey", () => {
  it("does not register the default two-step chord as a single hotkey", () => {
    const deps = makeDeps();
    const defs = buildHotkeyDefinitions(deps);

    expect(DEFAULT_KEYBINDINGS["view.keybindings"]).toBe("Mod+k Mod+s");
    expect(defs.some(def => String(def.hotkey) === "Mod+k Mod+s")).toBe(false);
  });

  it("registers a single-stroke custom shortcut for the keyboard shortcuts tab", () => {
    const createKeybindingsTab = vi.fn();
    const deps = makeDeps({ createKeybindingsTab });
    const defs = buildHotkeyDefinitions(deps, { "view.keybindings": "Mod+/" });

    fireHotkey(defs, "Mod+/");

    expect(createKeybindingsTab).toHaveBeenCalledOnce();
  });
});
