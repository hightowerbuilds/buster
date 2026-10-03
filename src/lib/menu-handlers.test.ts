import { afterEach, expect, it, vi } from "vitest";
import { setupMenuHandlers } from "./menu-handlers";
const handlers = vi.hoisted(() => new Map<string, () => void>());
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (name: string, callback: () => void) => { handlers.set(name, callback); return () => {}; }) }));
vi.mock("./clipboard", () => ({ clipboardRead: vi.fn(), clipboardWrite: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it("routes native undo/redo to the note engine, while ordinary fields retain native history", async () => {
  const undo = vi.fn(), redo = vi.fn(), execCommand = vi.fn();
  class Field { constructor(private editor: boolean) {} closest() { return this.editor ? {} : null; } }
  vi.stubGlobal("HTMLInputElement", Field); vi.stubGlobal("HTMLTextAreaElement", Field);
  const doc = { activeElement: new Field(true), execCommand };
  vi.stubGlobal("document", doc);
  await setupMenuHandlers({ activeEngine: () => ({ undo, redo } as any), changeDirectory: vi.fn(), closeDirectory: vi.fn(),
    openExtensions: vi.fn(), openSettings: vi.fn(), closeActiveTab: vi.fn(), createNewFile: vi.fn(), handleSave: vi.fn(), handleSaveAs: vi.fn() });
  handlers.get("menu-undo")!(); handlers.get("menu-redo")!();
  expect(undo).toHaveBeenCalledOnce(); expect(redo).toHaveBeenCalledOnce(); expect(execCommand).not.toHaveBeenCalled();
  doc.activeElement = new Field(false);
  handlers.get("menu-undo")!();
  expect(execCommand).toHaveBeenCalledWith("undo"); expect(undo).toHaveBeenCalledOnce();
});
