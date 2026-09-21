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
import { createWritingAppearance, registerWritingAppearanceCommands, WRITING_APPEARANCE_KEY } from "./writing-appearance";
import { createWritingFormatting, registerWritingFormattingCommands } from "./writing-format";
import { createSearchPortal, registerSearchPortalCommands } from "./search-portal";

import { setWorkspaceRootIpc, loadBackupBuffer, watchFile, unwatchFile } from "./ipc";
import type { AppSettings } from "./ipc";
import { loadSessionFromDisk } from "./session";
import { MAX_PANES, newPaneWorkspace } from "./writing-panes";
import { prepareSessionRestore } from "./session-restore";
import { isNotesPath, movedFilePath } from "./notes-storage";
import { initializeNotesWorkspace } from "./ipc";
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
  notesRoot: null,
  notesDesktopLink: null,
  notesStorageWarning: null,
  activeFilePath: null,


  navHistory: [],
  navHistoryIdx: -1,

  recentFiles: JSON.parse(localStorage.getItem(RECENT_FILES_KEY) || "[]"),
  tabTrapping: true,
  lspState: "inactive",
  lspLanguages: [],
};

// ── Provider component ───────────────────────────────────────

const BusterProvider: Component<{ children: JSX.Element }> = (props) => {
  const [initialized, setInitialized] = createSignal(false);
  const [store, setStore] = createStore<BusterStoreState>({ ...INITIAL_STATE });

  // Engine map (non-reactive — EditorEngine instances can't be proxied)
  const engineMapRaw = new Map<string, EditorEngine>();
  const [engineRevision, setEngineRevision] = createSignal(0);
  const engines: EngineMap = {
    revision: engineRevision,
    get: (id) => engineMapRaw.get(id),
    set: (id, e) => { engineMapRaw.set(id, e); setEngineRevision(n => n + 1); },
    delete: (id) => { engineMapRaw.delete(id); setEngineRevision(n => n + 1); },
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
  let reviewPaneOverride: string | null = null;
  const writing = createWritingReview({
    workspace: () => store.paneWorkspace,
    engine: id => engines.get(id),
    hasTab: id => store.tabs.some(tab => tab.id === id),
    openPanel: (id, kind, sourcePaneId) => batch(() => {
      const empty = store.paneWorkspace.panes.find(p => p.id !== sourcePaneId && !p.tabId);
      const preferred = reviewPaneOverride && store.paneWorkspace.panes.some(p => p.id === reviewPaneOverride) ? reviewPaneOverride : null;
      if (!preferred && !empty && store.paneWorkspace.panes.length >= MAX_PANES)
        throw new CommandFailure("LIMIT_REACHED", "Close a pane view to make room for the review. Its note will remain open in a tab.");
      const paneId = preferred ?? empty?.id ?? actions.panes.splitPane("right", "empty", sourcePaneId);
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
  const formatting = createWritingFormatting({
    workspace: () => store.paneWorkspace, tabs: () => store.tabs,
    engine: id => { engines.revision(); return engines.get(id); },
  });
  registerWritingFormattingCommands(commands, formatting);
  const search = createSearchPortal({
    workspace: () => store.paneWorkspace,
    notes: () => store.tabs.filter(tab => tab.type === "file").map(tab => ({ tabId: tab.id, name: tab.name })),
    engine: id => { engines.revision(); return engines.get(id); },
    hasTab: id => store.tabs.some(tab => tab.id === id),
    openPanel: (id, sourcePaneId) => batch(() => {
      const empty = store.paneWorkspace.panes.find(pane => pane.id !== sourcePaneId && !pane.tabId);
      // At the pane limit keep the source in its tab and temporarily show the portal in its pane.
      const paneId = empty?.id ?? (store.paneWorkspace.panes.length < MAX_PANES
        ? actions.panes.splitPane("right", "empty", sourcePaneId) : sourcePaneId);
      const tabId = `search_${id}`;
      setStore("tabs", tabs => [...tabs, { id: tabId, name: "AI search", path: id, type: "search-portal", dirty: false }]);
      setStore("paneWorkspace", "zoomedPaneId", null);
      actions.panes.showDocument(tabId, paneId);
      queueMicrotask(() => focusTabPanel(tabId));
      return tabId;
    }),
    focusPanel: id => { actions.switchToTab(id); focusTabPanel(id); },
    closePanel: actions.handleTabClose,
    focusSource: target => { actions.switchToTab(target.tabId); focusTabPanel(target.tabId); },
    createNote: (text, portalTabId) => batch(() => {
      actions.switchToTab(portalTabId);
      const id = actions.createNewFile(); setStore("fileTexts", id, text);
      const engine = engines.get(id); if (engine) { engine.loadText(text); engine.markDirty(); }
      setStore("tabs", tab => tab.id === id, "dirty", true); return id;
    }),
    reviewPassage: (target, portalTabId) => {
      const portalPaneId = store.paneWorkspace.panes.find(p => p.tabId === portalTabId)?.id;
      actions.switchToTab(target.tabId); focusTabPanel(target.tabId);
      const engine = engines.get(target.tabId);
      const pane = store.paneWorkspace.panes.find(p => p.tabId === target.tabId);
      if (!engine || !pane) throw new CommandFailure("NOT_FOUND", "The source note is no longer available.");
      engine.setSelection(target.range.anchor, target.range.head);
      // Reuse the portal view at the pane limit; both source and portal tabs remain open.
      reviewPaneOverride = store.paneWorkspace.panes.length >= MAX_PANES ? portalPaneId ?? pane.id : null;
      try { return writing.start({ ...target, paneId: pane.id }, "ai"); }
      finally { reviewPaneOverride = null; }
    },
  });
  registerSearchPortalCommands(commands, search);
  createEffect(() => { store.tabs.map(tab => tab.id); untrack(() => search.reconcile()); });
  const appearance = createWritingAppearance({
    paneIds: () => store.paneWorkspace.panes.map(pane => pane.id),
    workspaceId: () => store.workspaceRoot,
    load: () => localStorage.getItem(WRITING_APPEARANCE_KEY),
    save: value => localStorage.setItem(WRITING_APPEARANCE_KEY, value),
  });
  registerWritingAppearanceCommands(commands, appearance);
  onCleanup(speech.dispose);

  const autoSaveInterval = setInterval(actions.saveSessionNow, 30_000);
  onCleanup(() => clearInterval(autoSaveInterval));

  const dirtySinceByTab = new Map<string, number>();
  const editSeqByTab = new Map<string, number>();
  const fileAutoSaveInterval = setInterval(() => {
    const now = Date.now();
    for (const tab of store.tabs) {
      if (store.extChangeTabId === tab.id) continue;
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
      const managedNote = isNotesPath(tab.path, store.notesRoot);
      if (!managedNote && !editorSettings.auto_save) continue;

      const dirtySince = dirtySinceByTab.get(tab.id) ?? now;
      if (now - dirtySince >= (managedNote ? 500 : editorSettings.auto_save_delay_ms)) {
        dirtySinceByTab.set(tab.id, now);
        actions.saveTab(tab.id, { silent: true, requirePath: true }).catch(error => {
          if (managedNote) setStore("notesStorageWarning", `A note could not be saved. Your edits remain open: ${String(error)}`);
        });
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

  const handleEntryChanged = (event: Event) => {
    const { oldPath, newPath } = (event as CustomEvent<{ oldPath: string; newPath: string | null }>).detail;
    for (const tab of [...store.tabs]) {
      if (tab.type !== "file") continue;
      const next = movedFilePath(tab.path, oldPath, newPath);
      if (next === undefined) continue;
      unwatchFile(tab.path).catch(() => {});
      if (next === null) {
        engines.get(tab.id)?.markDirty();
        setStore("tabs", t => t.id === tab.id, { path: "", dirty: true });
        showInfo(`${tab.name} was deleted from disk. Its open draft is retained for Save As.`);
      } else {
        setStore("tabs", t => t.id === tab.id, { path: next, name: next.split("/").pop()! });
        watchFile(next).catch(() => showError("File watcher failed after moving the note"));
      }
    }
  };
  window.addEventListener("buster-entry-changed", handleEntryChanged);
  onCleanup(() => window.removeEventListener("buster-entry-changed", handleEntryChanged));

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
    let notesFirstRun = false;
    try {
      const notes = await initializeNotesWorkspace();
      notesFirstRun = notes.first_run;
      setStore("notesRoot", notes.root);
      setStore("notesDesktopLink", notes.desktop_link);
      setStore("notesStorageWarning", notes.warning);
    } catch (error) {
      setStore("notesStorageWarning", `The Notes folder could not be opened: ${String(error)}`);
    }
    try {
      const session = await loadSessionFromDisk();
      if (session) {
        await setWorkspaceRootIpc(session.workspace_root);
        const restored = await prepareSessionRestore(session, {
          readFile: async path => (await actions.loadFileContent(path)).content,
          readBackup: loadBackupBuffer,
        });
        setStore("workspaceRoot", session.workspace_root);
        setStore("sidebarVisible", session.tabs.some(tab => tab.type === "explorer") ? true : session.sidebar_visible ?? true);
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
      if (store.notesRoot && (!store.workspaceRoot || notesFirstRun)) {
        await setWorkspaceRootIpc(store.notesRoot);
        setStore("workspaceRoot", store.notesRoot);
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

  const ctx: BusterContextValue = { store, setStore, engines, actions, commands, writing, speech, appearance, formatting, search };

  return (
    <BusterContext.Provider value={ctx}>
      <Show when={initialized()} fallback={<div role="status">Restoring your workspace…</div>}>
        {props.children}
      </Show>
    </BusterContext.Provider>
  );
};

export default BusterProvider;
