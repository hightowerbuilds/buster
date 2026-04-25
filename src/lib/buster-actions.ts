/**
 * Action orchestrator — composes domain-specific action modules into
 * the unified BusterActions interface.
 *
 * Each domain (theme, settings, git, workspace, LSP, files, tabs, save,
 * diagnostics, session) lives in its own actions-*.ts module.
 */

import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import type { EngineMap, BusterActions } from "./buster-context";
import type { EditorEngine } from "../editor/engine";
import type { AppSettings } from "./ipc";

import { createThemeActions } from "./actions-theme";
import { createSettingsActions } from "./actions-settings";
import { createGitActions } from "./actions-git";
import { createWorkspaceActions } from "./actions-workspace";
import { createLspActions } from "./actions-lsp";
import { createFileActions } from "./actions-files";
import { createTabActions } from "./actions-tabs";
import { createSaveActions } from "./actions-save";
import { createDiagnosticActions } from "./actions-diagnostics";
import { createSessionActions } from "./actions-session";

// ── Deps interface ────────────────────────────────────────────────

export interface ActionDeps {
  store: BusterStoreState;
  setStore: SetStoreFunction<BusterStoreState>;
  engines: EngineMap;
  extChangeDiskContent: { value: string };
}

// ── Factory ───────────────────────────────────────────────────────

export function createBusterActions(deps: ActionDeps): BusterActions & {
  initSettings: () => Promise<void>;
  rebuildPalette: (s: AppSettings) => void;
  attemptLspStart: (filePath: string, workspaceRoot: string) => void;
  doTabClose: (tabId: string) => void;
} {
  const { store, setStore, engines } = deps;

  // ── Compose domain modules ──────────────────────────────────

  const theme = createThemeActions(setStore);
  const settings = createSettingsActions(store, setStore, theme.rebuildPalette);
  const git = createGitActions(store, setStore);
  const workspace = createWorkspaceActions(store, setStore, engines, git.refreshGitBranch, settings.updateSettings);
  const lsp = createLspActions(store, setStore);
  const files = createFileActions(store, setStore, switchToTab, settings.addRecentFile, git.fetchDiffHunks, lsp.attemptLspStart);
  const save = createSaveActions(store, setStore, engines, activeTab, settings.addRecentFile, git.fetchDiffHunks, files.loadFileContent, git.refreshGitBranch);
  const tabs = createTabActions(store, setStore, engines, deps.extChangeDiskContent, save.writeFileSmart);
  const diagnostics = createDiagnosticActions(store, engines, activeEngine, files.handleFileSelect);
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

  // ── Navigation history ─────────────────────────────────────

  const MAX_NAV_HISTORY = 50;

  function pushNavHistory(path: string, line: number, col: number) {
    const history = store.navHistory.slice(0, store.navHistoryIdx + 1);
    // Don't push if same as current position
    const last = history[history.length - 1];
    if (last && last.path === path && last.line === line) return;
    history.push({ path, line, col });
    if (history.length > MAX_NAV_HISTORY) history.shift();
    setStore("navHistory", history);
    setStore("navHistoryIdx", history.length - 1);
  }

  function navigateBack() {
    if (store.navHistoryIdx <= 0) return;
    const idx = store.navHistoryIdx - 1;
    const entry = store.navHistory[idx];
    if (!entry) return;
    setStore("navHistoryIdx", idx);
    files.handleFileSelect(entry.path).then(() => {
      const eng = activeEngine();
      if (eng) {
        eng.setCursor({ line: entry.line, col: entry.col });
      }
    });
  }

  function navigateForward() {
    if (store.navHistoryIdx >= store.navHistory.length - 1) return;
    const idx = store.navHistoryIdx + 1;
    const entry = store.navHistory[idx];
    if (!entry) return;
    setStore("navHistoryIdx", idx);
    files.handleFileSelect(entry.path).then(() => {
      const eng = activeEngine();
      if (eng) {
        eng.setCursor({ line: entry.line, col: entry.col });
      }
    });
  }

  // ── Return unified interface ────────────────────────────────

  return {
    // File operations
    createNewFile: tabs.createNewFile,
    handleFileSelect: files.handleFileSelect,
    handleSave: save.handleSave,
    handleSaveAs: save.handleSaveAs,
    handleSync: save.handleSync,
    loadFileContent: files.loadFileContent,

    // Tab management
    switchToTab: tabs.switchToTab,
    handleTabClose: tabs.handleTabClose,
    createTerminalTab: tabs.createTerminalTab,
    createGitTab: tabs.createGitTab,
    createSettingsTab: tabs.createSettingsTab,
    createExtensionsTab: tabs.createExtensionsTab,
    createDebugTab: tabs.createDebugTab,
    createProblemsTab: tabs.createProblemsTab,
    createBrowserTab: tabs.createBrowserTab,
    createConsoleTab: tabs.createConsoleTab,
    popOutSidebar: tabs.popOutSidebar,
    handleTermIdReady: tabs.handleTermIdReady,
    handleTermTitleChange: tabs.handleTermTitleChange,

    // Workspace
    openWorkspace: workspace.openWorkspace,
    changeDirectory: workspace.changeDirectory,
    closeDirectory: workspace.closeDirectory,
    refreshGitBranch: git.refreshGitBranch,

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

    // LSP
    restartLsp: lsp.restartLsp,

    // Diagnostics
    jumpToDiagnostic: diagnostics.jumpToDiagnostic,
    diagnosticCounts: diagnostics.diagnosticCounts,

    // Git
    fetchDiffHunks: git.fetchDiffHunks,

    // Navigation history
    pushNavHistory,
    navigateBack,
    navigateForward,

    // Session
    buildSnapshot: session.buildSnapshot,
    saveSessionNow: session.saveSessionNow,

    // Internal (exposed for BusterProvider wiring)
    initSettings: settings.initSettings,
    rebuildPalette: theme.rebuildPalette,
    attemptLspStart: lsp.attemptLspStart,
    doTabClose: tabs.doTabClose,
  };
}
