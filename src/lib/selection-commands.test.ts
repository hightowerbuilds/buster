import { describe, expect, it, vi } from "vitest";
import { createEditorEngine } from "../editor/engine";
import { FeatureCommands } from "./feature-commands";
import { captureSelection, registerSelectionCommands } from "./selection-commands";

function fixture() {
  const engine = createEditorEngine("A café 世界 passage.");
  engine.setSelection({ line: 0, col: 2 }, { line: 0, col: 9 });
  let closed = false;
  const service = new FeatureCommands();
  const readClipboard = vi.fn(async () => "replacement\r\ntext");
  const writeClipboard = vi.fn(async () => true);
  registerSelectionCommands(service, { hasTab: id => id === "draft" && !closed, engine: id => id === "draft" ? engine : undefined, readClipboard, writeClipboard });
  const target = captureSelection("draft", engine)!;
  const run = (command: string, args: object = target, requestId: string = crypto.randomUUID()) => service.dispatch({ command, args: { ...args }, requestId }, "ai");
  return { engine, target, run, readClipboard, writeClipboard, closeSource: () => { closed = true; } };
}
describe("selection commands", () => {
  it("captures Unicode text without accessing the clipboard and validates range setting", async () => {
    const f = fixture();
    expect(await f.run("selection read", { tabId: f.target.tabId })).toMatchObject({ ok: true, data: { text: "café 世界", revision: 0 } });
    expect(f.readClipboard).not.toHaveBeenCalled();
    expect(f.writeClipboard).not.toHaveBeenCalled();
    expect(await f.run("selection set", f.target)).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    const { text: _text, ...args } = f.target;
    expect(await f.run("selection set", { ...args, range: { anchor: { line: -1, col: 0 }, head: { line: 0, col: 2 } } })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(await f.run("selection set", args)).toMatchObject({ ok: true, data: f.target });
  });
  it("retries copy once without changing selection or revision", async () => {
    const f = fixture();
    await Promise.all([f.run("selection copy", f.target, "same"), f.run("selection copy", f.target, "same")]);
    expect(f.writeClipboard).toHaveBeenCalledExactlyOnceWith("café 世界");
    expect(captureSelection("draft", f.engine)).toEqual(f.target);
  });
  it("pastes once, normalizes line endings, and isolates paste from subsequent typing in undo history", async () => {
    const f = fixture();
    await f.run("selection paste", f.target, "paste");
    await f.run("selection paste", f.target, "paste");
    expect(f.readClipboard).toHaveBeenCalledOnce();
    expect(f.engine.getText()).toBe("A replacement\ntext passage.");
    expect(f.engine.cursor()).toEqual({ line: 1, col: 4 });
    f.engine.insert("!");
    f.engine.undo();
    expect(f.engine.getText()).toBe("A replacement\ntext passage.");
    f.engine.undo();
    expect(f.engine.getText()).toBe("A café 世界 passage.");
    expect(f.engine.sel()).toEqual(f.target.range);
  });
  it("rejects edits or selection changes that occur while clipboard access is pending", async () => {
    for (const edit of [true, false]) {
      const f = fixture();
      let finish!: (s: string) => void;
      f.readClipboard.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
      const pending = f.run("selection paste");
      await vi.waitFor(() => expect(f.readClipboard).toHaveBeenCalledOnce());
      if (edit) f.engine.insert("new draft"); else f.engine.clearSelection();
      const expected = f.engine.getText();
      finish("late text");
      expect(await pending).toMatchObject({ ok: false, error: { code: "STALE_SELECTION" } });
      expect(f.engine.getText()).toBe(expected);
    }
  });
  it("keeps explicit source targeting after focus changes and rejects a closed source tab", async () => {
    const f = fixture();
    expect(await f.run("selection paste")).toMatchObject({ ok: true, data: { tabId: "draft" } });
    const g = fixture(); g.closeSource();
    expect(await g.run("selection paste")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(g.readClipboard).not.toHaveBeenCalled();
  });
  it("preserves writing on clipboard failure, empty clipboard, and multiple cursors", async () => {
    const f = fixture(); f.readClipboard.mockRejectedValue(new Error("permission"));
    expect(await f.run("selection paste")).toMatchObject({ ok: false, error: { code: "CLIPBOARD_UNAVAILABLE" } });
    f.readClipboard.mockResolvedValue("");
    expect(await f.run("selection paste")).toMatchObject({ ok: false, error: { code: "EMPTY_CLIPBOARD" } });
    f.writeClipboard.mockResolvedValue(false);
    expect(await f.run("selection copy")).toMatchObject({ ok: false, error: { code: "CLIPBOARD_UNAVAILABLE" } });
    f.engine.addCursor({ line: 0, col: 0 });
    expect(await f.run("selection paste")).toMatchObject({ ok: false, error: { code: "UNAVAILABLE" } });
    expect(f.engine.getText()).toBe("A café 世界 passage.");
  });
});
