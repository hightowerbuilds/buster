import {
  saveSession as saveSessionIpc,
  loadSession as loadSessionIpc,
  saveBackupBuffer,
  confirmAppClose,
  type SessionState,
  type SessionTab,
} from "./ipc";
import type { Tab } from "./tab-types";
import { serializePanelCount, type PanelCount } from "./panel-count";

export interface SessionSnapshot {
  workspaceRoot: string | null;
  activeTabId: string | null;
  panelCount: PanelCount;
  paneWorkspace?: import("./writing-panes").PaneWorkspace;
  sidebarVisible: boolean;
  sidebarWidth: number;
  tabs: Tab[];
  engines: Map<string, { getText: () => string; cursor: () => { line: number; col: number }; dirty?: () => boolean; sel?: () => import("../editor/engine").Selection | null }>;
  fileTexts: Record<string, string>;
  scrollPositions: Map<string, number>;
}

/** Build a SessionState from the current app state for persistence. */
function buildSessionState(snap: SessionSnapshot): SessionState {
  const sessionTabs: SessionTab[] = snap.tabs.map((tab) => ({
    id: tab.id,
    type: tab.type,
    name: tab.name,
    path: tab.path,
    dirty: snap.engines.get(tab.id)?.dirty?.() ?? tab.dirty,
    cursor_line: snap.engines.get(tab.id)?.cursor().line ?? tab.restoredCursor?.line ?? 0,
    cursor_col: snap.engines.get(tab.id)?.cursor().col ?? tab.restoredCursor?.col ?? 0,
    scroll_top: snap.scrollPositions.get(tab.id) ?? 0,
    backup_key: null, // Set after backup write
    selection: snap.engines.get(tab.id)?.sel
      ? snap.engines.get(tab.id)!.sel!()
      : tab.restoredSelection ?? null,
  }));

  return {
    version: 1,
    workspace_root: snap.workspaceRoot,
    active_tab_id: snap.activeTabId,
    layout_mode: serializePanelCount(snap.paneWorkspace ? snap.paneWorkspace.panes.length as PanelCount : snap.panelCount),
    pane_workspace: snap.paneWorkspace ? JSON.parse(JSON.stringify(snap.paneWorkspace)) : null,
    sidebar_visible: snap.sidebarVisible,
    sidebar_width: Number.isFinite(snap.sidebarWidth) ? Math.round(Math.min(600, Math.max(140, snap.sidebarWidth))) : 220,
    tabs: sessionTabs,
    timestamp: new Date().toISOString(),
  };
}

let saveQueue: Promise<void> = Promise.resolve();

/** Capture buffers now and serialize writes so overlapping saves cannot regress state. */
export function persistSession(snap: SessionSnapshot): Promise<void> {
  const session = buildSessionState(snap);
  const backups = session.tabs.filter(tab => tab.type === "file" && tab.dirty).map(tab => ({
    tab,
    identity: tab.path || `untitled:${tab.id}`,
    text: snap.engines.get(tab.id)?.getText() ?? snap.fileTexts[tab.id],
  }));
  const write = async () => {
    for (const backup of backups) {
      if (backup.text === undefined) throw new Error(`Missing unsaved buffer: ${backup.tab.name}`);
      backup.tab.backup_key = await saveBackupBuffer(backup.identity, backup.text);
    }
    await saveSessionIpc(session);
  };
  const pending = saveQueue.then(write);
  saveQueue = pending.catch(() => {});
  return pending;
}

/** Load session from disk. Returns null only when no saved session exists. */
export async function loadSessionFromDisk(): Promise<SessionState | null> {
  return loadSessionIpc();
}

/** Close the app window (called after hot-exit save completes). */
export async function closeApp(): Promise<void> {
  return confirmAppClose();
}
