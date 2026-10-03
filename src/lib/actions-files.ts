import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import type { Tab } from "./tab-types";
import { basename } from "buster-path";
import { isImageFile } from "./tab-types";
import { readFile, watchFile } from "./ipc";
import { showError } from "./notify";

export function createFileActions(
  store: BusterStoreState,
  setStore: SetStoreFunction<BusterStoreState>,
  switchToTab: (tabId: string) => void,
  addRecentFile: (path: string, name: string) => void,
  fetchDiffHunks: (tabId: string, filePath: string) => Promise<void>,
  attemptLspStart: (filePath: string, workspaceRoot: string) => void,
) {
  const pendingReads = new Map<string, Promise<{ content: string; fileName: string; filePath: string }>>();
  let opening = 0;

  function loadFileContent(path: string): Promise<{ content: string; fileName: string; filePath: string }> {
    const existing = pendingReads.get(path);
    if (existing) return existing;
    // A failed UTF-8/permission read must not become an editable, altered document.
    const pending = readFile(path).then(file => ({ content: file.content, fileName: file.file_name, filePath: file.path }));
    pendingReads.set(path, pending);
    const cleanup = () => { if (pendingReads.get(path) === pending) pendingReads.delete(path); };
    void pending.then(cleanup, cleanup);
    return pending;
  }

  /** Open a file in a tab and return its tab ID. `activate: false` opens it without switching tabs. */
  async function openFile(path: string, options: { activate?: boolean } = {}): Promise<string | undefined> {
    const activate = options.activate ?? true;
    const existing = store.tabs.find(t => t.path === path && (t.type === "file" || t.type === "image"));
    if (existing) { if (activate) switchToTab(existing.id); return existing.id; }

    if (isImageFile(path)) {
      setStore("fileTabCounter", c => c + 1);
      const tabId = `file_${store.fileTabCounter}`;
      const fileName = basename(path);
      const newTab: Tab = { id: tabId, name: fileName, path, dirty: false, type: "image" };
      setStore("tabs", [...store.tabs, newTab]);
      if (activate) switchToTab(tabId);
      addRecentFile(path, fileName);
      return tabId;
    }

    opening++;
    setStore("fileLoading", true);
    try {
      const { content, fileName, filePath } = await loadFileContent(path);
      const opened = store.tabs.find(t => t.path === filePath && t.type === "file");
      if (opened) { if (activate) switchToTab(opened.id); return opened.id; }
      setStore("fileTabCounter", c => c + 1);
      const tabId = `file_${store.fileTabCounter}`;
      const newTab: Tab = { id: tabId, name: fileName, path: filePath, dirty: false, type: "file" };

      setStore("fileTexts", tabId, content);
      setStore("tabs", [...store.tabs, newTab]);
      if (activate) switchToTab(tabId);
      addRecentFile(filePath, fileName);

      watchFile(filePath).catch(() => showError("File watcher failed — external changes may be missed"));
      fetchDiffHunks(tabId, filePath);

      if (store.workspaceRoot) {
        attemptLspStart(filePath, store.workspaceRoot);
      }
      return tabId;
    } catch (error) {
      showError(`Could not open ${basename(path)}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      opening--;
      setStore("fileLoading", opening > 0);
    }
    return undefined;
  }

  async function handleFileSelect(path: string) { await openFile(path); }

  return { loadFileContent, handleFileSelect, openFile };
}
