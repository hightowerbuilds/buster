import type { SessionState } from "./ipc";
import type { Tab } from "./tab-types";
import { restoreSplitView, splitSide } from "./split-view";

// Unknown, retired (including debug), and transient extension surfaces are skipped.
const RESTORABLE_TYPES = new Set(["file", "image", "settings", "keybindings", "git", "extensions", "problems", "browser", "console", "ai"]);

export interface RestoreDeps {
  readFile: (path: string) => Promise<string>;
  readBackup: (key: string) => Promise<string | null>;
}

/** Prepare the whole restore before publishing tabs or enabling session writes. */
export async function prepareSessionRestore(session: SessionState, deps: RestoreDeps) {
  if (session.version !== 1 && session.version !== 2) throw new Error("Unsupported session version; existing session was preserved.");
  const tabs: Tab[] = [];
  const fileTexts: Record<string, string> = {};
  const scrollPositions: Record<string, number> = {};
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const saved of session.tabs) {
    if (!saved.id || seen.has(saved.id) || ["__proto__", "constructor", "prototype"].includes(saved.id)) {
      throw new Error("Invalid or duplicate session tab ID; existing session was preserved.");
    }
    seen.add(saved.id);
    if (!RESTORABLE_TYPES.has(saved.type)) { skipped.push(saved.name); continue; }
    if (saved.type === "file") {
      let text: string;
      if (saved.dirty) {
        if (!saved.backup_key) throw new Error(`Unsaved backup is missing for ${saved.name}; session saves are paused.`);
        const backup = await deps.readBackup(saved.backup_key);
        if (backup === null) throw new Error(`Unsaved backup is unavailable for ${saved.name}; session saves are paused.`);
        text = backup;
      } else if (saved.path) {
        try { text = await deps.readFile(saved.path); }
        catch { skipped.push(saved.name); continue; }
      } else {
        text = "";
      }
      fileTexts[saved.id] = text;
    }
    const nonnegative = (n: number) => Number.isFinite(n) ? Math.max(0, n) : 0;
    scrollPositions[saved.id] = nonnegative(saved.scroll_top);
    tabs.push({ id: saved.id, type: saved.type as Tab["type"], name: saved.name,
      path: saved.path || "",
      dirty: saved.type === "file" && saved.dirty,
      restoredSelection: saved.selection && [saved.selection.anchor, saved.selection.head].every(p => p && Number.isInteger(p.line) && Number.isInteger(p.col) && p.line >= 0 && p.col >= 0) ? saved.selection : null,
      restoredCursor: { line: Math.floor(nonnegative(saved.cursor_line)), col: Math.floor(nonnegative(saved.cursor_col)) },
    });
  }
  // Only consult the old active reference. Geometry is irrelevant, even if corrupt.
  let legacyActive: unknown;
  if (session.version === 1 && session.pane_workspace && typeof session.pane_workspace === "object") {
    const old = session.pane_workspace as { activePaneId?: unknown; panes?: unknown };
    if (Array.isArray(old.panes)) legacyActive = old.panes.find(p => p && p.id === old.activePaneId)?.tabId;
  }
  let activeTabId = tabs.find(tab => tab.id === session.active_tab_id)?.id
    ?? tabs.find(tab => tab.id === legacyActive)?.id ?? tabs[0]?.id ?? null;
  const splitView = restoreSplitView(session.split_view, new Set(tabs.map(tab => tab.id)));
  if (splitView && !splitSide(splitView, activeTabId)) activeTabId = splitView.leftTabId;
  return { tabs, fileTexts, scrollPositions, skipped, activeTabId, splitView };
}
