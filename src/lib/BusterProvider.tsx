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

import { createAppCloseHandler, isAppCloseShortcut } from "./app-lifecycle";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { closeApp } from "./session";
import { setWorkspaceRootIpc, loadBackupBuffer, watchFile, unwatchFile } from "./ipc";
import type { AppSettings } from "./ipc";
import { loadSessionFromDisk } from "./session";
import { prepareSessionRestore } from "./session-restore";
import { isNotesPath, movedFilePath } from "./notes-storage";
import { initializeNotesWorkspace, listWorkspaceFiles, workspaceSearch, readFile, createFile, writeFile, renameEntry } from "./ipc";
import { setupFileWatcher } from "./file-watcher";
import { createExternalChanges } from "./external-changes";
import { setupSurfaceMeasureListener } from "./surface-measure";
// Surface events use a different shape than the IPC SurfaceEvent type
interface SurfaceTabEvent {
  type: string;
  data: { tab_id: string; label?: string; extension_id?: string; tab_type?: string };
}
import { setupMenuHandlers } from "./menu-handlers";
import { listen } from "@tauri-apps/api/event";
import { CATPPUCCIN } from "./theme";
import { autoSaveDelay } from "./note-save-policy";
import { createAssistantWorkspace } from "./assistant-workspace";
import { nativeChatHistory } from "./chat-history";
import { registerDocumentEditCommands } from "./document-edit";
import { registerNoteCommands } from "./note-commands";
import { createPrinting, registerPrintCommands } from "./printing";
import { printPrinters, printDocument } from "./ipc";
import { createBackgrounds, nativeBackgroundIpc } from "./backgrounds";
import { registerBackgroundCommands } from "./background-commands";
import { registerWebSearchCommands } from "./web-search";
import { createClaudeCodeTransport } from "./assistant-transport";
import { createLocalModelTransport, createRoutingTransport } from "./local-model-transport";
import { isMarkdownPath } from "../editor/writing-viewport";
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
  splitView: null,
  fileTexts: {},
  scrollPositions: {},
  fileTabCounter: 0,

  cursorLine: 0,
  cursorCol: 0,

  findVisible: false,
  paletteVisible: false,
  paletteInitialQuery: "",
  branchPickerVisible: false,
  syncing: false,
  fileLoading: false,

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
  const externalChanges = createExternalChanges({
    tab: id => store.tabs.find(tab => tab.id === id),
    engine: id => engines.get(id),
    present: conflict => batch(() => {
      setStore("extChangeTabId", conflict?.tabId ?? null);
      setStore("extChangeFileName", conflict?.name ?? "");
    }),
    loaded: id => { setStore("tabs", tab => tab.id === id, "dirty", false); showInfo("Loaded from disk; Undo restores your previous writing"); },
  });
  const extChangeDiskContent = { value: "", resolve: externalChanges.resolve };
  createEffect(() => { store.tabs.map(tab => tab.path); untrack(externalChanges.sync); });

  // Unlisten handles
  const menuListeners: Array<() => void> = [];
  onCleanup(() => menuListeners.forEach(u => u()));

  // ── Create actions via dependency injection ─────────────────

  const allActions = createBusterActions({ store, setStore, engines, extChangeDiskContent, canSave: id => !externalChanges.has(id) });
  const actions = allActions; // allActions includes internal methods too
  const commands = createWorkbenchCommands({
    tabs: () => store.tabs,
    activeTabId: () => store.activeTabId,
    workspaceRoot: () => store.workspaceRoot,
    document: (id) => {
      const engine = engines.get(id);
      return engine ? { text: engine.getText(), revision: engine.editSeq(), dirty: engine.dirty() } : null;
    },
    focusTab: (id) => { actions.switchToTab(id); focusTabPanel(id); },
    createNote: actions.createNewFile,
  });

  // ── Session persistence ─────────────────────────────────────
  registerSelectionCommands(commands, {
    hasTab: id => store.tabs.some(tab => tab.id === id && tab.type === "file"), engine: id => engines.get(id),
    readClipboard: () => navigator.clipboard.readText(), writeClipboard: clipboardWrite,
  });
  registerDocumentEditCommands(commands, {
    hasTab: id => store.tabs.some(tab => tab.id === id && tab.type === "file"), engine: id => engines.get(id),
  });
  registerNoteCommands(commands, {
    notesRoot: () => store.notesRoot,
    tabs: () => store.tabs,
    engine: id => engines.get(id),
    listFiles: listWorkspaceFiles,
    searchFiles: workspaceSearch,
    readFile,
    createFile,
    writeFile: (path, content) => writeFile(path, content, true),
    renameFile: renameEntry,
    openFile: actions.openFile,
    waitForEngine: async id => {
      for (let waited = 0; waited < 3000 && !engines.get(id); waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
      return engines.get(id);
    },
  });
  const writing = createWritingReview({
    engine: id => engines.get(id),
    hasTab: id => store.tabs.some(tab => tab.id === id),
    openPanel: (id, kind) => batch(() => {
      const tabId = `review_${id}`;
      setStore("tabs", tabs => [...tabs, { id: tabId, name: kind === "lookup" ? "Look up" : "AI review", path: id, type: "writing-review", dirty: false }]);
      actions.switchToTab(tabId);
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
  registerWritingReviewCommands(commands, writing, navigator.platform.startsWith("Mac"));
  createEffect(() => {
    store.tabs.map(tab => tab.id);
    untrack(() => writing.reconcile());
  });
  onCleanup(writing.dispose);
  const speech = createSpeech({
    engine: id => engines.get(id),
    hasTab: id => store.tabs.some(tab => tab.id === id),
    focusSource: target => { actions.switchToTab(target.tabId); focusTabPanel(target.tabId); },
    transport: nativeSpeechTransport,
  });
  registerSpeechCommands(commands, speech, navigator.platform.startsWith("Mac"));
  createEffect(() => {
    store.tabs.map(tab => tab.id);
    untrack(() => speech.reconcile());
  });
  const formatting = createWritingFormatting({
    tabs: () => store.tabs,
    engine: id => { engines.revision(); return engines.get(id); },
  });
  registerWritingFormattingCommands(commands, formatting);
  const search = createSearchPortal({
    activeTabId: () => store.activeTabId,
    notes: () => store.tabs.filter(tab => tab.type === "file").map(tab => ({ tabId: tab.id, name: tab.name })),
    engine: id => { engines.revision(); return engines.get(id); },
    hasTab: id => store.tabs.some(tab => tab.id === id),
    openPanel: id => batch(() => {
      const tabId = `search_${id}`;
      setStore("tabs", tabs => [...tabs, { id: tabId, name: "AI search", path: id, type: "search-portal", dirty: false }]);
      actions.switchToTab(tabId);
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
    reviewPassage: target => {
      actions.switchToTab(target.tabId);
      const engine = engines.get(target.tabId);
      if (!engine || !store.tabs.some(tab => tab.id === target.tabId)) throw new CommandFailure("NOT_FOUND", "The source note is no longer available.");
      engine.setSelection(target.range.anchor, target.range.head);
      return writing.start(target, "ai");
    },
  });
  registerSearchPortalCommands(commands, search);
  createEffect(() => { store.tabs.map(tab => tab.id); untrack(() => search.reconcile()); });
  const appearance = createWritingAppearance({
    tabIds: () => store.tabs.filter(tab => tab.type === "file").map(tab => tab.id),
    workspaceId: () => store.workspaceRoot,
    load: () => localStorage.getItem(WRITING_APPEARANCE_KEY),
    save: value => localStorage.setItem(WRITING_APPEARANCE_KEY, value),
  });
  registerWritingAppearanceCommands(commands, appearance);
  const backgrounds = createBackgrounds(nativeBackgroundIpc);
  void backgrounds.load();
  registerBackgroundCommands(commands, backgrounds);
  registerWebSearchCommands(commands);
  const printing = createPrinting({
    tabs: () => store.tabs,
    text: id => engines.get(id)?.getText() ?? store.fileTexts[id],
    printers: printPrinters,
    submit: printDocument,
    choosePdfPath: async title => {
      const { save } = await import("@tauri-apps/plugin-dialog");
      return save({ title: "Save Printed Note as PDF", defaultPath: `${title.replace(/\.[^.]+$/, "")}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    },
  });
  registerPrintCommands(commands, printing);
  onCleanup(printing.dispose);
  // Created after every catalog is registered; each conversation snapshots the tool list.
  const assistant = createAssistantWorkspace({
    commands,
    transport: id => createRoutingTransport(createClaudeCodeTransport(id), createLocalModelTransport()),
    history: nativeChatHistory,
    storage: { get: key => localStorage.getItem(key), set: (key, value) => localStorage.setItem(key, value) },
  });
  onCleanup(() => void assistant.dispose());
  onCleanup(speech.dispose);

  const autoSaveInterval = setInterval(actions.saveSessionNow, 30_000);
  onCleanup(() => clearInterval(autoSaveInterval));

  const dirtySinceByTab = new Map<string, number>();
  const editSeqByTab = new Map<string, number>();
  const fileAutoSaveInterval = setInterval(() => {
    const now = Date.now();
    for (const tab of store.tabs) {
      if (externalChanges.has(tab.id)) continue;
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

      const managedNote = isNotesPath(tab.path, store.notesRoot);
      const delay = autoSaveDelay(store.settings, tab.path, store.notesRoot);
      if (delay === null) continue;

      const dirtySince = dirtySinceByTab.get(tab.id) ?? now;
      if (now - dirtySince >= delay) {
        dirtySinceByTab.set(tab.id, now);
        actions.saveTab(tab.id, { silent: true, requirePath: true }).catch(error => {
          if (managedNote || isMarkdownPath(tab.path)) setStore("notesStorageWarning", `A note could not be saved. Your edits remain open: ${String(error)}`);
        });
      }
    }
  }, 500);
  onCleanup(() => clearInterval(fileAutoSaveInterval));

  const handleVisibility = () => { if (document.hidden) actions.saveSessionNow(); };
  document.addEventListener("visibilitychange", handleVisibility);
  onCleanup(() => document.removeEventListener("visibilitychange", handleVisibility));

  const requestClose = createAppCloseHandler(
    async () => { printing.prepareClose(); await assistant.prepareClose(); await actions.saveSessionNow(true); }, closeApp,
    error => showError(`Could not save your session. The app remains open: ${String(error)}`),
  );
  let closeListenerDisposed = false;
  listen("window-close-requested", requestClose).then(async unlisten => {
    if (closeListenerDisposed) { unlisten(); return; }
    menuListeners.push(unlisten);
    await invoke("set_close_handler_ready", { ready: true });
  }).catch(error => showError(`Could not register app closing: ${String(error)}`));
  const handleAppCloseKey = (event: KeyboardEvent) => {
    if (!isAppCloseShortcut(event, navigator.platform.startsWith("Mac"))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) void getCurrentWindow().close().catch(error => showError(String(error)));
  };
  window.addEventListener("keydown", handleAppCloseKey, true);
  onCleanup(() => {
    closeListenerDisposed = true;
    window.removeEventListener("keydown", handleAppCloseKey, true);
    void invoke("set_close_handler_ready", { ready: false });
  });

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
    showConflictDialog: externalChanges.receive,
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
    handlePrint: () => printing.open(store.activeTabId),
  }).then(handles => menuListeners.push(...handles));

  // ── Restore session ─────────────────────────────────────────

  (async () => {
    let restoredTabId: string | null = null;
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
        restoredTabId = restored.activeTabId;
        for (const tab of restored.tabs) {
          const file = tab.id.match(/^file_(\d+)$/);
          if (file) setStore("fileTabCounter", c => Math.max(c, Number(file[1])));
          if (tab.type === "file" && tab.path) {
            watchFile(tab.path).catch(() => {});
            if (session.workspace_root) actions.attemptLspStart(tab.path, session.workspace_root);
          }
        }
        setStore("activeTabId", restored.activeTabId);
        setStore("splitView", restored.splitView);
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
      // tab after mounting.
      if (restoredTabId) actions.switchToTab(restoredTabId);
    }
  })();

  // ── Build context value ─────────────────────────────────────

  const ctx: BusterContextValue = { store, setStore, engines, actions, commands, writing, speech, appearance, formatting, search, assistant, backgrounds, printing };

  return (
    <BusterContext.Provider value={ctx}>
      <Show when={initialized()} fallback={<div role="status">Restoring your workspace…</div>}>
        {props.children}
      </Show>
    </BusterContext.Provider>
  );
};

export default BusterProvider;
