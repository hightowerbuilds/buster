import { produce } from "solid-js/store";
import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import type { EngineMap } from "./buster-context";
import type { Tab } from "./tab-types";
import type { DirtyCloseResult } from "../ui/DirtyCloseDialog";
import type { ExternalChangeResult } from "../ui/ExternalChangeDialog";
import { basename, extname } from "buster-path";
import { unwatchFile, lspStop, lspStatus, terminalKill, extUnload, browserModuleClose } from "./ipc";
import { showInfo } from "./notify";
import { autoDemotePanelCount } from "./panel-count";

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
  writeFileSmart: (path: string, content: string) => Promise<void>,
) {
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

  function createNewFile() {
    setStore("fileTabCounter", c => c + 1);
    const tabId = `file_${store.fileTabCounter}`;
    const name = `Untitled-${store.fileTabCounter}`;
    const newTab: Tab = { id: tabId, name, path: "", dirty: false, type: "file" };
    setStore("fileTexts", tabId, "");
    setStore("tabs", [...store.tabs, newTab]);
    switchToTab(tabId);
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
  function createDebugTab() { openSingletonTab("debug", "debug_tab", "Debug"); }
  function createProblemsTab() { openSingletonTab("problems", "problems_tab", "Problems"); }
  function createConsoleTab() { openSingletonTab("console", "console_tab", "Console"); }
  function createAiTab() { openSingletonTab("ai", "ai_tab", "AI"); }

  function createBrowserTab(url?: string) {
    const tabId = `browser_tab_${Date.now()}`;
    const newTab: Tab = { id: tabId, name: "Browser", path: url || "", dirty: false, type: "browser" };
    setStore("tabs", [...store.tabs, newTab]);
    switchToTab(tabId);
  }

  function popOutSidebar() {
    setStore("sidebarVisible", false);
    openSingletonTab("explorer", "explorer_tab", "Explorer");
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
      const tab = store.tabs.find(t => t.id === tabId);
      const engine = engines.get(tabId);
      if (tab && engine) {
        let savePath = tab.path;
        if (!savePath) {
          const { save } = await import("@tauri-apps/plugin-dialog");
          const chosen = await save({ title: "Save File", defaultPath: tab.name });
          if (!chosen) return;
          savePath = chosen;
        }
        await writeFileSmart(savePath, engine.getText());
        engine.markClean();
        setStore("tabs", store.tabs.map(t => t.id === tabId ? { ...t, path: savePath, name: basename(savePath), dirty: false } : t));
      }
    }
    doTabClose(tabId);
  }

  function doTabClose(tabId: string) {
    const tab = store.tabs.find(t => t.id === tabId);
    if (!tab) return;

    if (tab.type === "explorer") setStore("sidebarVisible", true);
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
    setStore("panelCount", autoDemotePanelCount(store.panelCount, newTabs.length));

    if (store.activeTabId === tabId) {
      if (newTabs.length > 0) switchToTab(newTabs[newTabs.length - 1].id);
      else setStore("activeTabId", null);
    }
  }

  return {
    switchToTab, createNewFile, createTerminalTab,
    createGitTab, createSettingsTab, createKeybindingsTab, createExtensionsTab,
    createDebugTab, createProblemsTab, createConsoleTab, createAiTab,
    createBrowserTab, popOutSidebar,
    handleTermIdReady, handleTermTitleChange,
    handleTabClose, handleExternalChangeResult, handleDirtyCloseResult,
    doTabClose,
  };
}
