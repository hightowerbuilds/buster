import { produce } from "solid-js/store";
import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import type { EngineMap } from "./buster-context";
import type { AppSettings } from "./ipc";
import { unwatchFile, addRecentFolder } from "./ipc";

export function createWorkspaceActions(
  store: BusterStoreState,
  setStore: SetStoreFunction<BusterStoreState>,
  engines: EngineMap,
  refreshGitBranch: (root: string) => Promise<void>,
  updateSettings: (s: AppSettings) => void,
) {
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

  return { openWorkspace, changeDirectory, closeDirectory };
}
