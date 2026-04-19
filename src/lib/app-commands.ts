/**
 * Command registry setup and hotkey bindings via @tanstack/solid-hotkeys.
 *
 * Default keybindings are defined here. User overrides are loaded from
 * settings.keybindings (a Record<commandId, hotkeyString>) and take
 * precedence over defaults.
 */

import { registry, type Command } from "./command-registry";
import { announce } from "./a11y";
import { closeApp } from "./session";
import type { Accessor, Setter } from "solid-js";
import type { EditorEngine } from "../editor/engine";
import type { CreateHotkeyDefinition } from "@tanstack/solid-hotkeys";
import type { RegisterableHotkey } from "@tanstack/hotkeys";

// ── Region cycling (F6 / Shift+F6) ─────────────────────────────

/** Ordered list of landmark regions for F6 cycling. */
const REGION_SELECTORS = [
  { selector: '.sidebar-wrap[role="complementary"]', label: "Sidebar" },
  { selector: '.editor-area[role="main"]', label: "Editor" },
  { selector: '.dock-bar[role="navigation"]', label: "Dock" },
];

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), canvas';

/** Focus the first focusable element inside a region. */
function focusRegion(regionEl: Element, label: string) {
  if (label === "Editor") {
    const textarea = regionEl.querySelector<HTMLElement>(".canvas-editor textarea, .canvas-terminal textarea");
    if (textarea) { textarea.focus({ preventScroll: true }); announce(label); return; }
  }
  const first = regionEl.querySelector<HTMLElement>(FOCUSABLE);
  if (first) { first.focus({ preventScroll: true }); announce(label); }
}

/** Cycle focus between landmark regions. direction: 1 = forward, -1 = backward. */
function cycleRegion(direction: 1 | -1) {
  const visible = REGION_SELECTORS
    .map(r => ({ el: document.querySelector(r.selector), label: r.label }))
    .filter(r => r.el && (r.el as HTMLElement).offsetParent !== null);

  if (visible.length === 0) return;

  const active = document.activeElement;
  let currentIdx = -1;
  for (let i = 0; i < visible.length; i++) {
    if (visible[i].el!.contains(active)) { currentIdx = i; break; }
  }

  const nextIdx = currentIdx < 0
    ? 0
    : (currentIdx + direction + visible.length) % visible.length;

  focusRegion(visible[nextIdx].el!, visible[nextIdx].label);
}

// ── Types ────────────────────────────────────────────────────────

export interface CommandDeps {
  handleSave: () => void;
  changeDirectory: () => void;
  handleTabClose: (id: string) => void;
  activeTabId: Accessor<string | null>;
  tabs: Accessor<Array<{ id: string }>>;
  switchToTab: (id: string) => void;
  activeEngine: () => EditorEngine | null;
  setFindVisible: Setter<boolean>;
  setPaletteVisible: Setter<boolean>;
  setPaletteInitialQuery: Setter<string>;
  createTerminalTab: () => void;
  createSettingsTab: () => void;
  createGitTab: () => void;
  createBrowserTab: () => void;
  setSidebarVisible: Setter<boolean>;
  jumpToDiagnostic: (direction: 1 | -1) => void;
  findVisible: Accessor<boolean>;
  paletteVisible: Accessor<boolean>;
  settings: Accessor<import("./ipc").AppSettings>;
  updateSettings: (s: import("./ipc").AppSettings) => void;
  tabTrapping: Accessor<boolean>;
  setTabTrapping: (v: boolean) => void;
}

const MAX_TAB_HOTKEYS = 9;

function tabCommandId(position: number): string {
  return `tabs.${position}`;
}

function moveTab(deps: Pick<CommandDeps, "tabs" | "activeTabId" | "switchToTab">, direction: 1 | -1) {
  const tabs = deps.tabs();
  if (tabs.length < 2) return;

  const activeId = deps.activeTabId();
  const currentIndex = tabs.findIndex((tab) => tab.id === activeId);
  if (currentIndex === -1) {
    const fallbackIndex = direction === 1 ? 0 : tabs.length - 1;
    deps.switchToTab(tabs[fallbackIndex]!.id);
    return;
  }

  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
  deps.switchToTab(tabs[nextIndex]!.id);
}

// ── Default keybinding map ───────────────────────────────────────

/** Default hotkey for each command. "Mod" maps to Cmd on Mac, Ctrl on Win/Linux. */
export const DEFAULT_KEYBINDINGS: Record<string, string> = {
  "file.save": "Mod+s",
  "file.openFolder": "Mod+o",
  "file.closeTab": "Mod+w",
  "terminal.new": "Mod+t",
  "terminal.newAlt": "Mod+`",
  "view.commandPalette": "Mod+p",
  "view.showCommands": "Mod+Shift+p",
  "view.settings": "Mod+,",
  "view.toggleSidebar": "Mod+b",
  "editor.find": "Mod+f",
  "editor.goToLine": "Ctrl+g",
  "editor.goToSymbol": "Mod+Shift+o",
  "editor.zoomIn": "Mod+=",
  "editor.zoomOut": "Mod+-",
  "editor.zoomReset": "Mod+0",
  "git.open": "Mod+Shift+g",
  "browser.open": "Mod+Shift+b",
  "editor.nextProblem": "F8",
  "editor.prevProblem": "Shift+F8",
  "view.focusNextRegion": "F6",
  "view.focusPrevRegion": "Shift+F6",
  "editor.toggleTabTrapping": "Ctrl+m",
  "tabs.prev": "Mod+Shift+[",
  "tabs.next": "Mod+Shift+]",
  ...Object.fromEntries(
    Array.from({ length: MAX_TAB_HOTKEYS }, (_, idx) => {
      const position = idx + 1;
      return [tabCommandId(position), `Mod+${position}`];
    }),
  ),
};

/** Resolve the hotkey for a command: user override → default. */
export function resolveHotkey(commandId: string, userOverrides?: Record<string, string>): string | undefined {
  return userOverrides?.[commandId] ?? DEFAULT_KEYBINDINGS[commandId];
}

// ── Command definitions (for command palette) ────────────────────

export function createAppCommands(deps: CommandDeps): Command[] {
  return [
    { id: "file.save", label: "Save", category: "File", keybinding: "Mod+S", execute: () => deps.handleSave() },
    { id: "file.openFolder", label: "Open Folder", category: "File", keybinding: "Mod+O", execute: () => deps.changeDirectory() },
    { id: "file.closeTab", label: "Close Tab / Close Window", category: "File", keybinding: "Mod+W", execute: () => { const id = deps.activeTabId(); if (id) deps.handleTabClose(id); else closeApp(); } },
    { id: "editor.find", label: "Find", category: "Editor", keybinding: "Mod+F", when: () => !!deps.activeEngine(), execute: () => deps.setFindVisible(true) },
    { id: "editor.goToLine", label: "Go to Line...", category: "Editor", keybinding: "Ctrl+G", execute: () => { deps.setPaletteInitialQuery(":"); deps.setPaletteVisible(true); } },
    { id: "editor.zoomIn", label: "Zoom In", category: "View", keybinding: "Mod+=", execute: () => deps.updateSettings({ ...deps.settings(), ui_zoom: Math.min(200, deps.settings().ui_zoom + 10) }) },
    { id: "editor.zoomOut", label: "Zoom Out", category: "View", keybinding: "Mod+-", execute: () => deps.updateSettings({ ...deps.settings(), ui_zoom: Math.max(50, deps.settings().ui_zoom - 10) }) },
    { id: "editor.zoomReset", label: "Reset Zoom", category: "View", keybinding: "Mod+0", execute: () => deps.updateSettings({ ...deps.settings(), ui_zoom: 100 }) },
    { id: "terminal.new", label: "New Terminal", category: "Terminal", keybinding: "Mod+T", execute: () => deps.createTerminalTab() },
    { id: "view.commandPalette", label: "Command Palette", category: "View", keybinding: "Mod+P", execute: () => { deps.setPaletteInitialQuery(""); deps.setPaletteVisible(true); } },
    { id: "view.showCommands", label: "Show All Commands", category: "View", keybinding: "Mod+Shift+P", execute: () => { deps.setPaletteInitialQuery(">"); deps.setPaletteVisible(true); } },
    { id: "view.settings", label: "Settings", category: "View", keybinding: "Mod+,", execute: () => deps.createSettingsTab() },
    { id: "view.toggleSidebar", label: "Toggle Sidebar", category: "View", keybinding: "Mod+B", execute: () => deps.setSidebarVisible(v => !v) },
    { id: "git.open", label: "Git", category: "Git", keybinding: "Mod+Shift+G", execute: () => deps.createGitTab() },
    { id: "browser.open", label: "Open Browser", category: "Browser", keybinding: "Mod+Shift+B", execute: () => deps.createBrowserTab() },
    { id: "editor.toggleVimMode", label: "Toggle Vim Mode", category: "Editor", execute: () => {
      const s = deps.settings();
      deps.updateSettings({ ...s, vim_mode: !s.vim_mode });
    } },
    { id: "editor.nextProblem", label: "Go to Next Problem", category: "Editor", keybinding: "F8", execute: () => deps.jumpToDiagnostic(1) },
    { id: "editor.prevProblem", label: "Go to Previous Problem", category: "Editor", keybinding: "Shift+F8", execute: () => deps.jumpToDiagnostic(-1) },
    { id: "view.focusNextRegion", label: "Focus Next Region", category: "View", keybinding: "F6", execute: () => cycleRegion(1) },
    { id: "view.focusPrevRegion", label: "Focus Previous Region", category: "View", keybinding: "Shift+F6", execute: () => cycleRegion(-1) },
    { id: "editor.toggleTabTrapping", label: "Toggle Tab Key Moves Focus", category: "Editor", keybinding: "Ctrl+M", execute: () => { const next = !deps.tabTrapping(); deps.setTabTrapping(next); announce(next ? "Tab key inserts tab character" : "Tab key moves focus", "assertive"); } },
    { id: "tabs.prev", label: "Go to Previous Tab", category: "Tabs", keybinding: "Mod+Shift+[", when: () => deps.tabs().length > 1, execute: () => moveTab(deps, -1) },
    { id: "tabs.next", label: "Go to Next Tab", category: "Tabs", keybinding: "Mod+Shift+]", when: () => deps.tabs().length > 1, execute: () => moveTab(deps, 1) },
    ...Array.from({ length: MAX_TAB_HOTKEYS }, (_, idx) => {
      const position = idx + 1;
      return {
        id: tabCommandId(position),
        label: `Go to Tab ${position}`,
        category: "Tabs",
        keybinding: `Mod+${position}`,
        when: () => deps.tabs().length >= position,
        execute: () => {
          const tab = deps.tabs()[position - 1];
          if (tab) deps.switchToTab(tab.id);
        },
      };
    }),
  ];
}

export function registerAppCommands(commands: Command[]) {
  for (const c of commands) registry.register(c);
}

export function unregisterAppCommands(commands: Command[]) {
  for (const c of commands) registry.unregister(c.id);
}

// ── TanStack Hotkey definitions ──────────────────────────────────

/**
 * Build hotkey definitions for createHotkeys().
 * Merges user overrides on top of defaults.
 */
export function buildHotkeyDefinitions(
  deps: CommandDeps,
  userOverrides?: Record<string, string>,
): CreateHotkeyDefinition[] {
  const hk = (id: string) => resolveHotkey(id, userOverrides);

  const defs: CreateHotkeyDefinition[] = [];

  const add = (id: string, callback: () => void) => {
    const hotkey = hk(id);
    if (hotkey) defs.push({ hotkey: hotkey as RegisterableHotkey, callback: () => callback() });
  };

  add("file.save", () => deps.handleSave());
  add("file.openFolder", () => deps.changeDirectory());
  // Cmd+W fallback for Linux/Windows (macOS handled by Tauri CloseRequested)
  add("file.closeTab", () => {
    const id = deps.activeTabId();
    if (id) deps.handleTabClose(id); else closeApp();
  });
  add("terminal.new", () => deps.createTerminalTab());
  // Ctrl+` as secondary terminal shortcut
  if (hk("terminal.newAlt")) {
    defs.push({ hotkey: hk("terminal.newAlt")! as RegisterableHotkey, callback: () => deps.createTerminalTab() });
  }
  add("view.commandPalette", () => { deps.setPaletteInitialQuery(""); deps.setPaletteVisible(true); });
  add("view.showCommands", () => { deps.setPaletteInitialQuery(">"); deps.setPaletteVisible(true); });
  add("view.settings", () => deps.createSettingsTab());
  add("view.toggleSidebar", () => deps.setSidebarVisible(v => !v));
  add("editor.find", () => { if (deps.activeEngine()) deps.setFindVisible(true); });
  add("editor.goToLine", () => { deps.setPaletteInitialQuery(":"); deps.setPaletteVisible(true); });
  add("editor.goToSymbol", () => { deps.setPaletteInitialQuery("@"); deps.setPaletteVisible(true); });
  add("editor.zoomIn", () => deps.updateSettings({ ...deps.settings(), ui_zoom: Math.min(200, deps.settings().ui_zoom + 10) }));
  add("editor.zoomOut", () => deps.updateSettings({ ...deps.settings(), ui_zoom: Math.max(50, deps.settings().ui_zoom - 10) }));
  add("editor.zoomReset", () => deps.updateSettings({ ...deps.settings(), ui_zoom: 100 }));
  add("git.open", () => deps.createGitTab());
  add("browser.open", () => deps.createBrowserTab());
  add("editor.nextProblem", () => deps.jumpToDiagnostic(1));
  add("editor.prevProblem", () => deps.jumpToDiagnostic(-1));
  add("view.focusNextRegion", () => cycleRegion(1));
  add("view.focusPrevRegion", () => cycleRegion(-1));
  add("editor.toggleTabTrapping", () => {
    const next = !deps.tabTrapping();
    deps.setTabTrapping(next);
    announce(next ? "Tab key inserts tab character" : "Tab key moves focus", "assertive");
  });
  add("tabs.prev", () => moveTab(deps, -1));
  add("tabs.next", () => moveTab(deps, 1));
  for (let idx = 0; idx < MAX_TAB_HOTKEYS; idx++) {
    const position = idx + 1;
    add(tabCommandId(position), () => {
      const tab = deps.tabs()[idx];
      if (tab) deps.switchToTab(tab.id);
    });
  }

  // Escape cascade (not rebindable)
  defs.push({
    hotkey: "Escape",
    callback: () => {
      if (deps.findVisible()) deps.setFindVisible(false);
      else if (deps.paletteVisible()) deps.setPaletteVisible(false);
    },
    options: { preventDefault: false },
  });

  return defs;
}
