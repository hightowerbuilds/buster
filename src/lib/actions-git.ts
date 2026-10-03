import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import { gitBranch as fetchGitBranch, gitIsRepo, gitDiffHunks } from "./ipc";

export function createGitActions(
  store: BusterStoreState,
  setStore: SetStoreFunction<BusterStoreState>,
) {
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

  return { refreshGitBranch, fetchDiffHunks };
}
