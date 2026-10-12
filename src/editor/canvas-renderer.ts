import type { SearchMatch, CursorPos } from "../lib/ipc";
import { type DisplayRow, PADDING_LEFT, computeDisplayRows } from "./engine";
import { getCharWidth, FONT_FAMILY, colToPixel } from "./text-measure";
import { type ThemePalette, drawVignette, drawGrain } from "../lib/theme";
import type { WebGLTextContext } from "./webgl-text";
import { writingTextColor } from "./writing-effects";

// ─── Extracted renderer modules ────────────────────────────────────
import { setCurrentGpu, monoText } from "./render-shared";
import { drawFoldMarkers } from "./render-gutter";
import { drawCursors } from "./render-overlays";

// ─── Display row memoization ───────────────────────────────────────

let _cachedRows: DisplayRow[] = [];
let _cachedLines: string[] | null = null;
let _cachedCharW = 0;
let _cachedEditorW = 0;
let _cachedWrap = false;
let _cachedGutterW = 0;
let _cachedFoldedSize = 0;

function getDisplayRows(
  lines: string[], charW: number, editorW: number,
  wordWrap: boolean, gutterW: number, foldedLines: Set<number> | undefined,
): DisplayRow[] {
  const foldedSize = foldedLines?.size ?? 0;
  if (
    lines === _cachedLines &&
    charW === _cachedCharW &&
    editorW === _cachedEditorW &&
    wordWrap === _cachedWrap &&
    gutterW === _cachedGutterW &&
    foldedSize === _cachedFoldedSize
  ) {
    return _cachedRows;
  }
  _cachedRows = computeDisplayRows(lines, charW, editorW, wordWrap, gutterW, foldedLines);
  _cachedLines = lines;
  _cachedCharW = charW;
  _cachedEditorW = editorW;
  _cachedWrap = wordWrap;
  _cachedGutterW = gutterW;
  _cachedFoldedSize = foldedSize;
  return _cachedRows;
}

// ─── Types ─────────────────────────────────────────────────────────

export interface EditorRenderParams {
  width: number;
  height: number;
  scrollTop: number;
  lines: string[];
  fontSize: number;
  lineHeight?: number;
  writingStyle?: { focusDim: number; contrast: boolean; pulse: number };
  lineNumbers: boolean;
  wordWrap: boolean;
  cursors: CursorPos[];
  cursorVisible: boolean;
  selStart: { line: number; col: number } | null;
  selEnd: { line: number; col: number } | null;
  searchMatches: SearchMatch[];
  currentSearchIdx: number;
  palette: ThemePalette;
  foldedLines: Set<number>;
  foldStartLines: Set<number>;
  isFoldable: (line: number) => boolean;
  cursorStyle: "line" | "block";
  gpu?: WebGLTextContext | null;
  tabSize: number;
  showIndentGuides: boolean;
  showWhitespace: boolean;
}

// ─── Main render orchestrator ──────────────────────────────────────

export function renderEditor(canvas: HTMLCanvasElement, params: EditorRenderParams): void {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;

  setCurrentGpu(params.gpu ?? null);

  const dpr = (typeof globalThis !== "undefined" && globalThis.devicePixelRatio) || 1;
  const w = params.width;
  const h = params.height;

  const targetW = Math.round(w * dpr);
  const targetH = Math.round(h * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.imageSmoothingEnabled = true;
  ctx.filter = "none";

  const fontSize = params.fontSize;
  const lineHeight = params.lineHeight ?? fontSize + 8;
  const showLineNums = params.lineNumbers;
  const gutterW = showLineNums ? 50 : 0;
  const charW = getCharWidth(fontSize);
  const font = `${fontSize}px ${FONT_FAMILY}`;
  const wordWrap = params.wordWrap;

  const p = params.palette;
  const gpu = params.gpu ?? null;

  if (gpu?.isActive()) {
    gpu.beginFrame(fontSize, FONT_FAMILY);
  }

  // Background
  ctx.fillStyle = p.editorBg;
  ctx.fillRect(0, 0, w, h);
  // Atmosphere stays behind text and selection in both CPU and GPU renderers.
  drawVignette(ctx, w, h, p);
  drawGrain(ctx, w, h, p);

  const lines = params.lines;
  const displayRows = getDisplayRows(lines, charW, w, wordWrap, gutterW, params.foldedLines.size > 0 ? params.foldedLines : undefined);

  const firstVisRow = Math.floor(params.scrollTop / lineHeight);
  const visCount = Math.ceil(h / lineHeight) + 1;
  const lastVisRow = Math.min(firstVisRow + visCount, displayRows.length);
  const offsetY = -(params.scrollTop % lineHeight);

  const primaryCursorLine = params.cursors.length > 0 ? params.cursors[0].line : -1;

  drawSelection(ctx, params, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, gutterW, charW);
  drawSelectionOccurrences(ctx, params, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, gutterW, charW);
  drawSearchHighlights(ctx, params.searchMatches, params.currentSearchIdx, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, gutterW, charW);

  ctx.font = font;

  // Draw gutter
  if (showLineNums) {
    ctx.fillStyle = p.gutterBg;
    ctx.fillRect(0, 0, gutterW, h);
  }

  drawTextRows(ctx, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, fontSize, gutterW, charW, primaryCursorLine, showLineNums, p, params.writingStyle);

  // Indent guides
  if (params.showIndentGuides) {
    drawIndentGuides(ctx, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, gutterW, charW, params.tabSize, primaryCursorLine);
  }

  // Whitespace rendering
  if (params.showWhitespace) {
    drawWhitespace(ctx, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, fontSize, gutterW, charW);
  }

  if (params.cursorVisible && params.writingStyle?.pulse) {
    const cursor = params.cursors[0];
    for (let r = firstVisRow; cursor && r < lastVisRow; r++) {
      const row = displayRows[r];
      if (row.bufferLine !== cursor.line || cursor.col < row.startCol || cursor.col > row.startCol + row.text.length) continue;
      const x = gutterW + PADDING_LEFT + colToPixel(row.text, cursor.col - row.startCol, charW);
      const y = (r - firstVisRow) * lineHeight + offsetY + lineHeight / 2;
      ctx.save();
      ctx.strokeStyle = p.cursor;
      ctx.globalAlpha = params.writingStyle.pulse * 0.24;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 4 + (1 - params.writingStyle.pulse) * 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      break;
    }
  }
  drawCursors(ctx, params, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, gutterW, charW, p);

  // Fold markers
  if (showLineNums) {
    drawFoldMarkers(ctx, params, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, charW);
  }

  // Gutter separator
  if (showLineNums) {
    ctx.strokeStyle = p.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gutterW, 0);
    ctx.lineTo(gutterW, h);
    ctx.stroke();
  }

  if (gpu?.isActive()) {
    gpu.flushFrame(w, h);
  }

  setCurrentGpu(null);
}

// ─── Selection ─────────────────────────────────────────────────────

function drawSelection(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  gutterW: number,
  charW: number
) {
  if (!params.selStart || !params.selEnd) return;

  const s = params.selStart;
  const e = params.selEnd;
  const sLine = Math.min(s.line, e.line);
  const eLine = Math.max(s.line, e.line);
  const sCol = s.line < e.line ? s.col : (s.line === e.line ? Math.min(s.col, e.col) : e.col);
  const eCol = s.line < e.line ? e.col : (s.line === e.line ? Math.max(s.col, e.col) : s.col);

  ctx.fillStyle = params.palette.selection;
  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.bufferLine >= sLine && dr.bufferLine <= eLine) {
      const y = (r - firstVisRow) * lineHeight + offsetY;
      const startCol = dr.bufferLine === sLine ? Math.max(0, sCol - dr.startCol) : 0;
      const endCol = dr.bufferLine === eLine ? Math.min(dr.text.length, eCol - dr.startCol) : dr.text.length;
      if (endCol > startCol) {
        const x1 = gutterW + PADDING_LEFT + colToPixel(dr.text, startCol, charW);
        const x2 = gutterW + PADDING_LEFT + colToPixel(dr.text, endCol, charW);
        ctx.fillRect(x1, y, x2 - x1, lineHeight);
      }
    }
  }
}

// ─── Search Highlights ─────────────────────────────────────────────

function drawSearchHighlights(
  ctx: CanvasRenderingContext2D,
  searchMatches: SearchMatch[],
  currentSearchIdx: number,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  gutterW: number,
  charW: number
) {
  if (!searchMatches || searchMatches.length === 0) return;

  for (let mi = 0; mi < searchMatches.length; mi++) {
    const m = searchMatches[mi];
    const isCurrent = mi === currentSearchIdx;
    ctx.fillStyle = isCurrent ? "rgba(249, 226, 175, 0.55)" : "rgba(249, 226, 175, 0.25)";
    for (let r = firstVisRow; r < lastVisRow; r++) {
      const dr = displayRows[r];
      if (dr.bufferLine === m.line) {
        const localStart = m.start_col - dr.startCol;
        const localEnd = m.end_col - dr.startCol;
        if (localEnd > 0 && localStart < dr.text.length) {
          const y = (r - firstVisRow) * lineHeight + offsetY;
          const cs = Math.max(0, localStart);
          const ce = Math.min(dr.text.length, localEnd);
          const x1 = gutterW + PADDING_LEFT + colToPixel(dr.text, cs, charW);
          const x2 = gutterW + PADDING_LEFT + colToPixel(dr.text, ce, charW);
          ctx.fillRect(x1, y, x2 - x1, lineHeight);
          if (isCurrent) {
            ctx.strokeStyle = "rgba(249, 226, 175, 0.7)";
            ctx.lineWidth = 1;
            ctx.strokeRect(x1, y, x2 - x1, lineHeight);
          }
        }
      }
    }
  }
}

// ─── Selection Occurrence Highlights ──────────────────────────────

function drawSelectionOccurrences(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  gutterW: number,
  charW: number,
) {
  if (!params.selStart || !params.selEnd) return;

  const s = params.selStart;
  const e = params.selEnd;
  // Only highlight occurrences for single-line word selections
  if (s.line !== e.line) return;

  const sCol = Math.min(s.col, e.col);
  const eCol = Math.max(s.col, e.col);
  const line = params.lines[s.line] ?? "";
  const selectedText = line.slice(sCol, eCol);

  // Only for word-like selections (2+ chars, no whitespace)
  if (selectedText.length < 2 || /\s/.test(selectedText)) return;

  ctx.fillStyle = "rgba(137, 180, 250, 0.15)";
  ctx.strokeStyle = "rgba(137, 180, 250, 0.3)";
  ctx.lineWidth = 1;

  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    // Skip the selected line itself
    if (dr.bufferLine === s.line) continue;

    const text = params.lines[dr.bufferLine] ?? "";
    let idx = text.indexOf(selectedText);
    while (idx !== -1) {
      if (idx >= dr.startCol && idx < dr.startCol + dr.text.length) {
        const localStart = idx - dr.startCol;
        const localEnd = localStart + selectedText.length;
        const x1 = gutterW + PADDING_LEFT + colToPixel(dr.text, localStart, charW);
        const x2 = gutterW + PADDING_LEFT + colToPixel(dr.text, Math.min(localEnd, dr.text.length), charW);
        const y = (r - firstVisRow) * lineHeight + offsetY;
        ctx.fillRect(x1, y, x2 - x1, lineHeight);
        ctx.strokeRect(x1, y, x2 - x1, lineHeight);
      }
      idx = text.indexOf(selectedText, idx + 1);
    }
  }
}

// ─── Text Rows ─────────────────────────────────────────────────────

function drawTextRows(
  ctx: CanvasRenderingContext2D,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  fontSize: number,
  gutterW: number,
  charW: number,
  primaryCursorLine: number,
  showLineNums: boolean,
  p: ThemePalette,
  writingStyle?: EditorRenderParams["writingStyle"],
) {
  const font = `${fontSize}px ${FONT_FAMILY}`;
  const baselineY = lineHeight - Math.floor(fontSize * 0.35);

  let lastDrawnBufferLine = -1;
  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    const y = (r - firstVisRow) * lineHeight + offsetY;
    const dim = dr.bufferLine === primaryCursorLine ? 0 : writingStyle?.focusDim ?? 0;
    const adjust = writingStyle?.contrast || dim > 0;
    const textColor = adjust ? writingTextColor(p.syntaxDefault, p.editorBg, dim) : p.syntaxDefault;

    if (showLineNums && dr.bufferLine !== lastDrawnBufferLine) {
      const lineNum = String(dr.bufferLine + 1);
      const numColor = dr.bufferLine === primaryCursorLine ? p.text : p.textMuted;
      const numX = gutterW - 8 - lineNum.length * charW;
      monoText(ctx, lineNum, numX, y, numColor, font, charW, lineHeight, baselineY);
    }
    lastDrawnBufferLine = dr.bufferLine;

    if (dr.bufferLine === primaryCursorLine) {
      ctx.fillStyle = p.currentLine;
      ctx.fillRect(gutterW, y, ctx.canvas.width / ((typeof globalThis !== "undefined" && globalThis.devicePixelRatio) || 1) - gutterW, lineHeight);
    }

    monoText(ctx, dr.text, gutterW + PADDING_LEFT, y, textColor, font, charW, lineHeight, baselineY);
  }
}

// ─── Indent Guides ──────────────────────────────────────────────────

function drawIndentGuides(
  ctx: CanvasRenderingContext2D,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  gutterW: number,
  charW: number,
  tabSize: number,
  primaryCursorLine: number,
) {
  const step = tabSize * charW;
  if (step < 2) return;

  // Determine the active indent level from the cursor's line
  let activeIndentLevel = -1;
  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.bufferLine === primaryCursorLine && dr.startCol === 0) {
      const text = dr.text;
      let spaces = 0;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === " ") spaces++;
        else if (text[i] === "\t") spaces += tabSize;
        else break;
      }
      activeIndentLevel = Math.floor(spaces / tabSize);
      break;
    }
  }

  const guideColor = "rgba(255, 255, 255, 0.06)";
  const activeColor = "rgba(255, 255, 255, 0.14)";

  ctx.lineWidth = 1;

  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.startCol !== 0) continue; // skip wrapped continuation rows

    const text = dr.text;
    // Count leading whitespace in columns
    let spaces = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === " ") spaces++;
      else if (text[i] === "\t") spaces += tabSize;
      else break;
    }
    // For blank lines, use the max indent of surrounding lines
    if (text.trim().length === 0) {
      // Look at previous and next non-blank lines for context
      let prev = 0, next = 0;
      for (let pr = r - 1; pr >= 0; pr--) {
        const pdr = displayRows[pr];
        if (pdr.startCol !== 0) continue;
        const pt = pdr.text;
        if (pt.trim().length > 0) {
          for (let i = 0; i < pt.length; i++) {
            if (pt[i] === " ") prev++;
            else if (pt[i] === "\t") prev += tabSize;
            else break;
          }
          break;
        }
      }
      for (let nr = r + 1; nr < displayRows.length; nr++) {
        const ndr = displayRows[nr];
        if (ndr.startCol !== 0) continue;
        const nt = ndr.text;
        if (nt.trim().length > 0) {
          for (let i = 0; i < nt.length; i++) {
            if (nt[i] === " ") next++;
            else if (nt[i] === "\t") next += tabSize;
            else break;
          }
          break;
        }
      }
      spaces = Math.min(prev, next);
    }

    const levels = Math.floor(spaces / tabSize);
    const y = (r - firstVisRow) * lineHeight + offsetY;

    for (let level = 1; level <= levels; level++) {
      const x = gutterW + PADDING_LEFT + (level - 1) * step;
      ctx.strokeStyle = (level === activeIndentLevel) ? activeColor : guideColor;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, y);
      ctx.lineTo(Math.round(x) + 0.5, y + lineHeight);
      ctx.stroke();
    }
  }
}

// ─── Whitespace Rendering ───────────────────────────────────────────

function drawWhitespace(
  ctx: CanvasRenderingContext2D,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  fontSize: number,
  gutterW: number,
  charW: number,
) {
  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  const dotRadius = Math.max(1, fontSize * 0.07);
  const centerY = lineHeight / 2;

  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    const y = (r - firstVisRow) * lineHeight + offsetY;
    const text = dr.text;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === " ") {
        // Small centered dot for spaces
        const x = gutterW + PADDING_LEFT + colToPixel(text, i, charW) + charW / 2;
        ctx.beginPath();
        ctx.arc(x, y + centerY, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      } else if (ch === "\t") {
        // Right arrow for tabs
        const x = gutterW + PADDING_LEFT + colToPixel(text, i, charW);
        const arrowY = y + centerY;
        const arrowLen = charW * 0.7;
        const arrowHead = charW * 0.2;
        ctx.beginPath();
        ctx.moveTo(x + charW * 0.15, arrowY);
        ctx.lineTo(x + charW * 0.15 + arrowLen, arrowY);
        ctx.lineTo(x + charW * 0.15 + arrowLen - arrowHead, arrowY - arrowHead);
        ctx.moveTo(x + charW * 0.15 + arrowLen, arrowY);
        ctx.lineTo(x + charW * 0.15 + arrowLen - arrowHead, arrowY + arrowHead);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }
}
