/**
 * Action orchestrator — composes domain-specific action modules into
 * the unified BusterActions interface.
 *
 * Each domain (theme, settings, workspace, files, tabs, save, session)
 * lives in its own actions-*.ts module.
 */

import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import type { EngineMap, BusterActions } from "./buster-context";
import type { EditorEngine } from "../editor/engine";
import type { AppSettings } from "./ipc";

import { createThemeActions } from "./actions-theme";
import { createSettingsActions } from "./actions-settings";
import { createWorkspaceActions } from "./actions-workspace";
import { createFileActions } from "./actions-files";
import { createTabActions } from "./actions-tabs";
import { createSaveActions } from "./actions-save";
import { createSessionActions } from "./actions-session";

// ── Deps interface ────────────────────────────────────────────────

export interface ActionDeps {
  store: BusterStoreState;
  setStore: SetStoreFunction<BusterStoreState>;
  engines: EngineMap;
  extChangeDiskContent: { value: string; resolve?: (result: import("../ui/ExternalChangeDialog").ExternalChangeResult) => void };
  canSave?: (tabId: string) => boolean;
}

// ── Factory ───────────────────────────────────────────────────────

export function createBusterActions(deps: ActionDeps): BusterActions & {
  initSettings: () => Promise<void>;
  finishSessionRestore: () => void;
  rebuildPalette: (s: AppSettings) => void;
  doTabClose: (tabId: string) => void;
} {
  const { store, setStore, engines } = deps;

  // ── Compose domain modules ──────────────────────────────────

  const theme = createThemeActions(setStore);
  const settings = createSettingsActions(store, setStore, theme.rebuildPalette);
  const workspace = createWorkspaceActions(store, setStore, settings.updateSettings);
  const files = createFileActions(store, setStore, switchToTab, settings.addRecentFile);
  const pendingNotes = new Map<string, Promise<void>>();
  const save = createSaveActions(store, setStore, engines, activeTab, settings.addRecentFile, files.loadFileContent, pendingNotes, deps.canSave);
  const tabs = createTabActions(store, setStore, engines, deps.extChangeDiskContent, save.writeFileSmart, pendingNotes, save.queueSave, deps.canSave);
  const session = createSessionActions(store, engines);

  // ── Derived accessors (used by multiple modules) ────────────

  function activeTab() {
    return store.tabs.find(t => t.id === store.activeTabId);
  }

  function activeEngine(): EditorEngine | null {
    const tab = activeTab();
    return tab?.type === "file" ? (engines.get(tab.id) ?? null) : null;
  }

  function getFileTextForTab(tabId: string): string | null {
    return store.fileTexts[tabId] ?? null;
  }

  // Proxy switchToTab so file actions can reference it before tabs is created
  function switchToTab(tabId: string) { tabs.switchToTab(tabId); }

  // ── Return unified interface ────────────────────────────────

  return {
    // File operations
    createNewFile: tabs.createNewFile,
    handleFileSelect: files.handleFileSelect,
    openFile: files.openFile,
    handleSave: save.handleSave,
    handleSaveAs: save.handleSaveAs,
    saveTab: save.saveTab,
    handleSync: save.handleSync,
    loadFileContent: files.loadFileContent,

    // Tab management
    switchToTab: tabs.switchToTab,
    openTabAlongside: tabs.openTabAlongside,
    closeSplitView: tabs.closeSplitView,
    setSplitRatio: tabs.setSplitRatio,
    reorderTabs: tabs.reorderTabs,
    handleTabClose: tabs.handleTabClose,
    createSettingsTab: tabs.createSettingsTab,
    createKeybindingsTab: tabs.createKeybindingsTab,
    createAiTab: tabs.createAiTab,

    // Workspace
    openWorkspace: workspace.openWorkspace,
    changeDirectory: workspace.changeDirectory,
    closeDirectory: workspace.closeDirectory,

    // Dialog results
    handleDirtyCloseResult: tabs.handleDirtyCloseResult,
    handleExternalChangeResult: tabs.handleExternalChangeResult,

    // Derived
    activeTab,
    activeEngine,
    getFileTextForTab,

    // Settings
    updateSettings: settings.updateSettings,
    addRecentFile: settings.addRecentFile,

    // Session
    buildSnapshot: session.buildSnapshot,
    saveSessionNow: session.saveSessionNow,

    // Internal (exposed for BusterProvider wiring)
    initSettings: settings.initSettings,
    finishSessionRestore: session.finishSessionRestore,
    rebuildPalette: theme.rebuildPalette,
    doTabClose: tabs.doTabClose,
  };
}
