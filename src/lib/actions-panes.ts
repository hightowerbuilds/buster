import { batch } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import { focusTabPanel } from "./focus-service";
import { adjacentPane, closeWritingPane, requirePane, resizeActivePane, resizePaneSplit, showTabInPane, splitWritingPane,
  type PaneDirection, type PaneWorkspace } from "./writing-panes";

export function createPaneActions(store: BusterStoreState, setStore: SetStoreFunction<BusterStoreState>, createNote: () => string, createTerminal: () => string) {
  function publish(workspace: PaneWorkspace) {
    const activeTabId = requirePane(workspace, workspace.activePaneId).tabId;
    batch(() => { setStore("paneWorkspace", workspace); setStore("activeTabId", activeTabId); });
    if (activeTabId) focusTabPanel(activeTabId);
    else requestAnimationFrame(() => {
      if (store.activeTabId || store.paneWorkspace.activePaneId !== workspace.activePaneId) return;
      Array.from(document.querySelectorAll<HTMLElement>("[data-pane-id]")).find(el => el.dataset.paneId === workspace.activePaneId)?.querySelector<HTMLButtonElement>("button")?.focus();
    });
  }
  function focusPane(paneId: string) {
    requirePane(store.paneWorkspace, paneId);
    publish({ ...store.paneWorkspace, activePaneId: paneId,
      zoomedPaneId: store.paneWorkspace.zoomedPaneId ? paneId : null });
  }
  function splitPane(direction: PaneDirection, content: "note" | "terminal" | "empty" = "note", paneId = store.paneWorkspace.activePaneId) {
    const next = splitWritingPane(store.paneWorkspace, direction, paneId);
    batch(() => {
      publish(next);
      if (content === "note") createNote();
      if (content === "terminal") createTerminal();
    });
    return next.activePaneId;
  }
  function showDocument(tabId: string, paneId = store.paneWorkspace.activePaneId) {
    if (!store.tabs.some(t => t.id === tabId)) throw new Error("Document or tool no longer exists.");
    publish(showTabInPane(store.paneWorkspace, tabId, paneId));
  }
  function swapPanes(first: string, second: string) {
    const a = requirePane(store.paneWorkspace, first), b = requirePane(store.paneWorkspace, second);
    publish({ ...store.paneWorkspace, panes: store.paneWorkspace.panes.map(p =>
      p.id === first ? { ...p, tabId: b.tabId } : p.id === second ? { ...p, tabId: a.tabId } : p) });
  }
  return {
    focusPane, splitPane, showDocument, swapPanes,
    closePane: (paneId = store.paneWorkspace.activePaneId) => publish(closeWritingPane(store.paneWorkspace, paneId)),
    navigatePane: (direction: PaneDirection) => { const next = adjacentPane(store.paneWorkspace, direction); if (next) focusPane(next); },
    resizePane: (direction: PaneDirection, amount = 0.05) => publish(resizeActivePane(store.paneWorkspace, direction, amount)),
    resizeSplit: (splitId: string, ratio: number) => setStore("paneWorkspace", resizePaneSplit(store.paneWorkspace, splitId, ratio)),
    zoomPane: (paneId = store.paneWorkspace.activePaneId) => {
      requirePane(store.paneWorkspace, paneId);
      publish({ ...store.paneWorkspace, activePaneId: paneId, zoomedPaneId: store.paneWorkspace.zoomedPaneId === paneId ? null : paneId });
    },
  };
}
export type PaneActions = ReturnType<typeof createPaneActions>;
