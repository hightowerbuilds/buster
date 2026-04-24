import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import type { Tab } from "./tab-types";
import { basename } from "buster-path";
import { isImageFile } from "./tab-types";
import { readFile, watchFile, largeFileOpen, largeFileReadLines, largeFileClose } from "./ipc";
import { showError } from "./notify";

export function createFileActions(
  store: BusterStoreState,
  setStore: SetStoreFunction<BusterStoreState>,
  switchToTab: (tabId: string) => void,
  addRecentFile: (path: string, name: string) => void,
  fetchDiffHunks: (tabId: string, filePath: string) => Promise<void>,
  attemptLspStart: (filePath: string, workspaceRoot: string) => void,
) {
  async function loadFileContent(path: string): Promise<{ content: string; fileName: string; filePath: string }> {
    try {
      const file = await readFile(path);
      return { content: file.content, fileName: file.file_name, filePath: file.path };
    } catch {
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

  async function handleFileSelect(path: string) {
    const existing = store.tabs.find(t => t.path === path && (t.type === "file" || t.type === "image"));
    if (existing) { switchToTab(existing.id); return; }

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

    setStore("fileLoading", true);
    try {
      const { content, fileName, filePath } = await loadFileContent(path);
      setStore("fileTabCounter", c => c + 1);
      const tabId = `file_${store.fileTabCounter}`;
      const newTab: Tab = { id: tabId, name: fileName, path: filePath, dirty: false, type: "file" };

      setStore("fileTexts", tabId, content);
      setStore("tabs", [...store.tabs, newTab]);
      switchToTab(tabId);
      addRecentFile(filePath, fileName);

      watchFile(filePath).catch(() => showError("File watcher failed — external changes may be missed"));
      fetchDiffHunks(tabId, filePath);

      if (store.workspaceRoot) {
        attemptLspStart(filePath, store.workspaceRoot);
      }
    } catch {
      showError("Failed to open file");
    }
    setStore("fileLoading", false);
  }

  return { loadFileContent, handleFileSelect };
}
