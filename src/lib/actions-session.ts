import type { BusterStoreState } from "./store-types";
import type { EngineMap } from "./buster-context";
import type { SessionSnapshot } from "./session";
import { persistSession } from "./session";
import { logWarn } from "./notify";

export function createSessionActions(
  store: BusterStoreState,
  engines: EngineMap,
) {
  let restoreReady = false;

  function finishSessionRestore() { restoreReady = true; }

  function buildSnapshot(): SessionSnapshot {
    return {
      workspaceRoot: store.workspaceRoot,
      activeTabId: store.activeTabId,
      splitView: store.splitView ? { ...store.splitView } : null,
      sidebarVisible: store.sidebarVisible,
      sidebarWidth: store.sidebarWidth,
      tabs: [...store.tabs],
      engines: engines.map,
      fileTexts: { ...store.fileTexts },
      scrollPositions: new Map(Object.entries(store.scrollPositions)),
    };
  }

  async function saveSessionNow(strict = false) {
    if (!restoreReady) {
      if (strict) throw new Error("Session recovery has not completed; existing recovery data is preserved.");
      return;
    }
    try { await persistSession(buildSnapshot()); }
    catch (e) {
      if (strict) throw e;
      logWarn("Session save failed", e);
    }
  }

  return { buildSnapshot, saveSessionNow, finishSessionRestore };
}
