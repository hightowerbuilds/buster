import { describe, expect, it } from "vitest";
import { createEditorEngine, computeDisplayRows, getCharWidth, PADDING_LEFT } from "./engine";
import { colToPixel } from "./text-measure";
import { captureWritingScroll, restoreWritingScroll, clampWritingScroll, isMarkdownPath, writingViewportBox } from "./writing-viewport";
import type { WritingLayout } from "../lib/writing-appearance";

const layout: WritingLayout = { paddingTop: 20, paddingBottom: 20, paddingLeft: 24, paddingRight: 24, columnWidth: 0, alignment: "left" };

describe("writing viewport", () => {
  it("recognizes saved and untitled Markdown names, including upper case extensions", () => {
    expect(["/notes/chapter.md", "untitled.MD", "essay.markdown"].every(isMarkdownPath)).toBe(true);
    expect(["chapter.md.txt", "plain.txt", "", null].some(isMarkdownPath)).toBe(false);
  });

  it("insets only Markdown and includes the gutter in fixed column width", () => {
    expect(writingViewportBox(1000, 600, layout)).toEqual({ left: 24, top: 20, width: 952, height: 560 });
    expect(writingViewportBox(1000, 600, { ...layout, columnWidth: 640, alignment: "center" })).toEqual({ left: 180, top: 20, width: 640, height: 560 });
    expect(writingViewportBox(1000, 600, { ...layout, columnWidth: 640 })).toEqual({ left: 24, top: 20, width: 640, height: 560 });
    expect(writingViewportBox(1000, 600, layout, false)).toEqual({ left: 0, top: 0, width: 1000, height: 600 });
  });

  it("yields asymmetric padding proportionally in small panes and never overflows", () => {
    const box = writingViewportBox(200, 60, { ...layout, paddingLeft: 80, paddingRight: 40, paddingTop: 40, paddingBottom: 40, columnWidth: 640, alignment: "center" });
    expect(box.width).toBe(160);
    expect(box.height).toBe(44);
    expect(box.left).toBeCloseTo(80 / 3);
    expect(box.top).toBe(8);
    expect(writingViewportBox(80, 20, layout)).toEqual({ left: 0, top: 0, width: 80, height: 20 });
    expect(writingViewportBox(0, 0, layout)).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });

  it("maps padded global mouse positions through the unchanged editor origin, with and without gutters", () => {
    const engine = createEditorEngine("first line\nA中B text\nlast line");
    const box = writingViewportBox(1000, 600, { ...layout, columnWidth: 640, alignment: "center" });
    const rect = { left: 100 + box.left, top: 70 + box.top } as DOMRect;
    for (const lineNumbers of [true, false]) {
      const gutter = lineNumbers ? 50 : 0;
      const x = rect.left + gutter + PADDING_LEFT + colToPixel("A中B text", 2, getCharWidth(14));
      expect(engine.posFromPixel(x, rect.top + 23, rect, 0, 14, lineNumbers, true, box.width)).toEqual({ line: 1, col: 2 });
      expect(engine.posFromPixel(x, rect.top + 1, rect, 22, 14, lineNumbers, true, box.width)).toEqual({ line: 1, col: 2 });
    }
  });

  it("keeps the top visible logical passage and intra-row offset after wrapping changes", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `${index}: ${"a long writing passage ".repeat(8)}`);
    const before = computeDisplayRows(lines, 8, 800, true, 50);
    const after = computeDisplayRows(lines, 8, 280, true, 50);
    const top = 17 * 22 + 7;
    const anchor = captureWritingScroll(before, top, 22)!;
    const restored = restoreWritingScroll(after, anchor, 22);
    const rowIndex = Math.floor(restored / 22);
    expect(after[rowIndex].bufferLine).toBe(anchor.line);
    expect(after[rowIndex].startCol).toBeLessThanOrEqual(anchor.col);
    expect(after[rowIndex].startCol + after[rowIndex].text.length).toBeGreaterThan(anchor.col);
    expect(restored % 22).toBeCloseTo(7);
    expect(restored).toBeGreaterThan(top);
  });

  it("chooses the following segment at exact wrap boundaries and preserves unwrapped rows", () => {
    const rows = [{ bufferLine: 0, startCol: 0, text: "hello " }, { bufferLine: 0, startCol: 6, text: "world" }, { bufferLine: 1, startCol: 0, text: "last" }];
    expect(restoreWritingScroll(rows, { line: 0, col: 6, fraction: 0.5 }, 22)).toBe(33);
    const unwrapped = computeDisplayRows(["first", "middle", "last"], 8, 100, false, 50);
    expect(restoreWritingScroll(unwrapped, captureWritingScroll(unwrapped, 27, 22), 22)).toBe(27);
  });

  it("clamps after content shrinks and leaves document, cursor, selection and undo untouched", () => {
    const engine = createEditorEngine("first\nsecond\nthird");
    engine.setSelection({ line: 1, col: 1 }, { line: 2, col: 2 });
    const before = { text: engine.getText(), cursor: engine.cursor(), selection: engine.sel(), dirty: engine.dirty(), revision: engine.editSeq() };
    const anchor = captureWritingScroll(engine.computeDisplayRows(8, 500, true, 50), 30, 22);
    restoreWritingScroll(engine.computeDisplayRows(8, 200, true, 50), anchor, 22);
    expect({ text: engine.getText(), cursor: engine.cursor(), selection: engine.sel(), dirty: engine.dirty(), revision: engine.editSeq() }).toEqual(before);
    expect(clampWritingScroll(1000, 3, 22)).toBe(44);
    expect(clampWritingScroll(-10, 3, 22)).toBe(0);
    expect(clampWritingScroll(1000, 1, 22)).toBe(0);
    expect(restoreWritingScroll([{ bufferLine: 0, startCol: 0, text: "short" }], anchor, 22)).toBe(0);
    expect(restoreWritingScroll([], anchor, 22)).toBe(0);
  });
});
