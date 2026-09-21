/**
 * BusterProvider — central state provider for the Buster IDE.
 *
 * Owns the createStore and engine Map. All action implementations
 * live in buster-actions.ts via dependency injection.
 * This file handles: store creation, effects, event listeners, initialization.
 */

import { type Component, type JSX, batch, untrack, createEffect, createSignal, Show, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { BusterContext, type BusterContextValue, type EngineMap } from "./buster-context";
import type { BusterStoreState } from "./store-types";
import type { Tab } from "./tab-types";
import type { EditorEngine } from "../editor/engine";
import { showInfo, showError } from "./notify";
import { createBusterActions } from "./buster-actions";
import { createWorkbenchCommands } from "./workbench-commands";
import { focusTabPanel } from "./focus-service";
import { registerSelectionCommands } from "./selection-commands";
import { clipboardWrite } from "./clipboard";
import { createWritingReview, registerWritingReviewCommands } from "./writing-review";
import { generateWriting } from "./writing-ai-transport";
import { lookupSelection } from "./selection-lookup";
import { createSpeech, nativeSpeechTransport, registerSpeechCommands } from "./speech";
import { CommandFailure } from "./feature-commands";

import { setWorkspaceRootIpc, loadBackupBuffer, watchFile } from "./ipc";
import type { AppSettings } from "./ipc";
import { loadSessionFromDisk } from "./session";
import { MAX_PANES, newPaneWorkspace } from "./writing-panes";
import { prepareSessionRestore } from "./session-restore";
import { setupFileWatcher } from "./file-watcher";
import { setupSurfaceMeasureListener } from "./surface-measure";
// Surface events use a different shape than the IPC SurfaceEvent type
interface SurfaceTabEvent {
  type: string;
  data: { tab_id: string; label?: string; extension_id?: string; tab_type?: string };
}
import { setupMenuHandlers } from "./menu-handlers";
import { type PanelCount } from "./panel-count";
import { listen } from "@tauri-apps/api/event";
import { CATPPUCCIN } from "./theme";
import { resolveEditorSettings } from "./editor-settings";
import { DEFAULT_FONT_FAMILY, setEditorFontFamily } from "../editor/text-measure";

// ── Default settings ─────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  word_wrap: true,
  font_size: 14,
  font_family: DEFAULT_FONT_FAMILY,
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
  keybindings: {},
  syntax_colors: {},
  format_on_save: false,
  auto_save: false,
  auto_save_delay_ms: 1500,
  language_settings: {},
  vim_mode: false,
  blog_theme: "normal",
  show_indent_guides: true,
  show_whitespace: false,
  terminal_font_family: "",
  terminal_shell: "",
  terminal_bell_mode: "visual",
  terminal_scrollback_rows: 10_000,
  ai_completion_enabled: false,
  ai_provider: "ollama",
  ai_api_key: "",
  ai_model: "claude-haiku-4-5-20250514",
  ai_local_model: "gemma3:4b",
  ai_ollama_url: "http://localhost:11434",
  ai_stop_on_newline: true,
  ai_debounce_local_ms: 1500,
  ai_debounce_cloud_ms: 500,
  ai_min_prefix_chars: 3,
  ai_cache_enabled: true,
  ai_cache_size: 24,
  ai_disabled_languages: [],
  ai_token_budget_monthly: 0,
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
  paneWorkspace: newPaneWorkspace(),
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


  navHistory: [],
  navHistoryIdx: -1,

  recentFiles: JSON.parse(localStorage.getItem(RECENT_FILES_KEY) || "[]"),
  tabTrapping: true,
  lspState: "inactive",
  lspLanguages: [],
  vimMode: null,
};

// ── Provider component ───────────────────────────────────────

const BusterProvider: Component<{ children: JSX.Element }> = (props) => {
  const [initialized, setInitialized] = createSignal(false);
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
  const commands = createWorkbenchCommands({
    tabs: () => store.tabs,
    activeTabId: () => store.activeTabId,
    workspaceRoot: () => store.workspaceRoot,
    terminalId: (id) => store.termPtyIds[id],
    document: (id) => {
      const engine = engines.get(id);
      return engine ? { text: engine.getText(), revision: engine.editSeq(), dirty: engine.dirty() } : null;
    },
    createTerminal: actions.createTerminalTab,
    focusTab: (id) => { actions.switchToTab(id); focusTabPanel(id); },
    paneWorkspace: () => store.paneWorkspace,
    panes: actions.panes,
    createNote: actions.createNewFile,
  });

  // ── Session persistence ─────────────────────────────────────
  registerSelectionCommands(commands, {
    workspace: () => store.paneWorkspace, engine: id => engines.get(id),
    readClipboard: () => navigator.clipboard.readText(), writeClipboard: clipboardWrite,
  });
  const writing = createWritingReview({
    workspace: () => store.paneWorkspace,
    engine: id => engines.get(id),
    hasTab: id => store.tabs.some(tab => tab.id === id),
    openPanel: (id, kind, sourcePaneId) => batch(() => {
      const empty = store.paneWorkspace.panes.find(p => p.id !== sourcePaneId && !p.tabId);
      if (!empty && store.paneWorkspace.panes.length >= MAX_PANES)
        throw new CommandFailure("LIMIT_REACHED", "Close a pane view to make room for the review. Its note will remain open in a tab.");
      const paneId = empty?.id ?? actions.panes.splitPane("right", "empty", sourcePaneId);
      const tabId = `review_${id}`;
      setStore("tabs", tabs => [...tabs, { id: tabId, name: kind === "lookup" ? "Look up" : "AI review", path: id, type: "writing-review", dirty: false }]);
      setStore("paneWorkspace", "zoomedPaneId", null);
      actions.panes.showDocument(tabId, paneId);
      return tabId;
    }),
    createNote: (text, reviewTabId) => batch(() => {
      actions.switchToTab(reviewTabId);
      const id = actions.createNewFile();
      setStore("fileTexts", id, text);
      const engine = engines.get(id);
      if (engine) { engine.loadText(text); engine.markDirty(); }
      setStore("tabs", tab => tab.id === id, "dirty", true);
      return id;
    }),
    focusSource: target => { actions.switchToTab(target.tabId); focusTabPanel(target.tabId); },
    closePanel: actions.handleTabClose,
    generate: generateWriting,
    lookup: lookupSelection,
  });
  registerWritingReviewCommands(commands, writing);
  createEffect(() => {
    store.tabs.map(tab => tab.id);
    untrack(() => writing.reconcile());
  });
  onCleanup(writing.dispose);
  const speech = createSpeech({
    workspace: () => store.paneWorkspace,
    engine: id => engines.get(id),
    hasTab: id => store.tabs.some(tab => tab.id === id),
    focusSource: target => { actions.switchToTab(target.tabId); focusTabPanel(target.tabId); },
    transport: nativeSpeechTransport,
  });
  registerSpeechCommands(commands, speech);
  onCleanup(speech.dispose);

  const autoSaveInterval = setInterval(actions.saveSessionNow, 30_000);
  onCleanup(() => clearInterval(autoSaveInterval));

  const dirtySinceByTab = new Map<string, number>();
  const editSeqByTab = new Map<string, number>();
  const fileAutoSaveInterval = setInterval(() => {
    const now = Date.now();
    for (const tab of store.tabs) {
      if (tab.type !== "file" || !tab.path) {
        dirtySinceByTab.delete(tab.id);
        editSeqByTab.delete(tab.id);
        continue;
      }

      const engine = engines.get(tab.id);
      if (!engine || !engine.dirty()) {
        dirtySinceByTab.delete(tab.id);
        editSeqByTab.delete(tab.id);
        continue;
      }

      const seq = engine.editSeq();
      if (editSeqByTab.get(tab.id) !== seq) {
        editSeqByTab.set(tab.id, seq);
        dirtySinceByTab.set(tab.id, now);
      }

      const editorSettings = resolveEditorSettings(store.settings, tab.path);
      if (!editorSettings.auto_save) continue;

      const dirtySince = dirtySinceByTab.get(tab.id) ?? now;
      if (now - dirtySince >= editorSettings.auto_save_delay_ms) {
        dirtySinceByTab.set(tab.id, now);
        actions.saveTab(tab.id, { silent: true, requirePath: true }).catch(() => {});
      }
    }
  }, 500);
  onCleanup(() => clearInterval(fileAutoSaveInterval));

  const handleVisibility = () => { if (document.hidden) actions.saveSessionNow(); };
  document.addEventListener("visibilitychange", handleVisibility);
  onCleanup(() => document.removeEventListener("visibilitychange", handleVisibility));

  // Cmd+W fires both menu-close-tab AND CloseRequested on macOS.
  // We only save session here — never destroy the window (causes CFRelease crash).
  // Use Cmd+Q to quit the app.
  listen("window-close-requested", async () => {
    await actions.saveSessionNow();
  }).then(u => menuListeners.push(u));

  // ── Effects ─────────────────────────────────────────────────

  // Sync workspace root to Rust backend
  createEffect(() => {
    setWorkspaceRootIpc(store.workspaceRoot ?? null).catch(() => {});
  });

  createEffect(() => {
    setEditorFontFamily(store.settings.font_family);
  });

  // Keep activeFilePath in sync with active tab
  createEffect(() => {
    const tab = actions.activeTab();
    setStore("activeFilePath", tab?.type === "file" ? tab.path : null);
    const cursor = tab ? engines.get(tab.id)?.cursor() : null;
    setStore("cursorLine", cursor?.line ?? 0);
    setStore("cursorCol", cursor?.col ?? 0);
  });

  // ── Initialization ──────────────────────────────────────────

  // Crash detection
  import("./ipc").then(({ setRunningFlag }) => {
    setRunningFlag().then(wasDirty => {
      if (wasDirty) console.info("Previous session did not exit cleanly; checking recovery data.");
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

  // Menu handlers (Cmd+Z, Cmd+C, etc.)
  setupMenuHandlers({
    activeEngine: actions.activeEngine,
    changeDirectory: actions.changeDirectory,
    closeDirectory: actions.closeDirectory,
    openExtensions: actions.createExtensionsTab,
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
    let restoredPaneId: string | null = null;
    try {
      const session = await loadSessionFromDisk();
      if (session) {
        await setWorkspaceRootIpc(session.workspace_root);
        const restored = await prepareSessionRestore(session, {
          readFile: async path => (await actions.loadFileContent(path)).content,
          readBackup: loadBackupBuffer,
        });
        setStore("workspaceRoot", session.workspace_root);
        setStore("sidebarVisible", session.sidebar_visible ?? true);
        const sw = session.sidebar_width;
        setStore("sidebarWidth", sw >= 140 && sw <= 600 ? sw : 220);
        setStore("fileTexts", restored.fileTexts);
        setStore("scrollPositions", restored.scrollPositions);
        setStore("tabs", restored.tabs);
        setStore("paneWorkspace", restored.paneWorkspace);
        restoredPaneId = restored.paneWorkspace.activePaneId;
        for (const tab of restored.tabs) {
          const file = tab.id.match(/^file_(\d+)$/);
          const term = tab.id.match(/^term_tab_(\d+)$/);
          if (file) setStore("fileTabCounter", c => Math.max(c, Number(file[1])));
          if (term) setStore("terminalCounter", c => Math.max(c, Number(term[1])));
          if (tab.type === "file" && tab.path) {
            watchFile(tab.path).catch(() => {});
            if (session.workspace_root) actions.attemptLspStart(tab.path, session.workspace_root);
          }
        }
        setStore("activeTabId", restored.activeTabId);
        if (restored.skipped.length) showInfo(`Skipped ${restored.skipped.length} unavailable or retired session tabs`);
        if (restored.tabs.some(tab => tab.dirty)) showInfo("Restored unsaved writing from session backups");
      }
      actions.finishSessionRestore();
    } catch (error) {
      // Keep the prior on-disk session intact if recovery is incomplete.
      console.error("Session recovery failed:", error);
      showError("Session recovery failed — automatic session saves are paused. Existing backups are preserved.");
    } finally {
      setInitialized(true);
      // WebKit can initially focus the first mounted input. Restore the saved
      // pane after mounting, including when the terminal is still spawning.
      if (restoredPaneId) actions.panes.focusPane(restoredPaneId);
    }
  })();

  // ── Build context value ─────────────────────────────────────

  const ctx: BusterContextValue = { store, setStore, engines, actions, commands, writing, speech };

  return (
    <BusterContext.Provider value={ctx}>
      <Show when={initialized()} fallback={<div role="status">Restoring your workspace…</div>}>
        {props.children}
      </Show>
    </BusterContext.Provider>
  );
};

export default BusterProvider;
