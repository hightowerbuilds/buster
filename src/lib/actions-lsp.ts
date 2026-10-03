import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import { lspStart, lspStatus } from "./ipc";
import { showError, logWarn } from "./notify";

const LSP_MAX_RETRIES = 3;
const LSP_BACKOFF_BASE = 2000;
// Writing documents have no configured language server. Avoid even an IPC startup.
const isWritingDocument = (path: string) => /\.(?:md|markdown|mdown|mkd|txt|text)$/i.test(path);

export function createLspActions(
  store: BusterStoreState,
  setStore: SetStoreFunction<BusterStoreState>,
) {
  type Attempt = { failures: number; pending: boolean; timer?: ReturnType<typeof setTimeout> };
  const attempts = new Map<string, Attempt>();

  function attemptLspStart(filePath: string, workspaceRoot: string) {
    if (isWritingDocument(filePath)) return;
    const key = JSON.stringify([workspaceRoot, filePath]);
    const attempt = attempts.get(key) ?? { failures: 0, pending: false };
    if (attempt.pending || attempt.timer || attempt.failures >= LSP_MAX_RETRIES) return;
    attempts.set(key, attempt);
    attempt.pending = true;
    setStore("lspState", "starting");
    lspStart(filePath, workspaceRoot)
      .then(started => {
        if (attempts.get(key) !== attempt) return;
        attempt.pending = false;
        attempt.failures = 0;
        if (!started) {
          setStore("lspState", store.lspLanguages.length ? "active" : "inactive");
          return;
        }
        setStore("lspState", "active");
        lspStatus().then(langs => {
          if (attempts.get(key) === attempt) setStore("lspLanguages", langs);
        }).catch(() => {});
      })
      .catch(error => {
        if (attempts.get(key) !== attempt) return;
        attempt.pending = false;
        attempt.failures++;
        const reason = error instanceof Error ? error.message : String(error);
        if (attempt.failures >= LSP_MAX_RETRIES) {
          setStore("lspState", "crashed");
          showError(`Language server failed to start after ${LSP_MAX_RETRIES} attempts: ${reason}. Click LSP in the status bar to retry.`);
        } else {
          const delay = LSP_BACKOFF_BASE * Math.pow(2, attempt.failures - 1);
          logWarn(`LSP failed for ${filePath} (attempt ${attempt.failures}/${LSP_MAX_RETRIES}): ${reason}; retrying in ${delay / 1000}s`);
          setStore("lspState", "error");
          attempt.timer = setTimeout(() => {
            attempt.timer = undefined;
            if (store.tabs.some(tab => tab.type === "file" && tab.path === filePath))
              attemptLspStart(filePath, workspaceRoot);
          }, delay);
        }
      });
  }

  function restartLsp() {
    for (const attempt of attempts.values()) if (attempt.timer) clearTimeout(attempt.timer);
    attempts.clear();
    setStore("lspState", store.lspLanguages.length ? "active" : "inactive");
    const fileTab = store.tabs.find(t => t.type === "file" && t.path && !isWritingDocument(t.path));
    if (fileTab && store.workspaceRoot) attemptLspStart(fileTab.path, store.workspaceRoot);
  }

  return { attemptLspStart, restartLsp };
}
