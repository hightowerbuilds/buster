import type { BusterStoreState } from "./store-types";
import type { EngineMap } from "./buster-context";
import type { SessionSnapshot } from "./session";
import { persistSession } from "./session";

export function createSessionActions(
  store: BusterStoreState,
  engines: EngineMap,
) {
  function buildSnapshot(): SessionSnapshot {
    return {
      workspaceRoot: store.workspaceRoot,
      activeTabId: store.activeTabId,
      panelCount: store.panelCount,
      sidebarVisible: store.sidebarVisible,
      sidebarWidth: store.sidebarWidth,
      tabs: [...store.tabs],
      engines: engines.map,
      scrollPositions: new Map(Object.entries(store.scrollPositions)),
    };
  }

  async function saveSessionNow() {
    try { await persistSession(buildSnapshot()); }
    catch (e) { console.warn("Session save failed:", e); }
  }

  return { buildSnapshot, saveSessionNow };
}
