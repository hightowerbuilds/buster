import { batch } from "solid-js";
import { showTabInPane } from "./writing-panes";
import { focusTabPanel } from "./focus-service";
import { produce } from "solid-js/store";
import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import type { EngineMap } from "./buster-context";
import type { Tab } from "./tab-types";
import type { DirtyCloseResult } from "../ui/DirtyCloseDialog";
import type { ExternalChangeResult } from "../ui/ExternalChangeDialog";
import { basename, extname } from "buster-path";
import { unwatchFile, lspStop, lspStatus, terminalKill, extUnload, browserModuleClose } from "./ipc";
import { showInfo, showError } from "./notify";
import { createFile, watchFile } from "./ipc";
import { setRefreshDir } from "../ui/SidebarTree";
import { isNotesPath } from "./notes-storage";

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
  extChangeDiskContent: { value: string },
  writeFileSmart: (path: string, content: string, mustExist?: boolean) => Promise<void>,
  pendingNotes: Map<string, Promise<void>> = new Map(),
) {
  function switchToTab(tabId: string) {
    const tab = store.tabs.find(t => t.id === tabId);
    if (!tab) return;
    batch(() => {
      setStore("paneWorkspace", showTabInPane(store.paneWorkspace, tabId));
      setStore("activeTabId", tabId);
    });
    focusTabPanel(tabId);
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

  function createNewFile() {
    setStore("fileTabCounter", c => c + 1);
    const tabId = `file_${store.fileTabCounter}`;
    const root = store.notesRoot;
    const name = root ? `Note-${store.fileTabCounter}-${crypto.randomUUID().slice(0, 8)}.md` : `Note-${store.fileTabCounter}.md`;
    const newTab: Tab = { id: tabId, name, path: "", dirty: false, type: "file" };
    setStore("fileTexts", tabId, "");
    setStore("tabs", [...store.tabs, newTab]);
    switchToTab(tabId);
    if (root) {
      const path = `${root}/${name}`;
      const pending = createFile(path).then(() => {
        setStore("tabs", tab => tab.id === tabId && !tab.path, "path", path);
        setRefreshDir(root);
        if (store.tabs.some(tab => tab.id === tabId)) watchFile(path).catch(() => showError("File watcher failed for the new note"));
      });
      pendingNotes.set(tabId, pending);
      pending.catch(error => {
        setStore("notesStorageWarning", `Could not create ${name}: ${String(error)}. Your draft remains open; use Save As to save it elsewhere.`);
      }).finally(() => pendingNotes.delete(tabId));
    } else {
      showError("The Notes folder is unavailable. This draft is unsaved; use Save As to keep it.");
    }
    return tabId;
  }

  function createTerminalTab() {
    setStore("terminalCounter", c => c + 1);
    const tabId = `term_tab_${store.terminalCounter}`;
    const cwd = store.workspaceRoot ?? "";
    const newTab: Tab = {
      id: tabId,
      name: `Terminal ${store.terminalCounter}`,
      path: cwd,
      dirty: false,
      type: "terminal",
    };
    setStore("tabs", [...store.tabs, newTab]);
    switchToTab(tabId);
    return tabId;
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

  function handleTermIdReady(tabId: string, ptyId: string) {
    setStore("termPtyIds", tabId, ptyId);
  }

  function handleTermTitleChange(tabId: string, title: string) {
    const idx = store.tabs.findIndex(t => t.id === tabId);
    if (idx >= 0) setStore("tabs", idx, "name", title);
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
      await pendingNotes.get(tabId)?.catch(() => {});
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
        try { await writeFileSmart(savePath, text, savePath === originalPath && isNotesPath(savePath, store.notesRoot)); }
        catch { showError("Failed to save; the draft remains open"); return; }
        if (store.tabs.find(t => t.id === tabId)?.path !== originalPath) return;
        if (engine && engine.editSeq() !== savedRevision) {
          setStore("tabs", store.tabs.map(t => t.id === tabId ? { ...t, path: savePath, name: basename(savePath) } : t));
          showInfo("New changes remain unsaved; the draft stays open");
          return;
        }
        engine?.markClean();
        setStore("tabs", store.tabs.map(t => t.id === tabId ? { ...t, path: savePath, name: basename(savePath), dirty: false } : t));
      }
    }
    doTabClose(tabId);
  }

  function doTabClose(tabId: string) {
    const tab = store.tabs.find(t => t.id === tabId);
    if (!tab) return;

    if (tab.type === "browser") browserModuleClose().catch(() => {});
    if (tab.type === "surface") {
      try {
        const meta = JSON.parse(tab.path || "{}");
        if (meta.extension_id) extUnload(meta.extension_id).catch(() => {});
      } catch { console.warn("Failed to parse surface tab metadata"); }
    }

    if (tab.type === "file") {
      setStore("fileTexts", produce(ft => { delete ft[tabId]; }));
      // Skip engine.dispose() — it triggers reactive updates that cause a
      // CFRelease crash on macOS when the panel's WebGL context tears down.
      // Just drop the reference; GC handles the rest.
      engines.delete(tabId);
      if (tab.path) unwatchFile(tab.path).catch(() => {});
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
    setStore("paneWorkspace", "panes", store.paneWorkspace.panes.map(p => p.tabId === tabId ? { ...p, tabId: null } : p));

    if (store.activeTabId === tabId) {
      if (newTabs.length > 0) switchToTab(newTabs[newTabs.length - 1].id);
      else setStore("activeTabId", null);
    }
  }

  return {
    switchToTab, createNewFile, createTerminalTab,
    createGitTab, createSettingsTab, createKeybindingsTab, createExtensionsTab,
    createProblemsTab, createConsoleTab, createAiTab,
    createBrowserTab,
    handleTermIdReady, handleTermTitleChange,
    handleTabClose, handleExternalChangeResult, handleDirtyCloseResult,
    doTabClose,
  };
}
