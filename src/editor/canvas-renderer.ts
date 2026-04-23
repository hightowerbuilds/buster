import type { SearchMatch, CompletionItem, CursorPos, LspSignatureHelp, LspCodeAction, DiffHunk, GitBlameLine } from "../lib/ipc";
import type { LineToken } from "./ts-highlighter";
import { type DisplayRow, PADDING_LEFT, computeDisplayRows } from "./engine";
import { getCharWidth, FONT_FAMILY, colToPixel, stringDisplayWidth } from "./text-measure";
import { type ThemePalette, drawVignette, drawGrain } from "../lib/theme";
import type { WebGLTextContext } from "./webgl-text";

// ─── Extracted renderer modules ────────────────────────────────────
import { setCurrentGpu, monoText } from "./render-shared";
import { drawDiffGutter, drawDiagnosticGutter, drawDiagnostics, drawFoldMarkers } from "./render-gutter";
import { drawCursors, drawBlameGutter, drawAutocomplete, drawHoverTooltip, drawSignatureHelp, drawCodeActionLightBulb, drawCodeActionMenu } from "./render-overlays";
import { drawMinimap } from "./render-minimap";

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

export interface PhantomText {
  line: number;
  col: number;
  text: string;
  style: "ghost" | "inlay";
}

export interface EditorRenderParams {
  width: number;
  height: number;
  scrollTop: number;
  lines: string[];
  fontSize: number;
  lineNumbers: boolean;
  wordWrap: boolean;
  cursors: CursorPos[];
  cursorVisible: boolean;
  selStart: { line: number; col: number } | null;
  selEnd: { line: number; col: number } | null;
  searchMatches: SearchMatch[];
  currentSearchIdx: number;
  diagnostics: { line: number; col: number; endLine: number; endCol: number; severity: number; message: string }[];
  lineTokens: LineToken[][];
  completionVisible: boolean;
  completionItems: CompletionItem[];
  completionIdx: number;
  hoverText: string;
  hoverPos: { line: number; col: number } | null;
  hasBuffer: boolean;
  signatureHelp: LspSignatureHelp | null;
  codeActionLine: number | null;
  codeActionMenuVisible: boolean;
  codeActionItems: LspCodeAction[];
  codeActionIdx: number;
  palette: ThemePalette;
  phantomTexts: PhantomText[];
  diffHunks: DiffHunk[];
  blameData: GitBlameLine[] | null;
  minimap: boolean;
  bracketMatch: { open: { line: number; col: number }; close: { line: number; col: number } } | null;
  foldedLines: Set<number>;
  foldStartLines: Set<number>;
  isFoldable: (line: number) => boolean;
  breakpointLines: Set<number>;
  cursorStyle: "line" | "block";
  gpu?: WebGLTextContext | null;
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
  const lineHeight = fontSize + 8;
  const showLineNums = params.lineNumbers;
  const hasDiffHunks = params.diffHunks && params.diffHunks.length > 0;
  const diffStripW = hasDiffHunks ? 4 : 0;
  const blameVisible = params.blameData != null && params.blameData.length > 0;
  const lineNumW = showLineNums ? 50 + diffStripW : 0;
  const blameW = blameVisible ? 180 : 0;
  const gutterW = lineNumW + blameW;
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

  const lines = params.lines;
  const displayRows = getDisplayRows(lines, charW, w, wordWrap, gutterW, params.foldedLines.size > 0 ? params.foldedLines : undefined);

  const firstVisRow = Math.floor(params.scrollTop / lineHeight);
  const visCount = Math.ceil(h / lineHeight) + 1;
  const lastVisRow = Math.min(firstVisRow + visCount, displayRows.length);
  const offsetY = -(params.scrollTop % lineHeight);

  const primaryCursorLine = params.cursors.length > 0 ? params.cursors[0].line : -1;

  drawSelection(ctx, params, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, gutterW, charW);
  drawSearchHighlights(ctx, params.searchMatches, params.currentSearchIdx, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, gutterW, charW);

  ctx.font = font;

  // Draw gutter
  if (showLineNums || blameVisible) {
    ctx.fillStyle = p.gutterBg;
    ctx.fillRect(0, 0, gutterW, h);
  }

  if (showLineNums && hasDiffHunks) {
    drawDiffGutter(ctx, params.diffHunks, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight);
  }

  if (showLineNums) {
    drawDiagnosticGutter(ctx, params.diagnostics, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, gutterW);
  }

  drawTextRows(ctx, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, fontSize, gutterW, charW, primaryCursorLine, showLineNums, params.lineTokens, p, params.phantomTexts, lineNumW);

  if (blameVisible && params.blameData) {
    drawBlameGutter(ctx, params.blameData, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, fontSize, lineNumW, p);
  }
  drawCursors(ctx, params, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, gutterW, charW, p);

  // Breakpoint dots + fold markers
  if (showLineNums) {
    if (params.breakpointLines.size > 0) {
      let lastBpLine = -1;
      for (let r = firstVisRow; r < lastVisRow; r++) {
        const dr = displayRows[r];
        if (dr.bufferLine === lastBpLine) continue;
        lastBpLine = dr.bufferLine;
        if (params.breakpointLines.has(dr.bufferLine)) {
          const y = (r - firstVisRow) * lineHeight + offsetY + lineHeight / 2;
          ctx.fillStyle = "#f38ba8";
          ctx.beginPath();
          ctx.arc(24, y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    drawFoldMarkers(ctx, params, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, charW);
  }

  // Bracket match highlight
  if (params.bracketMatch) {
    const bm = params.bracketMatch;
    for (const pos of [bm.open, bm.close]) {
      for (let r = firstVisRow; r < lastVisRow; r++) {
        const dr = displayRows[r];
        if (dr.bufferLine === pos.line && pos.col >= dr.startCol && pos.col < dr.startCol + dr.text.length) {
          const x = gutterW + PADDING_LEFT + colToPixel(dr.text, pos.col - dr.startCol, charW);
          const y = (r - firstVisRow) * lineHeight + offsetY;
          ctx.strokeStyle = p.accent;
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, charW, lineHeight);
          break;
        }
      }
    }
  }

  // Gutter separator
  if (showLineNums || blameVisible) {
    ctx.strokeStyle = p.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gutterW, 0);
    ctx.lineTo(gutterW, h);
    ctx.stroke();
  }

  drawCodeActionLightBulb(ctx, params, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, gutterW);
  drawAutocomplete(ctx, params, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, fontSize, gutterW, charW, font, w, h);
  drawDiagnostics(ctx, params.diagnostics, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, gutterW, charW);
  drawSignatureHelp(ctx, params, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, fontSize, gutterW, charW, font, w);
  drawCodeActionMenu(ctx, params, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, fontSize, gutterW, charW, font, w, h);
  drawHoverTooltip(ctx, params, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, fontSize, gutterW, charW, w);

  if (params.minimap && displayRows.length > visCount) {
    drawMinimap(ctx, params, displayRows, lineHeight, w, h, gutterW, charW);
  }

  if (gpu?.isActive()) {
    gpu.flushFrame(w, h);
  }

  drawVignette(ctx, w, h, p);
  drawGrain(ctx, w, h, p);

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
  lineTokens: LineToken[][],
  p: ThemePalette,
  phantomTexts: PhantomText[],
  lineNumW: number
) {
  const font = `${fontSize}px ${FONT_FAMILY}`;
  const baselineY = lineHeight - Math.floor(fontSize * 0.35);

  const phantomByLine = new Map<number, PhantomText[]>();
  for (const pt of phantomTexts) {
    const arr = phantomByLine.get(pt.line) || [];
    arr.push(pt);
    phantomByLine.set(pt.line, arr);
  }

  let lastDrawnBufferLine = -1;
  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    const y = (r - firstVisRow) * lineHeight + offsetY;

    if (showLineNums && dr.bufferLine !== lastDrawnBufferLine) {
      const lineNum = String(dr.bufferLine + 1);
      const numColor = dr.bufferLine === primaryCursorLine ? p.text : p.textMuted;
      const numX = lineNumW - 8 - lineNum.length * charW;
      monoText(ctx, lineNum, numX, y, numColor, font, charW, lineHeight, baselineY);
    }
    lastDrawnBufferLine = dr.bufferLine;

    if (dr.bufferLine === primaryCursorLine) {
      ctx.fillStyle = p.currentLine;
      ctx.fillRect(gutterW, y, ctx.canvas.width / ((typeof globalThis !== "undefined" && globalThis.devicePixelRatio) || 1) - gutterW, lineHeight);
    }

    const rowPhantoms = (phantomByLine.get(dr.bufferLine) || [])
      .filter(pt => pt.col >= dr.startCol && pt.col <= dr.startCol + dr.text.length)
      .sort((a, b) => a.col - b.col);

    if (rowPhantoms.length === 0) {
      drawLineText(ctx, dr, lineTokens[dr.bufferLine], gutterW, charW, y, lineHeight, baselineY, font, p);
    } else {
      let xOffset = 0;
      let realCol = 0;

      for (const pt of rowPhantoms) {
        const insertCol = pt.col - dr.startCol;

        if (insertCol > realCol) {
          const segment = dr.text.slice(realCol, insertCol);
          drawSegmentWithTokens(ctx, segment, realCol, dr, lineTokens[dr.bufferLine], gutterW, charW, y, lineHeight, baselineY, font, xOffset, p);
          realCol = insertCol;
        }

        const phantomX = gutterW + PADDING_LEFT + colToPixel(dr.text, realCol, charW) + xOffset;
        const phantomColor = pt.style === "ghost" ? "rgba(137, 180, 250, 0.35)" : p.textMuted;
        monoText(ctx, pt.text, phantomX, y, phantomColor, font, charW, lineHeight, baselineY);
        xOffset += stringDisplayWidth(pt.text) * charW;
      }

      if (realCol < dr.text.length) {
        const segment = dr.text.slice(realCol);
        drawSegmentWithTokens(ctx, segment, realCol, dr, lineTokens[dr.bufferLine], gutterW, charW, y, lineHeight, baselineY, font, xOffset, p);
      }
    }
  }
}

function drawLineText(
  ctx: CanvasRenderingContext2D,
  dr: DisplayRow,
  tokens: LineToken[] | undefined,
  gutterW: number,
  charW: number,
  rowY: number,
  lineHeight: number,
  baselineY: number,
  font: string,
  p: ThemePalette
) {
  if (tokens && tokens.length > 0) {
    let lastEnd = 0;
    for (const token of tokens) {
      const tStart = token.start - dr.startCol;
      const tEnd = token.end - dr.startCol;
      if (tEnd <= 0 || tStart >= dr.text.length) continue;

      const visStart = Math.max(0, tStart);
      const visEnd = Math.min(dr.text.length, tEnd);

      if (visStart > lastEnd) {
        monoText(ctx, dr.text.slice(lastEnd, visStart), gutterW + PADDING_LEFT + colToPixel(dr.text, lastEnd, charW), rowY, p.syntaxDefault, font, charW, lineHeight, baselineY);
      }

      monoText(ctx, dr.text.slice(visStart, visEnd), gutterW + PADDING_LEFT + colToPixel(dr.text, visStart, charW), rowY, token.color, font, charW, lineHeight, baselineY);
      lastEnd = visEnd;
    }
    if (lastEnd < dr.text.length) {
      monoText(ctx, dr.text.slice(lastEnd), gutterW + PADDING_LEFT + colToPixel(dr.text, lastEnd, charW), rowY, p.syntaxDefault, font, charW, lineHeight, baselineY);
    }
  } else {
    monoText(ctx, dr.text, gutterW + PADDING_LEFT, rowY, p.syntaxDefault, font, charW, lineHeight, baselineY);
  }
}

function drawSegmentWithTokens(
  ctx: CanvasRenderingContext2D,
  segment: string,
  startCol: number,
  dr: DisplayRow,
  tokens: LineToken[] | undefined,
  gutterW: number,
  charW: number,
  rowY: number,
  lineHeight: number,
  baselineY: number,
  font: string,
  xOffset: number,
  p: ThemePalette
) {
  const endCol = startCol + segment.length;
  const baseX = gutterW + PADDING_LEFT + xOffset;

  if (tokens && tokens.length > 0) {
    let drawn = 0;
    for (const token of tokens) {
      const tStart = token.start - dr.startCol;
      const tEnd = token.end - dr.startCol;
      const visStart = Math.max(startCol, Math.max(0, tStart));
      const visEnd = Math.min(endCol, Math.min(dr.text.length, tEnd));
      if (visEnd <= visStart || visStart >= endCol || visEnd <= startCol) continue;

      const segStart = visStart - startCol;
      const segEnd = visEnd - startCol;

      if (segStart > drawn) {
        monoText(ctx, segment.slice(drawn, segStart), baseX + colToPixel(segment, drawn, charW), rowY, p.syntaxDefault, font, charW, lineHeight, baselineY);
      }

      monoText(ctx, segment.slice(segStart, segEnd), baseX + colToPixel(segment, segStart, charW), rowY, token.color, font, charW, lineHeight, baselineY);
      drawn = segEnd;
    }
    if (drawn < segment.length) {
      monoText(ctx, segment.slice(drawn), baseX + colToPixel(segment, drawn, charW), rowY, p.syntaxDefault, font, charW, lineHeight, baselineY);
    }
  } else {
    monoText(ctx, segment, baseX, rowY, p.syntaxDefault, font, charW, lineHeight, baselineY);
  }
}
