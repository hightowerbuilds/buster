import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import type { AppSettings } from "./ipc";
import { addRecentFolder } from "./ipc";

export function createWorkspaceActions(
  store: BusterStoreState,
  setStore: SetStoreFunction<BusterStoreState>,
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
    // Return to the app's Notes home without discarding open writing buffers.
    setStore("workspaceRoot", store.notesRoot);
    setStore("gitBranchName", null);
  }

  return { openWorkspace, changeDirectory, closeDirectory };
}
