import { describe, expect, it, vi } from "vitest";
import { prepareSessionRestore } from "./session-restore";
import type { SessionState, SessionTab } from "./ipc";
import { newPaneWorkspace, showTabInPane, splitWritingPane } from "./writing-panes";

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
  it("restores note references, active pane, split layout, and selection together", async () => {
    const paneWorkspace = showTabInPane(splitWritingPane(newPaneWorkspace("file_1"), "right"), "file_2");
    const selection = { anchor: { line: 0, col: 1 }, head: { line: 0, col: 3 } };
    const saved = { ...session([tab({ selection }), tab({ id: "file_2" })]), pane_workspace: paneWorkspace };
    const restored = await prepareSessionRestore(saved, deps());
    expect(restored.paneWorkspace).toEqual(paneWorkspace);
    expect(restored.activeTabId).toBe("file_2");
    expect(restored.tabs[0].restoredSelection).toEqual(selection);
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

  it("skips retired panels and missing clean files and selects a surviving terminal", async () => {
    const io = deps();
    io.readFile.mockRejectedValue(new Error("missing file"));
    const restored = await prepareSessionRestore(session([
      tab({ type: "debug", id: "debug", name: "Debugger" }), tab(),
      tab({ type: "terminal", id: "term_tab_7", path: "", name: "Terminal" }),
    ]), io);
    expect(restored.tabs).toMatchObject([{ id: "term_tab_7", type: "terminal", path: "/notes" }]);
    expect(restored.activeTabId).toBe("term_tab_7");
    expect(restored.skipped).toEqual(["Debugger", "Draft.md"]);
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
    await expect(prepareSessionRestore({ ...session([]), version: 2 }, io)).rejects.toThrow("version");
  });
});
