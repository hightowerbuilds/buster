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
      panelCount: store.panelCount,
      paneWorkspace: store.paneWorkspace,
      sidebarVisible: store.sidebarVisible,
      sidebarWidth: store.sidebarWidth,
      tabs: [...store.tabs],
      engines: engines.map,
      fileTexts: { ...store.fileTexts },
      scrollPositions: new Map(Object.entries(store.scrollPositions)),
    };
  }

  async function saveSessionNow() {
    if (!restoreReady) return;
    try { await persistSession(buildSnapshot()); }
    catch (e) { logWarn("Session save failed", e); }
  }

  return { buildSnapshot, saveSessionNow, finishSessionRestore };
}
