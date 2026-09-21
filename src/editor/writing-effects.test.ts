import { describe, expect, it } from "vitest";
import { generatePalette } from "../lib/theme";
import type { WritingAppearanceValues } from "../lib/writing-appearance";
import { createEditorEngine, getCharWidth, PADDING_LEFT } from "./engine";
import { renderEditor, type EditorRenderParams } from "./canvas-renderer";
import { captureWritingScroll, restoreWritingScroll } from "./writing-viewport";
import { writingContrast, writingPalette, writingPulse, writingTextColor, writingTypography } from "./writing-effects";
import { WebGLTextContext } from "./webgl-text";

const defaults: WritingAppearanceValues = {
  paddingTop: 20, paddingBottom: 20, paddingLeft: 24, paddingRight: 24, columnWidth: 0, alignment: "left",
  fontSize: 0, lineHeight: 0, background: "theme", focusDim: 0,
  cursorGlow: -1, vignette: -1, grain: -1, typingPulse: 0, motion: true, effectDuration: 240,
};
const base = generatePalette(215, { cursorGlow: 24, bgGlow: 0, vignette: 20, grain: 8 });

describe("writing effects", () => {
  it("inherits typography and theme effects until an explicit writing override is selected", () => {
    expect(writingTypography(defaults, 17)).toEqual({ fontSize: 17, lineHeight: 25 });
    expect(writingTypography(null, 15)).toEqual({ fontSize: 15, lineHeight: 23 });
    expect(writingTypography({ fontSize: 20, lineHeight: 1.8 }, 14)).toEqual({ fontSize: 20, lineHeight: 36 });
    expect(writingPalette(base, defaults)).toEqual(base);
    expect(writingPalette(base, { ...defaults, cursorGlow: 0, vignette: 0, grain: 0 })).toMatchObject({ cursorGlow: 0, vignette: 0, grain: 0 });
    expect(base.cursorGlow).toBe(24);
  });

  it("preserves ordinary text and caret contrast in all supplied backgrounds, including maximum focus dimming", () => {
    for (const background of ["theme", "paper", "midnight", "sage"] as const) {
      const palette = writingPalette(base, { ...defaults, background });
      expect(writingContrast(palette.cursor, palette.editorBg)).toBeGreaterThanOrEqual(4.5);
      for (const color of [palette.syntaxDefault, ...Object.values(palette.syntax)]) {
        expect(writingContrast(writingTextColor(color, palette.editorBg, 0.45), palette.editorBg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(palette.selection).not.toBe(palette.searchHighlight);
    }
    expect(writingPalette(base, { ...defaults, background: "paper", vignette: 100 }).vignette).toBe(30);
  });

  it("returns no pulse for stopped, hidden, unfocused, reduced-motion, or expired animation", () => {
    expect(writingPulse(1000, 1000, 240, 0.8, true)).toBe(0.8);
    expect(writingPulse(1120, 1000, 240, 0.8, true)).toBeCloseTo(0.4);
    expect(writingPulse(1240, 1000, 240, 0.8, true)).toBe(0);
    expect(writingPulse(1000, 1000, 240, 0.8, false)).toBe(0);
    expect(writingPulse(1000, null, 240, 0.8, true)).toBe(0);
    expect(writingPulse(2000, 1000, Infinity, 1, true)).toBe(0);
  });

  it("uses the same custom metrics for wrapped pointer placement and logical scrolling without editing a note", () => {
    const engine = createEditorEngine(Array.from({ length: 20 }, (_, i) => `Line ${i}: ${"a long paragraph ".repeat(5)}`).join("\n"));
    engine.setSelection({ line: 2, col: 1 }, { line: 3, col: 4 });
    const before = { text: engine.getText(), cursor: engine.cursor(), selection: engine.sel(), seq: engine.editSeq(), dirty: engine.dirty() };
    const initialRows = engine.computeDisplayRows(getCharWidth(14), 560, true, 50);
    const typography = writingTypography({ fontSize: 24, lineHeight: 2.1 }, 14);
    const metrics = { lineHeight: typography.lineHeight, charWidth: getCharWidth(typography.fontSize), gutterWidth: 230 };
    const rows = engine.computeDisplayRows(metrics.charWidth, 430, true, metrics.gutterWidth);
    const rect = { left: 182, top: 144 } as DOMRect;
    const scroll = restoreWritingScroll(rows, captureWritingScroll(initialRows, 8 * 22 + 11, 22), metrics.lineHeight);
    const visible = Math.floor(scroll / metrics.lineHeight) + 1;
    const position = engine.posFromPixel(rect.left + metrics.gutterWidth + PADDING_LEFT + metrics.charWidth * 2,
      rect.top + visible * metrics.lineHeight - scroll + 2, rect, scroll, typography.fontSize, true, true, 430, metrics);
    expect(position).toEqual({ line: rows[visible].bufferLine, col: rows[visible].startCol + 2 });
    expect({ text: engine.getText(), cursor: engine.cursor(), selection: engine.sel(), seq: engine.editSeq(), dirty: engine.dirty() }).toEqual(before);
  });
});

describe("writing render geometry", () => {
  it("places GPU glyphs at the shared CPU baseline and accounts for wide characters and surrogate pairs", () => {
    const glyphs: string[] = [], positions: number[][] = [];
    const fake = {
      atlas: { baseline: 19, getGlyph: (character: string) => { glyphs.push(character); return { x: 0, y: 0, w: 9, h: 22 }; } },
      renderer: { addChar: (x: number, y: number) => positions.push([x, y]) },
    };
    WebGLTextContext.prototype.queueText.call(fake as unknown as WebGLTextContext, "A中😀B", 58, 40, "#ffffff", 8, 33);
    expect(glyphs).toEqual(["A", "中", "😀", "B"]);
    expect(positions).toEqual([[57, 54], [65, 54], [81, 54], [97, 54]]);
    // Texture baseline 19 + destination y 54 = CPU row y 40 + baseline 33.
    expect(positions[0][1] + fake.atlas.baseline).toBe(73);
  });

  it("draws text, selection, and caret in the custom line-height grid used by pointer mapping", () => {
    const text: Array<{ text: string; y: number; color: string }> = [];
    const rectangles: Array<{ x: number; y: number; width: number; height: number; color: string }> = [];
    const context: Record<string, any> = {
      setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, save() {}, restore() {},
      fillText(value: string, _x: number, y: number) { text.push({ text: value, y, color: context.fillStyle }); },
      fillRect(x: number, y: number, width: number, height: number) { rectangles.push({ x, y, width, height, color: context.fillStyle }); },
    };
    const canvas = { width: 500, height: 300, getContext: () => context } as unknown as HTMLCanvasElement;
    context.canvas = canvas;
    const palette = writingPalette(base, { ...defaults, background: "paper", cursorGlow: 0, vignette: 0, grain: 0 });
    const params: EditorRenderParams = {
      width: 500, height: 300, scrollTop: 0, lines: ["first", "second", "third"], fontSize: 20, lineHeight: 40,
      lineNumbers: false, wordWrap: true, cursors: [{ line: 1, col: 2 }], cursorVisible: true,
      selStart: { line: 1, col: 0 }, selEnd: { line: 1, col: 2 }, searchMatches: [], currentSearchIdx: -1,
      diagnostics: [], lineTokens: [], completionVisible: false, completionItems: [], completionIdx: 0,
      hoverText: "", hoverPos: null, hasBuffer: true, signatureHelp: null, codeActionLine: null,
      codeActionMenuVisible: false, codeActionItems: [], codeActionIdx: 0, palette, phantomTexts: [], diffHunks: [],
      blameData: null, minimap: false, bracketMatch: null, foldedLines: new Set(), foldStartLines: new Set(), isFoldable: () => false,
      cursorStyle: "line", tabSize: 2, showIndentGuides: false, showWhitespace: false, renameState: null, errorPeekLine: null,
      writingStyle: { focusDim: 0.45, contrast: true, pulse: 0 },
    };
    renderEditor(canvas, params);
    expect(text.map(entry => [entry.text, entry.y])).toEqual([["first", 33], ["second", 73], ["third", 113]]);
    expect(rectangles.some(entry => entry.color === palette.selection && entry.y === 40 && entry.height === 40)).toBe(true);
    expect(rectangles.some(entry => entry.color === palette.cursor && entry.y === 42 && entry.height === 36)).toBe(true);
    expect(text[0].color).not.toBe(text[1].color);
    for (const entry of text) expect(writingContrast(entry.color, palette.editorBg)).toBeGreaterThanOrEqual(4.5);
  });
});
