import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import { lspStart, lspStatus } from "./ipc";
import { showError, logWarn } from "./notify";

const LSP_MAX_RETRIES = 3;
const LSP_BACKOFF_BASE = 2000;

export function createLspActions(
  store: BusterStoreState,
  setStore: SetStoreFunction<BusterStoreState>,
) {
  let lspFailCount = 0;

  function attemptLspStart(filePath: string, workspaceRoot: string) {
    if (store.lspState === "crashed") return;
    setStore("lspState", "starting");
    lspStart(filePath, workspaceRoot)
      .then(() => {
        lspFailCount = 0;
        setStore("lspState", "active");
        lspStatus().then(langs => setStore("lspLanguages", langs)).catch(() => {});
      })
      .catch(() => {
        lspFailCount++;
        if (lspFailCount >= LSP_MAX_RETRIES) {
          setStore("lspState", "crashed");
          showError(`Language server crashed after ${LSP_MAX_RETRIES} attempts — click LSP in status bar to restart`);
        } else {
          const delay = LSP_BACKOFF_BASE * Math.pow(2, lspFailCount - 1);
          logWarn(`LSP failed (attempt ${lspFailCount}/${LSP_MAX_RETRIES}), retrying in ${delay / 1000}s`);
          setStore("lspState", "error");
          setTimeout(() => attemptLspStart(filePath, workspaceRoot), delay);
        }
      });
  }

  function restartLsp() {
    lspFailCount = 0;
    setStore("lspState", "inactive");
    const fileTab = store.tabs.find(t => t.type === "file" && t.path);
    if (fileTab && store.workspaceRoot) {
      attemptLspStart(fileTab.path, store.workspaceRoot);
    }
  }

  return { attemptLspStart, restartLsp };
}
