import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistSession, type SessionSnapshot } from "./session";
import { saveBackupBuffer, saveSession } from "./ipc";

vi.mock("./ipc", () => ({ saveSession: vi.fn(async () => {}), saveBackupBuffer: vi.fn(async () => "abc"),
  loadSession: vi.fn(), confirmAppClose: vi.fn() }));

function snapshot(): SessionSnapshot {
  return { workspaceRoot: null, activeTabId: "file_1", sidebarVisible: true,
    sidebarWidth: 240, engines: new Map(), scrollPositions: new Map(),
    tabs: [1, 2].map(n => ({ id: `file_${n}`, type: "file", name: `Untitled ${n}`, path: "", dirty: true })),
    fileTexts: { file_1: "draft one", file_2: "draft two" } };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("session persistence", () => {
  it("does not revive a restored selection after the writer clears it", async () => {
    const snap = snapshot();
    snap.tabs[0].restoredSelection = { anchor: { line: 0, col: 0 }, head: { line: 0, col: 3 } };
    snap.engines.set("file_1", { getText: () => "draft one", cursor: () => ({ line: 0, col: 3 }), sel: () => null });
    await persistSession(snap);
    expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({ tabs: expect.arrayContaining([
      expect.objectContaining({ id: "file_1", selection: null }),
    ]) }));
  });

  it("writes only tab state in version 2 and captures order before later mutations", async () => {
    const snap = snapshot();
    const pending = persistSession(snap);
    snap.tabs.reverse(); snap.activeTabId = "file_2";
    await pending;
    const saved = vi.mocked(saveSession).mock.calls[0][0];
    expect(saved.version).toBe(2);
    expect(saved.active_tab_id).toBe("file_1");
    expect(saved.tabs.map(tab => tab.id)).toEqual(["file_1", "file_2"]);
    expect(saved).not.toHaveProperty("pane_workspace");
    expect(saved).not.toHaveProperty("layout_mode");
  });

  it("normalizes fractional sidebar widths for the native integer field", async () => {
    const snap = snapshot();
    snap.sidebarWidth = 185.625;
    await persistSession(snap);
    expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({ sidebar_width: 186 }));
  });

  it("backs up unmounted drafts independently before publishing the session", async () => {
    await persistSession(snapshot());
    expect(saveBackupBuffer).toHaveBeenNthCalledWith(1, "untitled:file_1", "draft one");
    expect(saveBackupBuffer).toHaveBeenNthCalledWith(2, "untitled:file_2", "draft two");
    expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({ tabs: [
      expect.objectContaining({ id: "file_1", backup_key: "abc", dirty: true }),
      expect.objectContaining({ id: "file_2", backup_key: "abc", dirty: true }),
    ] }));
  });

  it("captures live engine state immediately and orders overlapping writes", async () => {
    let release!: () => void;
    vi.mocked(saveBackupBuffer).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve("first"); }));
    let text = "first";
    const snap = snapshot();
    snap.tabs = [snap.tabs[0]];
    snap.tabs[0].dirty = false;
    snap.engines.set("file_1", { getText: () => text, cursor: () => ({ line: 1, col: 2 }), dirty: () => true });
    const first = persistSession(snap);
    text = "second";
    const second = persistSession(snap);
    text = "third";
    await vi.waitFor(() => expect(saveBackupBuffer).toHaveBeenCalledOnce());
    expect(saveSession).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second]);
    expect(saveBackupBuffer).toHaveBeenNthCalledWith(1, "untitled:file_1", "first");
    expect(saveBackupBuffer).toHaveBeenNthCalledWith(2, "untitled:file_1", "second");
    expect(saveSession).toHaveBeenNthCalledWith(1, expect.objectContaining({ tabs: [expect.objectContaining({ backup_key: "first", cursor_line: 1 })] }));
    expect(saveSession).toHaveBeenCalledTimes(2);
  });

  it("does not replace the saved session when a backup fails and permits a later retry", async () => {
    vi.mocked(saveBackupBuffer).mockRejectedValueOnce(new Error("disk full"));
    await expect(persistSession(snapshot())).rejects.toThrow("disk full");
    expect(saveSession).not.toHaveBeenCalled();
    await persistSession(snapshot());
    expect(saveSession).toHaveBeenCalledOnce();
  });

  it("refuses to save an unsaved document when its buffer is unavailable", async () => {
    const snap = snapshot();
    snap.fileTexts = {};
    await expect(persistSession(snap)).rejects.toThrow("Missing unsaved buffer");
    expect(saveSession).not.toHaveBeenCalled();
  });

  it("captures both pane IDs and their width before later layout changes", async () => {
    const snap = snapshot();
    snap.splitView = { leftTabId: "file_1", rightTabId: "file_2", ratio: 0.6 };
    const pending = persistSession(snap);
    snap.splitView.ratio = 0.3; snap.splitView.rightTabId = "settings_tab";
    await pending;
    expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({
      split_view: { leftTabId: "file_1", rightTabId: "file_2", ratio: 0.6 },
    }));
  });
});
