import { describe, expect, it, vi } from "vitest";
import { prepareSessionRestore } from "./session-restore";
import type { SessionState, SessionTab } from "./ipc";

function tab(overrides: Partial<SessionTab> = {}): SessionTab {
  return { id: "file_1", type: "file", name: "Draft.md", path: "/notes/Draft.md", dirty: false,
    cursor_line: 3, cursor_col: 2, scroll_top: 120, backup_key: null, ...overrides };
}
function session(tabs: SessionTab[]): SessionState {
  return { version: 1, workspace_root: "/notes", active_tab_id: tabs[0]?.id ?? null,
    layout_mode: "tabs", sidebar_visible: true, sidebar_width: 240, tabs, timestamp: "" };
}
const deps = () => ({ readFile: vi.fn(async () => "disk text"), readBackup: vi.fn(async (_key: string): Promise<string | null> => "unsaved text") });

describe("session restoration", () => {
  it("migrates all old tabs in order, ignores damaged geometry, and preserves selection", async () => {
    const selection = { anchor: { line: 0, col: 1 }, head: { line: 0, col: 3 } };
    const saved = { ...session([tab({ selection }), tab({ id: "file_2" }), tab({ id: "hidden" })]),
      pane_workspace: { activePaneId: "p2", panes: [{ id: "p2", tabId: "file_2" }], layout: "damaged", zoomedPaneId: "p2" } };
    const restored = await prepareSessionRestore(saved, deps());
    expect(restored.tabs.map(tab => tab.id)).toEqual(["file_1", "file_2", "hidden"]);
    expect(restored.activeTabId).toBe("file_1");
    expect(restored.tabs[0].restoredSelection).toEqual(selection);
    saved.active_tab_id = "missing";
    expect((await prepareSessionRestore(saved, deps())).activeTabId).toBe("file_2");
    saved.pane_workspace.panes = [];
    expect((await prepareSessionRestore(saved, deps())).activeTabId).toBe("file_1");
  });
  it("restores version 2 and handles an empty workspace without a placeholder", async () => {
    const saved = { ...session([tab(), tab({ id: "file_2" })]), version: 2, active_tab_id: "file_2" };
    expect((await prepareSessionRestore(saved, deps())).activeTabId).toBe("file_2");
    expect(await prepareSessionRestore({ ...session([]), version: 2 }, deps())).toMatchObject({ tabs: [], activeTabId: null });
  });

  it("restores live dirty text instead of the disk version, with cursor and scroll", async () => {
    const io = deps();
    const restored = await prepareSessionRestore(session([tab({ dirty: true, backup_key: "aa" })]), io);
    expect(restored.fileTexts.file_1).toBe("unsaved text");
    expect(restored.tabs[0]).toMatchObject({ dirty: true, restoredCursor: { line: 3, col: 2 } });
    expect(restored.scrollPositions.file_1).toBe(120);
    expect(io.readFile).not.toHaveBeenCalled();
  });

  it("keeps distinct untitled drafts and accepts an intentionally empty buffer", async () => {
    const io = deps();
    io.readBackup.mockImplementation(async key => key === "aa" ? "first draft" : "");
    const restored = await prepareSessionRestore(session([
      tab({ path: "", dirty: true, backup_key: "aa" }),
      tab({ id: "file_2", path: "", dirty: true, backup_key: "bb" }),
    ]), io);
    expect(restored.fileTexts).toEqual({ file_1: "first draft", file_2: "" });
    expect(restored.tabs).toHaveLength(2);
  });

  it("skips retired panels, shells from older versions, and missing clean files", async () => {
    const io = deps();
    io.readFile.mockRejectedValue(new Error("missing file"));
    const restored = await prepareSessionRestore(session([
      tab({ type: "debug", id: "debug", name: "Debugger" }),
      tab({ type: "explorer", id: "explorer_tab", name: "Explorer" }), tab(),
      tab({ type: "terminal", id: "term_tab_7", path: "", name: "Terminal" }),
    ]), io);
    expect(restored.tabs).toEqual([]);
    expect(restored.activeTabId).toBeNull();
    expect(restored.skipped).toEqual(["Debugger", "Explorer", "Draft.md", "Terminal"]);
    expect(restored.fileTexts).toEqual({});
  });

  it("fails the whole restore when an unsaved backup is missing", async () => {
    const io = deps();
    io.readBackup.mockResolvedValue(null);
    await expect(prepareSessionRestore(session([tab({ dirty: true, backup_key: "aa" })]), io)).rejects.toThrow("Unsaved backup");
    await expect(prepareSessionRestore(session([tab({ dirty: true })]), io)).rejects.toThrow("Unsaved backup");
    expect(io.readFile).not.toHaveBeenCalled();
  });

  it("reads clean documents and rejects ambiguous tab identities", async () => {
    const io = deps();
    expect((await prepareSessionRestore(session([tab()]), io)).fileTexts.file_1).toBe("disk text");
    await expect(prepareSessionRestore(session([tab(), tab()]), io)).rejects.toThrow("duplicate");
    await expect(prepareSessionRestore(session([tab({ id: "__proto__" })]), io)).rejects.toThrow("Invalid");
    await expect(prepareSessionRestore({ ...session([]), version: 99 }, io)).rejects.toThrow("version");
  });

  it("restores a note alongside Settings with the saved focus and divider width", async () => {
    const saved = { ...session([tab(), tab({ id: "settings_tab", type: "settings", path: "", name: "Settings" })]),
      version: 2, active_tab_id: "settings_tab",
      split_view: { leftTabId: "file_1", rightTabId: "settings_tab", ratio: 0.62 } };
    const restored = await prepareSessionRestore(saved, deps());
    expect(restored.splitView).toEqual(saved.split_view);
    expect(restored.activeTabId).toBe("settings_tab");
    saved.active_tab_id = "missing";
    expect((await prepareSessionRestore(saved, deps())).activeTabId).toBe("file_1");
  });

  it("discards damaged or missing pairs and clamps saved divider widths without discarding notes", async () => {
    const saved = { ...session([tab(), tab({ id: "file_2" })]), version: 2,
      split_view: { leftTabId: "file_1", rightTabId: "file_2", ratio: 100 } };
    expect((await prepareSessionRestore(saved, deps())).splitView?.ratio).toBe(0.75);
    for (const value of [null, "damaged", {}, { leftTabId: "file_1", rightTabId: "file_1" },
      { leftTabId: "file_1", rightTabId: "missing", ratio: 0.5 }]) {
      const restored = await prepareSessionRestore({ ...saved, split_view: value as typeof saved.split_view }, deps());
      expect(restored.splitView).toBeNull(); expect(restored.tabs).toHaveLength(2);
    }
    const io = deps(); io.readFile.mockRejectedValueOnce(new Error("removed"));
    const restored = await prepareSessionRestore(saved, io);
    expect(restored.tabs.map(tab => tab.id)).toEqual(["file_2"]); expect(restored.splitView).toBeNull();
  });
});
