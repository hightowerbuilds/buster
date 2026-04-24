/**
 * BusterProvider — central state provider for the Buster IDE.
 *
 * Owns the createStore and engine Map. All action implementations
 * live in buster-actions.ts via dependency injection.
 * This file handles: store creation, effects, event listeners, initialization.
 */

import { type Component, type JSX, createEffect, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { BusterContext, type BusterContextValue, type EngineMap } from "./buster-context";
import type { BusterStoreState } from "./store-types";
import type { Tab } from "./tab-types";
import type { EditorEngine } from "../editor/engine";
import { showInfo } from "./notify";
import { setupDebugEventListener } from "./debug-events";
import { createBusterActions } from "./buster-actions";

import { setWorkspaceRootIpc } from "./ipc";
import type { AppSettings } from "./ipc";
import { loadSessionFromDisk, closeApp } from "./session";
import { setupFileWatcher } from "./file-watcher";
import { setupSurfaceMeasureListener } from "./surface-measure";
// Surface events use a different shape than the IPC SurfaceEvent type
interface SurfaceTabEvent {
  type: string;
  data: { tab_id: string; label?: string; extension_id?: string; tab_type?: string };
}
import { setupMenuHandlers } from "./menu-handlers";
import { parsePanelCount, type PanelCount } from "./panel-count";
import { listen } from "@tauri-apps/api/event";
import { CATPPUCCIN } from "./theme";

// ── Default settings ─────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  word_wrap: true,
  font_size: 14,
  tab_size: 4,
  use_spaces: true,
  minimap: false,
  line_numbers: true,
  cursor_blink: true,
  autocomplete: true,
  ui_zoom: 100,
  recent_folders: [],
  theme_mode: "dark",
  theme_hue: -1,
  effect_cursor_glow: 0,
  effect_vignette: 0,
  effect_grain: 0,
  vim_mode: false,
  blog_theme: "normal",
};

const RECENT_FILES_KEY = "buster-recent-files";

// ── Initial store state ──────────────────────────────────────

const INITIAL_STATE: BusterStoreState = {
  tabs: [],
  activeTabId: null,
  fileTexts: {},
  scrollPositions: {},
  termPtyIds: {},
  terminalCounter: 0,
  fileTabCounter: 0,

  cursorLine: 0,
  cursorCol: 0,

  findVisible: false,
  paletteVisible: false,
  paletteInitialQuery: "",
  branchPickerVisible: false,
  syncing: false,
  fileLoading: false,

  panelCount: 1 as PanelCount,
  splitDirection: "row" as "row" | "column",
  layoutTree: { kind: "leaf" as const, tabIndex: 0 },
  sidebarWidth: 220,
  sidebarVisible: true,

  gitBranchName: null,
  diffHunksMap: {},

  dirtyCloseTabId: null,
  dirtyCloseFileName: "",
  extChangeTabId: null,
  extChangeFileName: "",

  searchMatches: [],
  currentSearchIdx: -1,
  diagnosticsMap: {},

  settings: DEFAULT_SETTINGS,
  palette: CATPPUCCIN,
  workspaceRoot: null,
  activeFilePath: null,

  debugModeVisible: false,
  debugSessionState: "idle",
  debugStackFrames: [],
  debugVariables: [],
  debugOutput: [],
  debugSelectedFrameId: null,

  recentFiles: JSON.parse(localStorage.getItem(RECENT_FILES_KEY) || "[]"),
  tabTrapping: true,
  lspState: "inactive",
  lspLanguages: [],
  vimMode: null,
};

// ── Provider component ───────────────────────────────────────

const BusterProvider: Component<{ children: JSX.Element }> = (props) => {
  const [store, setStore] = createStore<BusterStoreState>({ ...INITIAL_STATE });

  // Engine map (non-reactive — EditorEngine instances can't be proxied)
  const engineMapRaw = new Map<string, EditorEngine>();
  const engines: EngineMap = {
    get: (id) => engineMapRaw.get(id),
    set: (id, e) => { engineMapRaw.set(id, e); },
    delete: (id) => { engineMapRaw.delete(id); },
    get map() { return engineMapRaw; },
  };

  // Mutable ref for external change disk content
  const extChangeDiskContent = { value: "" };

  // Unlisten handles
  const menuListeners: Array<() => void> = [];
  onCleanup(() => menuListeners.forEach(u => u()));

  // ── Create actions via dependency injection ─────────────────

  const allActions = createBusterActions({ store, setStore, engines, extChangeDiskContent });
  const actions = allActions; // allActions includes internal methods too

  // ── Session persistence ─────────────────────────────────────

  const autoSaveInterval = setInterval(actions.saveSessionNow, 30_000);
  onCleanup(() => clearInterval(autoSaveInterval));

  const handleVisibility = () => { if (document.hidden) actions.saveSessionNow(); };
  document.addEventListener("visibilitychange", handleVisibility);
  onCleanup(() => document.removeEventListener("visibilitychange", handleVisibility));

  // Red X button → save session and close the window
  listen("window-close-requested", async () => {
    await actions.saveSessionNow();
    await closeApp();
  }).then(u => menuListeners.push(u));

  // ── Effects ─────────────────────────────────────────────────

  // Sync workspace root to Rust backend
  createEffect(() => {
    setWorkspaceRootIpc(store.workspaceRoot ?? null).catch(() => {});
  });

  // Keep activeFilePath in sync with active tab
  createEffect(() => {
    const tab = actions.activeTab();
    setStore("activeFilePath", tab?.type === "file" ? tab.path : null);
  });

  // ── Initialization ──────────────────────────────────────────

  // Crash detection
  import("./ipc").then(({ setRunningFlag }) => {
    setRunningFlag().then(wasDirty => {
      if (wasDirty) showInfo("Recovered unsaved changes from last session");
    }).catch(() => {});
  });

  actions.initSettings();

  // File watcher
  setupFileWatcher({
    getTabs: () => store.tabs,
    getEngine: (tabId) => engines.get(tabId),
    showConflictDialog: (tabId, fileName, diskContent) => {
      extChangeDiskContent.value = diskContent;
      setStore("extChangeTabId", tabId);
      setStore("extChangeFileName", fileName);
    },
  }).then(u => menuListeners.push(u));

  // LSP diagnostics listener
  listen<{ file_path: string; diagnostics: { file_path: string; line: number; col: number; end_line: number; end_col: number; severity: number; message: string }[] }>("lsp-diagnostics", (event) => {
    const { file_path, diagnostics } = event.payload;
    if (diagnostics.length === 0) {
      setStore("diagnosticsMap", produce(dm => { delete dm[file_path]; }));
    } else {
      setStore("diagnosticsMap", file_path, diagnostics.map(d => ({
        line: d.line, col: d.col, endLine: d.end_line, endCol: d.end_col,
        severity: d.severity, message: d.message,
      })));
    }
  }).then(u => menuListeners.push(u));

  // Surface events from extensions and built-in browser
  listen<SurfaceTabEvent>("surface-event", (event) => {
    const ev = event.payload;
    if (ev.type === "tab_created") {
      const tabId = ev.data.tab_id;
      const label = ev.data.label ?? "Extension";
      const existing = store.tabs.find(t => t.id === tabId);
      if (!existing) {
        const tabType = ev.data.tab_type === "browser" ? "browser" : "surface";
        const newTab: Tab = {
          id: tabId,
          name: label,
          path: JSON.stringify({ extension_id: ev.data.extension_id }),
          dirty: false,
          type: tabType,
        };
        setStore("tabs", [...store.tabs, newTab]);
      }
      actions.switchToTab(tabId);
    }
  }).then(u => menuListeners.push(u));

  // Surface text-measurement listener
  setupSurfaceMeasureListener().then(u => menuListeners.push(u));

  // Debug event forwarding
  setupDebugEventListener({
    onStateChange: (state) => setStore("debugSessionState", state),
    onStackFrames: (frames) => setStore("debugStackFrames", frames),
    onVariables: (vars) => setStore("debugVariables", vars),
    onOutput: (_cat, text) => setStore("debugOutput", produce(o => o.push(text))),
    onSessionEnd: () => {
      setStore("debugSessionState", "idle");
      setStore("debugStackFrames", []);
      setStore("debugVariables", []);
    },
  }).then(u => menuListeners.push(u));

  // Menu handlers (Cmd+Z, Cmd+C, etc.)
  setupMenuHandlers({
    activeEngine: actions.activeEngine,
    changeDirectory: actions.changeDirectory,
    closeDirectory: actions.closeDirectory,
    openExtensions: actions.createExtensionsTab,
    openDebug: actions.createDebugTab,
    openSettings: actions.createSettingsTab,
    closeActiveTab: () => {
      const id = store.activeTabId;
      if (id) actions.handleTabClose(id);
    },
    createNewFile: actions.createNewFile,
    handleSave: actions.handleSave,
    handleSaveAs: actions.handleSaveAs,
  }).then(handles => menuListeners.push(...handles));

  // ── Restore session ─────────────────────────────────────────

  (async () => {
    try {
      const session = await loadSessionFromDisk();
      if (!session) return;
      setStore("panelCount", parsePanelCount(session.layout_mode));
      setStore("sidebarVisible", session.sidebar_visible ?? true);
      const sw = session.sidebar_width;
      setStore("sidebarWidth", sw && sw >= 140 && sw <= 600 ? sw : 220);

      for (const stab of session.tabs) {
        if (stab.type === "file" || stab.type === "image") {
          continue;
        } else if (stab.type === "terminal") {
          setStore("terminalCounter", c => c + 1);
          const tabId = `term_tab_${store.terminalCounter}`;
          setStore("tabs", produce(tabs => {
            tabs.push({ id: tabId, name: stab.name || "Terminal", path: "", dirty: false, type: "terminal" });
          }));
        } else if (["settings", "git", "extensions", "debug", "explorer"].includes(stab.type)) {
          setStore("tabs", produce(tabs => {
            tabs.push({ id: stab.id, name: stab.name, path: "", dirty: false, type: stab.type as Tab["type"] });
          }));
        }
      }

      for (const t of store.tabs) {
        const m = t.id.match(/^file_(\d+)$/);
        if (m) setStore("fileTabCounter", Math.max(store.fileTabCounter, Number(m[1])));
        const tm = t.id.match(/^term_tab_(\d+)$/);
        if (tm) setStore("terminalCounter", Math.max(store.terminalCounter, Number(tm[1])));
      }

      if (session.active_tab_id && store.tabs.some(t => t.id === session.active_tab_id)) {
        setStore("activeTabId", session.active_tab_id);
      } else if (store.tabs.length > 0) {
        setStore("activeTabId", store.tabs[0].id);
      }
    } catch (e) { console.warn("Session restore failed:", e); }
  })();

  // ── Build context value ─────────────────────────────────────

  const ctx: BusterContextValue = { store, setStore, engines, actions };

  return (
    <BusterContext.Provider value={ctx}>
      {props.children}
    </BusterContext.Provider>
  );
};

export default BusterProvider;
