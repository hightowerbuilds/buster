import { batch } from "solid-js";
import { focusNewNote, focusTabPanel } from "./focus-service";
import { produce } from "solid-js/store";
import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import type { EngineMap } from "./buster-context";
import type { Tab } from "./tab-types";
import type { DirtyCloseResult } from "../ui/DirtyCloseDialog";
import type { ExternalChangeResult } from "../ui/ExternalChangeDialog";
import { basename, extname } from "buster-path";
import { unwatchFile, lspStop, lspStatus, extUnload, browserModuleClose } from "./ipc";
import { showInfo, showError } from "./notify";
import { createFile, watchFile } from "./ipc";
import { setRefreshDir } from "../ui/SidebarTree";
import { isNotesPath } from "./notes-storage";
import { elementNoteNames } from "./element-note-names";
import { clampSplitRatio, splitSide } from "./split-view";
import type { SplitSide } from "./split-view";

const EXT_TO_LANG: Record<string, string> = {
  rs: "rust", ts: "typescript", tsx: "typescriptreact",
  js: "javascript", jsx: "javascriptreact", py: "python", go: "go",
};

function getExtFromPath(path: string): string | null {
  const ext = extname(path);
  return ext ? ext.slice(1).toLowerCase() : null;
}

export function createTabActions(
  store: BusterStoreState,
  setStore: SetStoreFunction<BusterStoreState>,
  engines: EngineMap,
  extChangeDiskContent: { value: string; resolve?: (result: ExternalChangeResult) => void },
  writeFileSmart: (path: string, content: string, mustExist?: boolean) => Promise<void>,
  pendingNotes: Map<string, Promise<void>> = new Map(),
  queueSave: (tabId: string, save: () => Promise<void>) => Promise<void> = (_tabId, save) => save(),
  canSave: (tabId: string) => boolean = () => true,
) {
  function switchToTab(tabId: string, options: { focus?: boolean; pane?: SplitSide } = {}) {
    const tab = store.tabs.find(t => t.id === tabId);
    if (!tab) return;
    batch(() => {
      const view = store.splitView;
      if (view && !splitSide(view, tabId)) {
        const side = options.pane ?? splitSide(view, store.activeTabId) ?? "left";
        setStore("splitView", side === "left" ? "leftTabId" : "rightTabId", tabId);
      }
      setStore("activeTabId", tabId);
    });
    if (options.focus !== false) focusTabPanel(tabId);
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

  function openTabAlongside(tabId?: string) {
    const current = store.activeTabId;
    if (!current || !store.tabs.some(tab => tab.id === current)) return;
    const index = store.tabs.findIndex(tab => tab.id === current);
    const target = tabId && tabId !== current
      ? store.tabs.find(tab => tab.id === tabId)
      : store.tabs[index + 1] ?? store.tabs.find(tab => tab.id !== current);
    if (!target || target.id === current) return;
    batch(() => {
      const view = store.splitView;
      if (!view) setStore("splitView", { leftTabId: current, rightTabId: target.id, ratio: 0.5 });
      else if (!splitSide(view, target.id)) {
        const otherSide = splitSide(view, current) === "left" ? "rightTabId" : "leftTabId";
        setStore("splitView", otherSide, target.id);
      }
      switchToTab(target.id);
    });
  }

  function closeSplitView(keepTabId = store.activeTabId) {
    if (!store.splitView) return;
    const keep = keepTabId && splitSide(store.splitView, keepTabId) ? keepTabId : store.splitView.leftTabId;
    batch(() => { setStore("splitView", null); switchToTab(keep); });
  }

  function setSplitRatio(ratio: number) {
    if (store.splitView) setStore("splitView", "ratio", clampSplitRatio(ratio));
  }

  function reorderTabs(fromIndex: number, toIndex: number) {
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
      || fromIndex < 0 || toIndex < 0 || fromIndex >= store.tabs.length || toIndex >= store.tabs.length
      || fromIndex === toIndex) return;
    const reordered = [...store.tabs];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setStore("tabs", reordered);
  }

  function createNewFile() {
    setStore("fileTabCounter", c => c + 1);
    const tabId = `file_${store.fileTabCounter}`;
    const root = store.notesRoot;
    const candidates = elementNoteNames(store.tabs.filter(tab => tab.type === "file").map(tab => tab.name));
    const name = candidates.next().value!;
    const newTab: Tab = { id: tabId, name, path: "", dirty: false, type: "file" };
    setStore("fileTexts", tabId, "");
    setStore("tabs", [...store.tabs, newTab]);
    switchToTab(tabId);
    if (root) {
      const pending = (async () => {
        let candidate = name;
        let path: string;
        for (;;) {
          path = `${root}/${candidate}`;
          try {
            await createFile(path);
            break;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message !== "File already exists") throw error;
            do { candidate = candidates.next().value!; }
            while (store.tabs.some(tab => tab.id !== tabId && tab.name.toLowerCase() === candidate.toLowerCase()));
          }
        }
        setStore("tabs", tab => tab.id === tabId && !tab.path && tab.name === name, "name", candidate);
        setStore("tabs", tab => tab.id === tabId && !tab.path, "path", path);
        setRefreshDir(root);
        if (store.tabs.some(tab => tab.id === tabId)) watchFile(path).catch(() => showError("File watcher failed for the new note"));
      })();
      pendingNotes.set(tabId, pending);
      pending.catch(error => {
        setStore("notesStorageWarning", `Could not create ${name}: ${String(error)}. Your draft remains open; use Save As to save it elsewhere.`);
      }).finally(() => pendingNotes.delete(tabId));
    } else {
      showError("The Notes folder is unavailable. This draft is unsaved; use Save As to keep it.");
    }
    return tabId;
  }

  function openSingletonTab(type: Exclude<Tab["type"], "file">, id: string, name: string) {
    const existing = store.tabs.find(t => t.type === type);
    if (existing) { switchToTab(existing.id); return; }
    const newTab: Tab = { id, name, path: "", dirty: false, type };
    setStore("tabs", [...store.tabs, newTab]);
    switchToTab(id);
  }

  function createGitTab() { openSingletonTab("git", "git_tab", "Git"); }
  function createSettingsTab() { openSingletonTab("settings", "settings_tab", "Settings"); }
  function createKeybindingsTab() { openSingletonTab("keybindings", "keybindings_tab", "Keyboard Shortcuts"); }
  function createExtensionsTab() { openSingletonTab("extensions", "extensions_tab", "Extensions"); }
  function createProblemsTab() { openSingletonTab("problems", "problems_tab", "Problems"); }
  function createConsoleTab() { openSingletonTab("console", "console_tab", "Console"); }
  function createAiTab() { openSingletonTab("ai", "ai_tab", "AI"); }

  function createBrowserTab(url?: string) {
    const tabId = `browser_tab_${Date.now()}`;
    const newTab: Tab = { id: tabId, name: "Browser", path: url || "", dirty: false, type: "browser" };
    setStore("tabs", [...store.tabs, newTab]);
    switchToTab(tabId);
  }

  function handleTabClose(tabId: string) {
    const tab = store.tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (tab.type === "file" && (engines.get(tabId)?.dirty() ?? tab.dirty)) {
      setStore("dirtyCloseTabId", tabId);
      setStore("dirtyCloseFileName", tab.name);
      return;
    }
    doTabClose(tabId);
  }

  function handleExternalChangeResult(result: ExternalChangeResult) {
    if (extChangeDiskContent.resolve) { extChangeDiskContent.resolve(result); return; }
    const tabId = store.extChangeTabId;
    setStore("extChangeTabId", null);
    if (!tabId) return;
    if (result === "load-disk") {
      const engine = engines.get(tabId);
      if (engine) {
        engine.loadText(extChangeDiskContent.value);
        setStore("tabs", store.tabs.map(t => t.id === tabId ? { ...t, dirty: false } : t));
        showInfo("Loaded from disk");
      }
    }
  }

  async function handleDirtyCloseResult(result: DirtyCloseResult) {
    const tabId = store.dirtyCloseTabId;
    setStore("dirtyCloseTabId", null);
    if (!tabId) return;
    if (result === "cancel") return;
    if (result === "save") {
      return queueSave(tabId, async () => {
        await pendingNotes.get(tabId)?.catch(() => {});
        if (!canSave(tabId)) { showError("Resolve the external file change before saving."); return; }
        const tab = store.tabs.find(t => t.id === tabId);
        const engine = engines.get(tabId);
        if (tab) {
          const text = engine?.getText() ?? store.fileTexts[tabId];
          if (text === undefined) { showError("Draft text is unavailable; the tab remains open"); return; }
          const savedRevision = engine?.editSeq();
          const originalPath = tab.path;
          let savePath = tab.path;
          if (!savePath) {
            const { save } = await import("@tauri-apps/plugin-dialog");
            const chosen = await save({ title: "Save File", defaultPath: tab.name });
            if (!chosen) return;
            savePath = chosen;
          }
          if (!canSave(tabId)) { showError("Resolve the external file change before saving."); return; }
          try { await writeFileSmart(savePath, text, savePath === originalPath && isNotesPath(savePath, store.notesRoot)); }
          catch { showError("Failed to save; the draft remains open"); return; }
          if (store.tabs.find(t => t.id === tabId)?.path !== originalPath) return;
          if (engine ? engine.editSeq() !== savedRevision : store.fileTexts[tabId] !== text) {
            setStore("tabs", store.tabs.map(t => t.id === tabId ? { ...t, path: savePath, name: basename(savePath) } : t));
            if (savePath !== originalPath) {
              if (originalPath && !store.tabs.some(t => t.id !== tabId && t.path === originalPath)) {
                unwatchFile(originalPath).catch(() => {});
              }
              watchFile(savePath).catch(() => showError("File watcher failed for the saved note"));
            }
            showInfo("New changes remain unsaved; the draft stays open");
            return;
          }
          engine?.markClean();
          if (savePath !== originalPath && originalPath && !store.tabs.some(t => t.id !== tabId && t.path === originalPath)) {
            unwatchFile(originalPath).catch(() => {});
          }
          setStore("tabs", store.tabs.map(t => t.id === tabId ? { ...t, path: savePath, name: basename(savePath), dirty: false } : t));
        }
        doTabClose(tabId);
      });
    }
    doTabClose(tabId);
  }

  function doTabClose(tabId: string) {
    const tab = store.tabs.find(t => t.id === tabId);
    if (!tab) return;
    const closingEngine = engines.get(tabId);

    if (tab.type === "browser") browserModuleClose().catch(() => {});
    if (tab.type === "surface") {
      try {
        const meta = JSON.parse(tab.path || "{}");
        if (meta.extension_id) extUnload(meta.extension_id).catch(() => {});
      } catch { console.warn("Failed to parse surface tab metadata"); }
    }

    if (tab.type === "file") {
      setStore("fileTexts", produce(ft => { delete ft[tabId]; }));
      engines.delete(tabId);
      if (tab.path && !store.tabs.some(t => t.id !== tabId && t.path === tab.path)) unwatchFile(tab.path).catch(() => {});
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

    const index = store.tabs.findIndex(t => t.id === tabId);
    const newTabs = store.tabs.filter(t => t.id !== tabId);
    const wasActive = store.activeTabId === tabId;
    const view = store.splitView;
    const remainingPane = view && splitSide(view, tabId)
      ? (view.leftTabId === tabId ? view.rightTabId : view.leftTabId) : null;
    batch(() => {
      if (remainingPane) setStore("splitView", null);
      setStore("tabs", newTabs);
      setStore("scrollPositions", produce(positions => { delete positions[tabId]; }));
      if (wasActive) {
        const next = newTabs.find(tab => tab.id === remainingPane) ?? newTabs[index] ?? newTabs[index - 1];
        if (next) switchToTab(next.id);
        else {
          setStore("activeTabId", null);
          setStore("cursorLine", 0);
          setStore("cursorCol", 0);
        }
      }
    });
    closingEngine?.dispose();
    if (wasActive && !newTabs.length) focusNewNote();
  }

  return {
    switchToTab, openTabAlongside, closeSplitView, setSplitRatio, reorderTabs, createNewFile,
    createGitTab, createSettingsTab, createKeybindingsTab, createExtensionsTab,
    createProblemsTab, createConsoleTab, createAiTab,
    createBrowserTab,
    handleTabClose, handleExternalChangeResult, handleDirtyCloseResult,
    doTabClose,
  };
}
