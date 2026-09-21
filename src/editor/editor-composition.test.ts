import { describe, expect, it, vi } from "vitest";
import { handleEditorKeyDown, type KeyboardDeps } from "./editor-keyboard";
import { handleEditorInput, type InputDeps } from "./editor-input";
import { createEditorEngine } from "./engine";

describe("native composition ownership", () => {
  it("separates selection replacement from immediately preceding and following typing", () => {
    const engine = createEditorEngine(""); engine.insert("abA");
    engine.setSelection({ line: 0, col: 0 }, { line: 0, col: 2 });
    const input = { value: "x" } as HTMLTextAreaElement;
    handleEditorInput({ engine, hiddenInput: () => input, isComposing: () => false,
      languagePath: () => "Note.md", indentUnit: () => "  ", clearHighlightCache: vi.fn(),
      ac: { trigger: vi.fn() }, sigHelp: { onChar: vi.fn() }, ghost: { scheduleRequest: vi.fn() } } as unknown as InputDeps);
    expect(engine.getText()).toBe("xA");
    engine.insert("!"); engine.undo(); expect(engine.getText()).toBe("xA");
    engine.undo(); expect(engine.getText()).toBe("abA");
    engine.undo(); expect(engine.getText()).toBe("");
  });
  it("lets native printable input replace a selection exactly once", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    try {
      const engine = createEditorEngine("a draft"); engine.setSelection({ line: 0, col: 2 }, { line: 0, col: 7 });
      const input = { value: "" } as HTMLTextAreaElement, preventDefault = vi.fn();
      const deps = { engine, ac: { completionVisible: () => false, trigger: vi.fn() },
        codeActions: { menuVisible: () => false }, hiddenInput: () => input, isComposing: () => false,
        languagePath: () => "Note.md", indentUnit: () => "  ", clearHighlightCache: vi.fn(),
        sigHelp: { onChar: vi.fn() }, ghost: { scheduleRequest: vi.fn() } };
      handleEditorKeyDown({ key: "e", preventDefault } as unknown as KeyboardEvent, deps as unknown as KeyboardDeps);
      expect(preventDefault).not.toHaveBeenCalled(); expect(engine.getText()).toBe("a draft");
      expect(engine.sel()).not.toBeNull();
      input.value = "é"; handleEditorInput(deps as unknown as InputDeps);
      expect(engine.getText()).toBe("a é"); expect(input.value).toBe("");
      handleEditorInput(deps as unknown as InputDeps); expect(engine.getText()).toBe("a é");
      engine.undo(); expect(engine.getText()).toBe("a draft");
    } finally { vi.unstubAllGlobals(); }
  });
  it.each([{ isComposing: true, keyCode: 69 }, { isComposing: false, keyCode: 229 }])
  ("keeps the final native composition key out of direct insertion: %j", flags => {
    const engine = createEditorEngine("");
    const input = { value: "é" } as HTMLTextAreaElement;
    const deps = { engine, hiddenInput: () => input, isComposing: () => false,
      languagePath: () => "Note.md", indentUnit: () => "  ", clearHighlightCache: vi.fn(),
      ac: { trigger: vi.fn() }, sigHelp: { onChar: vi.fn() }, ghost: { scheduleRequest: vi.fn() } } as unknown as InputDeps;
    handleEditorInput(deps);
    expect(engine.getText()).toBe("é");
    const preventDefault = vi.fn();
    handleEditorKeyDown({ key: "e", ...flags, preventDefault } as unknown as KeyboardEvent,
      { engine, isComposing: () => false } as unknown as KeyboardDeps);
    expect(engine.getText()).toBe("é");
    expect(preventDefault).not.toHaveBeenCalled();
  });
  it("retains the composition buffer until native composition ends", () => {
    const engine = createEditorEngine("draft");
    const input = { value: "日本語" } as HTMLTextAreaElement;
    handleEditorInput({ engine, hiddenInput: () => input, isComposing: () => true } as unknown as InputDeps);
    expect(engine.getText()).toBe("draft");
    expect(input.value).toBe("日本語");
  });
});
