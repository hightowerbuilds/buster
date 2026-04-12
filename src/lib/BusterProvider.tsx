/**
 * BusterProvider — central state provider for the Buster IDE.
 * Owns the createStore, engine Map, all actions, effects, and listeners.
 * Extracted from App.tsx to centralize state management.
 */

import { type Component, type JSX, createEffect, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { BusterContext, type BusterContextValue, type BusterActions, type EngineMap } from "./buster-context";
import type { BusterStoreState } from "./store-types";
import { basename, extname } from "buster-path";
import { type Tab, isImageFile } from "./tab-types";
import type { EditorEngine } from "../editor/engine";
import type { DirtyCloseResult } from "../ui/DirtyCloseDialog";
import type { ExternalChangeResult } from "../ui/ExternalChangeDialog";
import type { SessionSnapshot } from "./session";
import { showToast } from "../ui/CanvasToasts";

import {
  readFile, writeFile, watchFile, unwatchFile, addRecentFolder,
  gitBranch as fetchGitBranch, gitIsRepo, gitDiffHunks,
  lspStart, lspDidSave, lspStatus, lspStop, terminalKill,
  setWorkspaceRootIpc, largeFileOpen, largeFileReadLines,
  largeFileClose, loadSettings as loadSettingsIpc, saveSettings as saveSettingsIpc,
  setTerminalTheme as setTerminalThemeIpc, extUnload,
} from "./ipc";
import { CATPPUCCIN, LIGHT_THEME, generatePalette, importVSCodeTheme, applyPaletteToCss, clearCssOverrides, paletteToTerminalColors, type ThemePalette } from "./theme";
import type { AppSettings } from "./ipc";
import { persistSession, loadSessionFromDisk, closeApp } from "./session";
import { setupFileWatcher } from "./file-watcher";
import { setupSurfaceMeasureListener } from "./surface-measure";
import type { SurfaceEvent } from "./ipc";
import { setupMenuHandlers } from "./menu-handlers";
import { autoDemotePanelCount, parsePanelCount, type PanelCount } from "./panel-count";
import { setRefreshDir } from "../ui/SidebarTree";
import { listen } from "@tauri-apps/api/event";

// ── Default settings ─────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  word_wrap: true,
  font_size: 14,
  tab_size: 4,
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
};

const RECENT_FILES_KEY = "buster-recent-files";
const MAX_RECENT_FILES = 20;

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
  tourActive: false,
  branchPickerVisible: false,
  syncing: false,

  panelCount: 1 as PanelCount,
  sidebarWidth: 220,
  sidebarVisible: true,

  gitBranchName: null,
  diffHunksMap: {},

  dirtyCloseTabId: null,
  dirtyCloseFileName: "",
  extChangeTabId: null,
  extChangeFileName: "",

  searchMatches: [],
  diagnosticsMap: {},

  settings: DEFAULT_SETTINGS,
  palette: CATPPUCCIN,
  workspaceRoot: null,
  activeFilePath: null,

  recentFiles: JSON.parse(localStorage.getItem(RECENT_FILES_KEY) || "[]"),
  tabTrapping: true,
  lspState: "inactive",
  lspLanguages: [],
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

  // Transient dialog state
  let extChangeDiskContent = "";

  // Unlisten handles
  const menuListeners: Array<() => void> = [];
  onCleanup(() => menuListeners.forEach(u => u()));

  // ── Theme helper ─────────────────────────────────────────

  function rebuildPalette(s: AppSettings) {
    const fx = {
      bgGlow: 0,
      cursorGlow: s.effect_cursor_glow ?? 0,
      vignette: s.effect_vignette ?? 0,
      grain: s.effect_grain ?? 0,
    };
    const mode = s.theme_mode || "dark";
    let p: ThemePalette;

    if (mode === "imported") {
      try {
        const raw = localStorage.getItem("buster-imported-theme");
        if (raw) {
          p = importVSCodeTheme(JSON.parse(raw), fx);
          setStore("palette", p);
          applyPaletteToCss(p);
        } else {
          p = { ...CATPPUCCIN, ...fx };
          setStore("palette", p);
          clearCssOverrides();
        }
      } catch {
        p = { ...CATPPUCCIN, ...fx };
        setStore("palette", p);
        clearCssOverrides();
      }
    } else if (mode === "custom" && s.theme_hue >= 0) {
      p = generatePalette(s.theme_hue, fx);
      setStore("palette", p);
      applyPaletteToCss(p);
    } else if (mode === "light") {
      p = { ...LIGHT_THEME, ...fx };
      setStore("palette", p);
      applyPaletteToCss(p);
    } else {
      p = { ...CATPPUCCIN, ...fx };
      setStore("palette", p);
      clearCssOverrides();
    }

    // Sync terminal ANSI colors with the app palette
    setTerminalThemeIpc(paletteToTerminalColors(p!)).catch((e) =>
      console.warn("Failed to sync terminal theme:", e),
    );
  }

  // ── Actions ──────────────────────────────────────────────

  function updateSettings(newSettings: AppSettings) {
    setStore("settings", newSettings);
    saveSettingsIpc(newSettings).catch(() => showToast("Failed to save settings", "error"));
    document.documentElement.style.fontSize = `${newSettings.ui_zoom}%`;
    rebuildPalette(newSettings);
  }

  async function initSettings() {
    try {
      const s = await loadSettingsIpc();
      setStore("settings", s);
      document.documentElement.style.fontSize = `${s.ui_zoom}%`;
      rebuildPalette(s);
    } catch (e) { console.warn("Failed to load settings:", e); }
  }

  function addRecentFile(path: string, name: string) {
    const filtered = store.recentFiles.filter(f => f.path !== path);
    const next = [{ path, name }, ...filtered].slice(0, MAX_RECENT_FILES);
    setStore("recentFiles", next);
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next));
  }

  // ── Git ──────────────────────────────────────────────────

  async function refreshGitBranch(root: string) {
    try {
      const isRepo = await gitIsRepo(root);
      if (isRepo) { setStore("gitBranchName", await fetchGitBranch(root)); }
      else { setStore("gitBranchName", null); }
    } catch { setStore("gitBranchName", null); }
  }

  async function fetchDiffHunks(tabId: string, filePath: string) {
    const root = store.workspaceRoot;
    if (!root) return;
    try {
      const relPath = filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath;
      const hunks = await gitDiffHunks(root, relPath);
      setStore("diffHunksMap", tabId, hunks);
    } catch {
      setStore("diffHunksMap", tabId, []);
    }
  }

  // ── Workspace ────────────────────────────────────────────

  function rememberWorkspace(path: string) {
    addRecentFolder(path)
      .then(s => updateSettings(s))
      .catch(e => console.warn("Failed to save recent folder:", e));
  }

  function openWorkspace(path: string) {
    setStore("sidebarVisible", true);
    setStore("sidebarWidth", (width) => Math.max(width, 275));
    setStore("workspaceRoot", path);
    rememberWorkspace(path);
    refreshGitBranch(path);
  }

  async function changeDirectory() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true });
    if (selected) openWorkspace(selected as string);
  }

  function closeDirectory() {
    setStore("workspaceRoot", null);
    setStore("gitBranchName", null);
    const fileTabs = store.tabs.filter(t => t.type === "file");
    for (const t of fileTabs) {
      setStore("fileTexts", produce(ft => { delete ft[t.id]; }));
      engines.delete(t.id);
      unwatchFile(t.path).catch(() => {});
    }
    const remaining = store.tabs.filter(t => t.type !== "file");
    setStore("tabs", remaining);
    if (remaining.length === 0) setStore("activeTabId", null);
  }

  // ── File loading ─────────────────────────────────────────

  async function loadFileContent(path: string): Promise<{ content: string; fileName: string; filePath: string }> {
    // Try the fast path first (works for most files).
    // Only fall back to chunked loading if readFile fails (e.g. file too large to serialize).
    try {
      const file = await readFile(path);
      return { content: file.content, fileName: file.file_name, filePath: file.path };
    } catch {
      // Large file fallback — chunked loading via Rust buffer manager
      const lineCount = await largeFileOpen(path);
      const chunks: string[] = [];
      const chunkSize = 5000;
      for (let start = 0; start < lineCount; start += chunkSize) {
        const lines = await largeFileReadLines(path, start, chunkSize);
        chunks.push(...lines);
      }
      const content = chunks.join("\n");
      const fileName = basename(path);
      largeFileClose(path).catch(() => {});
      return { content, fileName, filePath: path };
    }
  }

  // ── File tabs ────────────────────────────────────────────

  async function handleFileSelect(path: string) {
    const existing = store.tabs.find(t => t.path === path && (t.type === "file" || t.type === "image"));
    if (existing) { switchToTab(existing.id); return; }

    // Image files get their own lightweight tab — no text loading needed
    if (isImageFile(path)) {
      setStore("fileTabCounter", c => c + 1);
      const tabId = `file_${store.fileTabCounter}`;
      const fileName = basename(path);
      const newTab: Tab = { id: tabId, name: fileName, path, dirty: false, type: "image" };
      setStore("tabs", [...store.tabs, newTab]);
      switchToTab(tabId);
      addRecentFile(path, fileName);
      return;
    }

    try {
      const { content, fileName, filePath } = await loadFileContent(path);
      setStore("fileTabCounter", c => c + 1);
      const tabId = `file_${store.fileTabCounter}`;
      const newTab: Tab = { id: tabId, name: fileName, path: filePath, dirty: false, type: "file" };

      setStore("fileTexts", tabId, content);
      setStore("tabs", [...store.tabs, newTab]);
      switchToTab(tabId);
      addRecentFile(filePath, fileName);

      watchFile(filePath).catch(() => showToast("File watcher failed — external changes may be missed", "error"));
      fetchDiffHunks(tabId, filePath);

      if (store.workspaceRoot) {
        setStore("lspState", "starting");
        lspStart(filePath, store.workspaceRoot)
          .then(() => {
            setStore("lspState", "active");
            lspStatus().then(langs => setStore("lspLanguages", langs)).catch(() => {});
          })
          .catch(() => { showToast("Language server failed to start", "error"); setStore("lspState", "error"); });
      }
    } catch {
      showToast("Failed to open file", "error");
    }
  }

  // ── Tab creation ─────────────────────────────────────────

  function createTerminalTab() {
    setStore("terminalCounter", c => c + 1);
    const tabId = `term_tab_${store.terminalCounter}`;
    const newTab: Tab = { id: tabId, name: `Terminal ${store.terminalCounter}`, path: "", dirty: false, type: "terminal" };
    setStore("tabs", [...store.tabs, newTab]);
    switchToTab(tabId);
  }

  function openSingletonTab(type: Exclude<Tab["type"], "file" | "terminal">, id: string, name: string) {
    const existing = store.tabs.find(t => t.type === type);
    if (existing) { switchToTab(existing.id); return; }
    const newTab: Tab = { id, name, path: "", dirty: false, type };
    setStore("tabs", [...store.tabs, newTab]);
    switchToTab(id);
  }

  function createGitTab() { openSingletonTab("git", "git_tab", "Git"); }
  function createSettingsTab() { openSingletonTab("settings", "settings_tab", "Settings"); }
  function createExtensionsTab() { openSingletonTab("extensions", "extensions_tab", "Extensions"); }
  function createManualTab() { openSingletonTab("manual", "manual_tab", "Manual"); }
  function createDebugTab() { openSingletonTab("debug", "debug_tab", "Debug"); }
  function createProblemsTab() { openSingletonTab("problems", "problems_tab", "Problems"); }
  function popOutSidebar() {
    setStore("sidebarVisible", false);
    openSingletonTab("explorer", "explorer_tab", "Explorer");
  }

  function handleTermIdReady(tabId: string, ptyId: string) {
    setStore("termPtyIds", tabId, ptyId);
  }

  // ── Tab management ───────────────────────────────────────

  function switchToTab(tabId: string) {
    const tab = store.tabs.find(t => t.id === tabId);
    setStore("activeTabId", tabId);
    if (tab?.type === "file") {
      const engine = engines.get(tabId);
      const cursor = engine?.cursor();
      setStore("cursorLine", cursor?.line ?? 0);
      setStore("cursorCol", cursor?.col ?? 0);
    } else {
      setStore("cursorLine", 0);
      setStore("cursorCol", 0);
    }
  }

  const EXT_TO_LANG: Record<string, string> = {
    rs: "rust", ts: "typescript", tsx: "typescriptreact",
    js: "javascript", jsx: "javascriptreact", py: "python", go: "go",
  };

  function getExtFromPath(path: string): string | null {
    const ext = extname(path);
    return ext ? ext.slice(1).toLowerCase() : null;
  }

  function handleTabClose(tabId: string) {
    const tab = store.tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (tab.type === "file" && tab.dirty) {
      setStore("dirtyCloseTabId", tabId);
      setStore("dirtyCloseFileName", tab.name);
      return;
    }
    doTabClose(tabId);
  }

  function handleExternalChangeResult(result: ExternalChangeResult) {
    const tabId = store.extChangeTabId;
    setStore("extChangeTabId", null);
    if (!tabId) return;
    if (result === "load-disk") {
      const engine = engines.get(tabId);
      if (engine) {
        engine.loadText(extChangeDiskContent);
        setStore("tabs", store.tabs.map(t => t.id === tabId ? { ...t, dirty: false } : t));
        showToast("Loaded from disk", "info");
      }
    }
  }

  async function handleDirtyCloseResult(result: DirtyCloseResult) {
    const tabId = store.dirtyCloseTabId;
    setStore("dirtyCloseTabId", null);
    if (!tabId) return;
    if (result === "cancel") return;
    if (result === "save") {
      const tab = store.tabs.find(t => t.id === tabId);
      const engine = engines.get(tabId);
      if (tab && engine) {
        await writeFile(tab.path, engine.getText());
        engine.markClean();
        setStore("tabs", store.tabs.map(t => t.id === tabId ? { ...t, dirty: false } : t));
      }
    }
    doTabClose(tabId);
  }

  function doTabClose(tabId: string) {
    const tab = store.tabs.find(t => t.id === tabId);
    if (!tab) return;

    if (tab.type === "explorer") setStore("sidebarVisible", true);

    // Surface tabs: unload the extension so it can clean up webviews, surfaces, etc.
    if (tab.type === "surface") {
      try {
        const meta = JSON.parse(tab.path || "{}");
        if (meta.extension_id) {
          extUnload(meta.extension_id).catch(() => {});
        }
      } catch {}
    }

    if (tab.type === "file") {
      setStore("fileTexts", produce(ft => { delete ft[tabId]; }));
      const engine = engines.get(tabId);
      if (engine) engine.dispose();
      engines.delete(tabId);
      unwatchFile(tab.path).catch(() => {});
      setStore("diffHunksMap", produce(dm => { delete dm[tabId]; }));

      const ext = getExtFromPath(tab.path);
      const lang = ext ? EXT_TO_LANG[ext] : null;
      if (lang) {
        const remaining = store.tabs.filter(t => t.id !== tabId && t.type === "file" && getExtFromPath(t.path) === ext);
        if (remaining.length === 0) {
          lspStop(lang).catch(e => console.warn("LSP stop failed:", e));
          lspStatus().then(langs => setStore("lspLanguages", langs)).catch(() => {});
          if (store.lspLanguages.length <= 1) setStore("lspState", "inactive");
        }
      }
    }

    const ptyId = store.termPtyIds[tabId];
    if (ptyId) terminalKill(ptyId).catch(e => console.warn("Terminal kill failed:", e));
    setStore("termPtyIds", produce(tp => { delete tp[tabId]; }));

    const newTabs = store.tabs.filter(t => t.id !== tabId);
    setStore("tabs", newTabs);
    setStore("panelCount", autoDemotePanelCount(store.panelCount, newTabs.length));

    if (store.activeTabId === tabId) {
      if (newTabs.length > 0) switchToTab(newTabs[newTabs.length - 1].id);
      else setStore("activeTabId", null);
    }
  }

  // ── Save / Sync ──────────────────────────────────────────

  async function handleSave() {
    const tab = activeTab();
    if (!tab || tab.type !== "file") return;
    const engine = engines.get(tab.id);
    if (!engine) return;
    try {
      // Trim trailing whitespace from each line before saving
      const lines = engine.lines();
      const trimmed = lines.map(l => l.trimEnd());
      const needsTrim = lines.some((l, i) => l !== trimmed[i]);
      if (needsTrim) {
        const cursor = engine.cursor();
        engine.loadText(trimmed.join("\n"));
        engine.setCursor({ line: cursor.line, col: Math.min(cursor.col, trimmed[cursor.line]?.length ?? 0) });
      }
      const text = engine.getText();
      await writeFile(tab.path, text);
      engine.markClean();
      lspDidSave(tab.path).catch(e => console.warn("LSP didSave failed:", e));
      setStore("tabs", store.tabs.map(t => t.id === tab.id ? { ...t, dirty: false } : t));
      fetchDiffHunks(tab.id, tab.path);
      showToast("Saved", "success");
    } catch { showToast("Failed to save", "error"); }
  }

  async function handleSync() {
    if (store.syncing) return;
    setStore("syncing", true);
    try {
      const root = store.workspaceRoot;
      if (root) await refreshGitBranch(root);
      if (root) setRefreshDir(root);

      for (const tab of store.tabs) {
        if (tab.type !== "file" || !tab.path) continue;
        const engine = engines.get(tab.id);
        if (!engine || engine.dirty()) continue;
        try {
          const { content } = await loadFileContent(tab.path);
          if (content !== engine.getText()) engine.loadText(content);
        } catch {}
        fetchDiffHunks(tab.id, tab.path);
      }
      showToast("Synced", "success");
    } catch { showToast("Sync failed", "error"); }
    finally { setStore("syncing", false); }
  }

  // ── Derived accessors ────────────────────────────────────

  function activeTab(): Tab | undefined {
    return store.tabs.find(t => t.id === store.activeTabId);
  }

  function activeEngine(): EditorEngine | null {
    const tab = activeTab();
    return tab?.type === "file" ? (engines.get(tab.id) ?? null) : null;
  }

  function getFileTextForTab(tabId: string): string | null {
    return store.fileTexts[tabId] ?? null;
  }

  // ── Diagnostics ──────────────────────────────────────────

  function diagnosticCounts() {
    let errors = 0, warnings = 0;
    for (const key of Object.keys(store.diagnosticsMap)) {
      const diags = store.diagnosticsMap[key];
      if (!diags) continue;
      for (const d of diags) {
        if (d.severity === 1) errors++;
        else if (d.severity === 2) warnings++;
      }
    }
    return { errors, warnings };
  }

  function allDiagnosticsSorted() {
    const all: { file: string; line: number; col: number; severity: number; message: string }[] = [];
    for (const [file, diags] of Object.entries(store.diagnosticsMap)) {
      for (const d of diags) {
        all.push({ file, line: d.line, col: d.col, severity: d.severity, message: d.message });
      }
    }
    all.sort((a, b) => a.file !== b.file ? a.file.localeCompare(b.file) : a.line !== b.line ? a.line - b.line : a.col - b.col);
    return all;
  }

  async function jumpToDiagnostic(direction: 1 | -1) {
    const all = allDiagnosticsSorted();
    if (all.length === 0) return;
    const fp = store.activeFilePath;
    const curLine = activeEngine()?.cursor().line ?? 0;
    const curCol = activeEngine()?.cursor().col ?? 0;

    let idx = -1;
    if (direction === 1) {
      idx = all.findIndex(d => d.file === fp
        ? (d.line > curLine || (d.line === curLine && d.col > curCol))
        : d.file > (fp ?? ""));
    } else {
      for (let i = all.length - 1; i >= 0; i--) {
        const d = all[i];
        if (d.file === fp
          ? (d.line < curLine || (d.line === curLine && d.col < curCol))
          : d.file < (fp ?? "")) { idx = i; break; }
      }
    }
    if (idx === -1) idx = direction === 1 ? 0 : all.length - 1;

    const target = all[idx];
    if (target.file !== fp) await handleFileSelect(target.file);
    const eng = activeEngine() ?? (() => {
      const tab = store.tabs.find(t => t.path === target.file);
      return tab ? engines.get(tab.id) : undefined;
    })();
    eng?.setCursor({ line: target.line, col: target.col });
  }

  // ── Session persistence ──────────────────────────────────

  function buildSnapshot(): SessionSnapshot {
    return {
      workspaceRoot: store.workspaceRoot,
      activeTabId: store.activeTabId,
      panelCount: store.panelCount,
      sidebarVisible: store.sidebarVisible,
      sidebarWidth: store.sidebarWidth,
      tabs: [...store.tabs],
      engines: engines.map,
      scrollPositions: new Map(Object.entries(store.scrollPositions)),
    };
  }

  async function saveSessionNow() {
    try { await persistSession(buildSnapshot()); }
    catch (e) { console.warn("Session save failed:", e); }
  }

  // Auto-save every 30 seconds
  const autoSaveInterval = setInterval(saveSessionNow, 30_000);
  onCleanup(() => clearInterval(autoSaveInterval));

  const handleVisibility = () => { if (document.hidden) saveSessionNow(); };
  document.addEventListener("visibilitychange", handleVisibility);
  onCleanup(() => document.removeEventListener("visibilitychange", handleVisibility));

  // Hot-exit — Cmd+W triggers this via Tauri's CloseRequested intercept.
  // If tabs are open, close the active tab instead of quitting.
  // If no tabs are open, save session and close the window.
  listen("window-close-requested", async () => {
    const tabId = store.activeTabId;
    if (tabId && store.tabs.length > 0) {
      handleTabClose(tabId);
    } else {
      await saveSessionNow();
      await closeApp();
    }
  }).then(u => menuListeners.push(u));

  // ── Effects ──────────────────────────────────────────────

  // Sync workspace root to Rust backend
  createEffect(() => {
    setWorkspaceRootIpc(store.workspaceRoot ?? null).catch(() => {});
  });

  // Keep activeFilePath in sync with active tab
  createEffect(() => {
    const tab = activeTab();
    setStore("activeFilePath", tab?.type === "file" ? tab.path : null);
  });

  // ── Initialization ───────────────────────────────────────

  // Crash detection: set running flag and check if last shutdown was dirty
  import("./ipc").then(({ setRunningFlag }) => {
    setRunningFlag().then(wasDirty => {
      if (wasDirty) {
        showToast("Recovered unsaved changes from last session", "info");
      }
    }).catch(() => {});
  });

  initSettings();

  // File watcher
  setupFileWatcher({
    getTabs: () => store.tabs,
    getEngine: (tabId) => engines.get(tabId),
    showConflictDialog: (tabId, fileName, diskContent) => {
      extChangeDiskContent = diskContent;
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

  // Surface events from extensions
  listen<SurfaceEvent>("surface-event", (event) => {
    const { surface_id, kind, extension_id, content } = event.payload;
    if (kind === "created") {
      const meta = JSON.parse(content);
      const tabId = `surface_${surface_id}`;
      const newTab: Tab = {
        id: tabId,
        name: meta.label || `Surface ${surface_id}`,
        path: JSON.stringify({ surface_id, extension_id, width: meta.width, height: meta.height }),
        dirty: false,
        type: "surface",
      };
      setStore("tabs", [...store.tabs, newTab]);
      switchToTab(tabId);
    } else if (kind === "released") {
      const tabId = `surface_${surface_id}`;
      const idx = store.tabs.findIndex((t) => t.id === tabId);
      if (idx >= 0) {
        setStore("tabs", store.tabs.filter((t) => t.id !== tabId));
        if (store.activeTabId === tabId) {
          setStore("activeTabId", store.tabs.length > 0 ? store.tabs[0].id : null);
        }
      }
    }
  }).then((u) => menuListeners.push(u));

  // Text measurement listener for extension surfaces
  setupSurfaceMeasureListener().then((u) => menuListeners.push(u));

  // Menu handlers
  setupMenuHandlers({
    activeEngine,
    changeDirectory,
    closeDirectory,
    openExtensions: createExtensionsTab,
    openDebug: createDebugTab,
    openSettings: createSettingsTab,
    openDocs: createManualTab,
  })
    .then(handles => menuListeners.push(...handles));

  // Session restore — restore layout preferences only, not workspace or files.
  // Users must explicitly open a folder to start each session.
  (async () => {
    try {
      const session = await loadSessionFromDisk();
      if (!session) return;
      // Do NOT restore workspace_root — users must open a folder explicitly
      setStore("panelCount", parsePanelCount(session.layout_mode));
      setStore("sidebarVisible", session.sidebar_visible ?? true);
      const sw = session.sidebar_width;
      setStore("sidebarWidth", sw && sw >= 140 && sw <= 600 ? sw : 220);

      // Only restore non-workspace tabs (terminals, AI, settings, manual, etc.)
      // File and image tabs are skipped since no workspace is open on startup.
      for (const stab of session.tabs) {
        if (stab.type === "file" || stab.type === "image") {
          // Skip — requires a workspace to be open
          continue;
        } else if (stab.type === "terminal") {
          setStore("terminalCounter", c => c + 1);
          const tabId = `term_tab_${store.terminalCounter}`;
          setStore("tabs", produce(tabs => {
            tabs.push({ id: tabId, name: stab.name || "Terminal", path: "", dirty: false, type: "terminal" });
          }));
        } else if (["settings", "git", "extensions", "manual", "debug", "explorer"].includes(stab.type)) {
          setStore("tabs", produce(tabs => {
            tabs.push({ id: stab.id, name: stab.name, path: "", dirty: false, type: stab.type as Tab["type"] });
          }));
        }
      }

      // Sync counters past restored tab IDs
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

  // ── Build context value ──────────────────────────────────

  const actions: BusterActions = {
    handleFileSelect,
    handleSave,
    handleSync,
    loadFileContent,
    switchToTab,
    handleTabClose,
    createTerminalTab,
    createGitTab,
    createSettingsTab,
    createExtensionsTab,
    createManualTab,
    createDebugTab,
    createProblemsTab,
    popOutSidebar,
    handleTermIdReady,
    openWorkspace,
    changeDirectory,
    closeDirectory,
    refreshGitBranch,
    handleDirtyCloseResult,
    handleExternalChangeResult,
    activeTab,
    activeEngine,
    getFileTextForTab,
    updateSettings,
    addRecentFile,
    jumpToDiagnostic,
    diagnosticCounts,
    fetchDiffHunks,
    buildSnapshot,
    saveSessionNow,
  };

  const ctx: BusterContextValue = { store, setStore, engines, actions };

  return (
    <BusterContext.Provider value={ctx}>
      {props.children}
    </BusterContext.Provider>
  );
};

export default BusterProvider;
