import type { SearchMatch, CompletionItem, CursorPos, LspSignatureHelp, LspCodeAction, DiffHunk, GitBlameLine } from "../lib/ipc";
import type { LineToken } from "./ts-highlighter";
import { type DisplayRow, PADDING_LEFT, computeDisplayRows } from "./engine";
import { getCharWidth, FONT_FAMILY, measureTextWidth, colToPixel, stringDisplayWidth } from "./text-measure";
import { type ThemePalette, drawVignette, drawGrain, applyCursorGlow, clearCursorGlow } from "../lib/theme";
import { isWebGLActive, beginTextFrame, queueText, flushTextFrame } from "./webgl-text";

/** Whether to use WebGL for text rendering (GPU path) or Canvas 2D (CPU path). */
let useGPU = false;

/** Enable/disable GPU text rendering. */
export function setGPURendering(enabled: boolean): void {
  useGPU = enabled;
}

// ── Display row memoization ──────────────────────────────────────────
// computeDisplayRows is O(n) and called every render frame. Cache the
// result so we only recompute when content or layout params change.

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

/** Draw text — routes to WebGL (GPU) or Canvas 2D (CPU). */
function monoText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  font: string,
  cellW: number,
  _cellH: number,
  baselineY: number,
) {
  if (!text) return;
  if (useGPU && isWebGLActive()) {
    queueText(text, x, y, color, cellW);
    return;
  }
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y + baselineY);
}

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
  diagnostics: { line: number; col: number; endLine: number; endCol: number; severity: number; message: string }[];
  lineTokens: LineToken[][];
  completionVisible: boolean;
  completionItems: CompletionItem[];
  completionIdx: number;
  hoverText: string;
  hoverPos: { line: number; col: number } | null;
  hasBuffer: boolean;
  // Signature help
  signatureHelp: LspSignatureHelp | null;
  // Code actions
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
}

export function renderEditor(canvas: HTMLCanvasElement, params: EditorRenderParams): void {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;

  const dpr = (typeof globalThis !== "undefined" && globalThis.devicePixelRatio) || 1;
  const w = params.width;
  const h = params.height;

  // Only resize the canvas backing store when dimensions actually change
  const targetW = Math.round(w * dpr);
  const targetH = Math.round(h * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  // Full context state reset — prevents any leaked state from previous frames
  // (shadow, globalAlpha, compositeOperation, etc.) from accumulating.
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

  // Begin GPU text frame if active
  if (useGPU && isWebGLActive()) {
    beginTextFrame(fontSize, FONT_FAMILY);
  }

  // Background
  ctx.fillStyle = p.editorBg;
  ctx.fillRect(0, 0, w, h);

  const lines = params.lines;
  const displayRows = getDisplayRows(lines, charW, w, wordWrap, gutterW, params.foldedLines.size > 0 ? params.foldedLines : undefined);

  // Visible range in display rows
  const firstVisRow = Math.floor(params.scrollTop / lineHeight);
  const visCount = Math.ceil(h / lineHeight) + 1;
  const lastVisRow = Math.min(firstVisRow + visCount, displayRows.length);
  const offsetY = -(params.scrollTop % lineHeight);

  // Primary cursor line (first cursor)
  const primaryCursorLine = params.cursors.length > 0 ? params.cursors[0].line : -1;

  drawSelection(ctx, params, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, gutterW, charW);
  drawSearchHighlights(ctx, params.searchMatches, displayRows, firstVisRow, lastVisRow, offsetY, lineHeight, gutterW, charW);

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

  // Breakpoint dots + fold markers in gutter
  if (showLineNums) {
    // Breakpoint dots (red circles in left gutter)
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

  // Minimap + scrollbar indicator
  if (params.minimap && displayRows.length > visCount) {
    drawMinimap(ctx, params, displayRows, lineHeight, w, h, gutterW, charW);
  }

  // Flush GPU text frame
  if (useGPU && isWebGLActive()) {
    flushTextFrame(w, h);
  }

  // Canvas effects: vignette + grain (drawn last, on top of everything)
  drawVignette(ctx, w, h, p);
  drawGrain(ctx, w, h, p);
}

// --- Selection ---

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

// --- Search Highlights ---

function drawSearchHighlights(
  ctx: CanvasRenderingContext2D,
  searchMatches: SearchMatch[],
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  gutterW: number,
  charW: number
) {
  if (!searchMatches || searchMatches.length === 0) return;

  ctx.fillStyle = "rgba(249, 226, 175, 0.25)";
  for (const m of searchMatches) {
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
        }
      }
    }
  }
}

// --- Text Rows ---

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

  // Index phantom texts by line for quick lookup
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

    // Line number (only on first display row of a buffer line)
    if (showLineNums && dr.bufferLine !== lastDrawnBufferLine) {
      const lineNum = String(dr.bufferLine + 1);
      const numColor = dr.bufferLine === primaryCursorLine ? p.text : p.textMuted;
      // Right-align line numbers: draw each digit from the right
      const numX = lineNumW - 8 - lineNum.length * charW;
      monoText(ctx, lineNum, numX, y, numColor, font, charW, lineHeight, baselineY);
    }
    lastDrawnBufferLine = dr.bufferLine;

    // Current line highlight
    if (dr.bufferLine === primaryCursorLine) {
      ctx.fillStyle = p.currentLine;
      ctx.fillRect(gutterW, y, ctx.canvas.width / ((typeof globalThis !== "undefined" && globalThis.devicePixelRatio) || 1) - gutterW, lineHeight);
    }

    // Get phantom texts for this display row (must be in this row's column range)
    const rowPhantoms = (phantomByLine.get(dr.bufferLine) || [])
      .filter(pt => pt.col >= dr.startCol && pt.col <= dr.startCol + dr.text.length)
      .sort((a, b) => a.col - b.col);

    // Draw text with syntax highlighting + phantom text insertions
    if (rowPhantoms.length === 0) {
      // Fast path: no phantom text, draw normally
      drawLineText(ctx, dr, lineTokens[dr.bufferLine], gutterW, charW, y, lineHeight, baselineY, font, p);
    } else {
      // Slow path: interleave real text with phantom insertions
      let xOffset = 0; // extra pixel offset from phantom text inserted so far
      let realCol = 0; // how far into the display row we've drawn

      for (const pt of rowPhantoms) {
        const insertCol = pt.col - dr.startCol;

        // Draw real text up to the insertion point
        if (insertCol > realCol) {
          const segment = dr.text.slice(realCol, insertCol);
          drawSegmentWithTokens(ctx, segment, realCol, dr, lineTokens[dr.bufferLine], gutterW, charW, y, lineHeight, baselineY, font, xOffset, p);
          realCol = insertCol;
        }

        // Draw phantom text
        const phantomX = gutterW + PADDING_LEFT + colToPixel(dr.text, realCol, charW) + xOffset;
        const phantomColor = pt.style === "ghost" ? "rgba(137, 180, 250, 0.35)" : p.textMuted;
        monoText(ctx, pt.text, phantomX, y, phantomColor, font, charW, lineHeight, baselineY);
        xOffset += stringDisplayWidth(pt.text) * charW;
      }

      // Draw remaining real text after last phantom
      if (realCol < dr.text.length) {
        const segment = dr.text.slice(realCol);
        drawSegmentWithTokens(ctx, segment, realCol, dr, lineTokens[dr.bufferLine], gutterW, charW, y, lineHeight, baselineY, font, xOffset, p);
      }
    }
  }
}

/** Draw a full line of text with syntax tokens (no phantom text) */
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

/** Draw a segment of text at a column offset, applying syntax tokens, with extra xOffset for phantom shifts */
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
      // Clip to our segment range
      const visStart = Math.max(startCol, Math.max(0, tStart));
      const visEnd = Math.min(endCol, Math.min(dr.text.length, tEnd));
      if (visEnd <= visStart || visStart >= endCol || visEnd <= startCol) continue;

      const segStart = visStart - startCol;
      const segEnd = visEnd - startCol;

      // Gap before this token in our segment
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

// --- Blame Gutter ---

function formatRelativeDate(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;
  return `${Math.floor(diff / 31536000)}y ago`;
}

function drawBlameGutter(
  ctx: CanvasRenderingContext2D,
  blameData: GitBlameLine[],
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  fontSize: number,
  lineNumW: number,
  p: ThemePalette
) {
  // Index blame data by 1-based line number
  const blameByLine = new Map<number, GitBlameLine>();
  for (const bl of blameData) {
    blameByLine.set(bl.line, bl);
  }

  // Track which consecutive groups we've already shown info for
  let lastShownHash: string | null = null;
  let lastShownBufferLine = -1;

  const blameX = lineNumW + 6;
  const blameFont = `${fontSize - 2}px ${FONT_FAMILY}`;
  const blameCharW = getCharWidth(fontSize - 2);
  const blameBaselineY = lineHeight - Math.floor((fontSize - 2) * 0.35);

  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    // Only draw blame on the first display row of a buffer line
    if (dr.startCol !== 0) continue;

    const blameLine = blameByLine.get(dr.bufferLine + 1); // blame uses 1-based lines
    if (!blameLine) continue;

    const y = (r - firstVisRow) * lineHeight + offsetY;

    // Group consecutive lines with same hash: show info only on first line
    const sameGroup = blameLine.hash === lastShownHash && dr.bufferLine === lastShownBufferLine + 1;
    lastShownHash = blameLine.hash;
    lastShownBufferLine = dr.bufferLine;

    if (sameGroup) continue;

    const shortHash = blameLine.hash.slice(0, 7);
    const truncAuthor = blameLine.author.length > 12
      ? blameLine.author.slice(0, 12)
      : blameLine.author;
    const relDate = formatRelativeDate(blameLine.timestamp);
    const blameText = `${shortHash} ${truncAuthor} ${relDate}`;

    monoText(ctx, blameText, blameX, y, p.textMuted, blameFont, blameCharW, lineHeight, blameBaselineY);
  }
}

// --- Cursors ---

function drawCursors(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  gutterW: number,
  charW: number,
  p: ThemePalette
) {
  if (!params.cursorVisible || !params.hasBuffer) return;

  applyCursorGlow(ctx, p);
  for (let ci = 0; ci < params.cursors.length; ci++) {
    const cLine = params.cursors[ci].line;
    const cCol = params.cursors[ci].col;
    for (let r = firstVisRow; r < lastVisRow; r++) {
      const dr = displayRows[r];
      if (dr.bufferLine === cLine && cCol >= dr.startCol && cCol <= dr.startCol + dr.text.length) {
        const x = gutterW + PADDING_LEFT + colToPixel(dr.text, cCol - dr.startCol, charW);
        const y = (r - firstVisRow) * lineHeight + offsetY;
        ctx.fillStyle = ci === 0 ? p.cursor : p.cursorAlt;
        ctx.fillRect(x, y + 2, 2, lineHeight - 4);
        break;
      }
    }
  }
  clearCursorGlow(ctx);
}

// --- Autocomplete Dropdown ---

function drawAutocomplete(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  fontSize: number,
  gutterW: number,
  charW: number,
  font: string,
  w: number,
  h: number
) {
  if (!params.completionVisible || params.completionItems.length === 0) return;

  const items = params.completionItems;
  const cLine = params.cursors[0]?.line ?? 0;
  const cCol = params.cursors[0]?.col ?? 0;
  const itemH = lineHeight;
  const maxVisible = Math.min(items.length, 8);
  const dropW = Math.min(320, w - gutterW - 40);
  const dropH = maxVisible * itemH + 4;

  // Position below cursor
  let dropX = gutterW + PADDING_LEFT;
  let dropY = 0;
  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.bufferLine === cLine && cCol >= dr.startCol && cCol <= dr.startCol + dr.text.length) {
      dropX = gutterW + PADDING_LEFT + colToPixel(dr.text, cCol - dr.startCol, charW);
      dropY = (r - firstVisRow + 1) * lineHeight + offsetY;
      break;
    }
  }

  // Keep dropdown on screen
  if (dropX + dropW > w) dropX = w - dropW - 8;
  if (dropX < gutterW + 4) dropX = gutterW + 4;
  if (dropY + dropH > h) dropY = dropY - dropH - lineHeight;

  // Background
  ctx.fillStyle = "#181825";
  ctx.fillRect(dropX, dropY, dropW, dropH);
  ctx.strokeStyle = "#45475a";
  ctx.lineWidth = 1;
  ctx.strokeRect(dropX, dropY, dropW, dropH);

  // Items
  const selIdx = params.completionIdx;
  const acBaselineY = itemH - Math.floor(fontSize * 0.35);
  for (let i = 0; i < maxVisible; i++) {
    const item = items[i];
    const iy = dropY + 2 + i * itemH;

    if (i === selIdx) {
      ctx.fillStyle = "#313244";
      ctx.fillRect(dropX + 1, iy, dropW - 2, itemH);
    }

    const labelColor = i === selIdx ? "#cdd6f4" : "#a6adc8";
    monoText(ctx, item.label, dropX + 8, iy, labelColor, font, charW, itemH, acBaselineY);

    // Detail (right-aligned)
    const detailX = dropX + dropW - 8 - stringDisplayWidth(item.detail) * charW;
    monoText(ctx, item.detail, detailX, iy, "#585b70", font, charW, itemH, acBaselineY);
  }

  // Scroll indicator if more items
  if (items.length > maxVisible) {
    const moreFont = `${fontSize - 2}px JetBrains Mono, monospace`;
    const moreText = `+${items.length - maxVisible} more`;
    const moreCharW = getCharWidth(fontSize - 2);
    const moreX = dropX + dropW - 8 - stringDisplayWidth(moreText) * moreCharW;
    monoText(ctx, moreText, moreX, dropY + dropH - itemH, "#585b70", moreFont, moreCharW, itemH, acBaselineY);
  }
}

// --- Diff Gutter Indicators ---

// Diff gutter palette colors (Catppuccin Mocha)
const DIFF_GREEN = "#a6e3a1";
const DIFF_BLUE = "#89b4fa";
const DIFF_RED = "#f38ba8";

function drawDiffGutter(
  ctx: CanvasRenderingContext2D,
  diffHunks: DiffHunk[],
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
) {
  // Build a map of buffer line -> hunk kind for quick lookup
  const lineKind = new Map<number, string>();
  const deleteLines = new Set<number>();
  for (const hunk of diffHunks) {
    if (hunk.kind === "delete") {
      // Deleted lines show a triangle at the line where deletion occurred
      deleteLines.add(hunk.start_line - 1);
    } else {
      // start_line is 1-based from git, convert to 0-based
      for (let i = 0; i < hunk.line_count; i++) {
        lineKind.set(hunk.start_line - 1 + i, hunk.kind);
      }
    }
  }

  const stripX = 0;
  const stripW = 4;

  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    const y = (r - firstVisRow) * lineHeight + offsetY;

    // Only draw on first display row of each buffer line
    if (r > firstVisRow && displayRows[r - 1]?.bufferLine === dr.bufferLine) continue;

    // Draw colored strip for added/modified lines
    const kind = lineKind.get(dr.bufferLine);
    if (kind) {
      ctx.fillStyle = kind === "add" ? DIFF_GREEN : DIFF_BLUE;
      ctx.fillRect(stripX, y, stripW, lineHeight);
    }

    // Draw red triangle for deleted lines
    if (deleteLines.has(dr.bufferLine) && dr.startCol === 0) {
      const triY = y + lineHeight;
      ctx.fillStyle = DIFF_RED;
      ctx.beginPath();
      ctx.moveTo(stripX, triY - 4);
      ctx.lineTo(stripX + stripW, triY);
      ctx.lineTo(stripX, triY + 4);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// --- Diagnostic Gutter Indicators ---

function drawDiagnosticGutter(
  ctx: CanvasRenderingContext2D,
  diagnostics: EditorRenderParams["diagnostics"],
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  gutterW: number
) {
  if (!diagnostics || diagnostics.length === 0) return;

  // Collect highest severity per buffer line (1=error, 2=warning, 3+=info)
  const lineSeverity = new Map<number, number>();
  for (const diag of diagnostics) {
    const existing = lineSeverity.get(diag.line);
    if (existing === undefined || diag.severity < existing) {
      lineSeverity.set(diag.line, diag.severity);
    }
  }

  const radius = 3;
  const dotX = gutterW - 14;

  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    const sev = lineSeverity.get(dr.bufferLine);
    if (sev === undefined) continue;
    // Only draw on the first display row of each buffer line
    if (r > firstVisRow && displayRows[r - 1]?.bufferLine === dr.bufferLine) continue;

    const y = (r - firstVisRow) * lineHeight + offsetY + lineHeight / 2;
    ctx.fillStyle = sev === 1 ? "#f38ba8" : sev === 2 ? "#fab387" : "#89b4fa";
    ctx.beginPath();
    ctx.arc(dotX, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- Diagnostics ---

function drawDiagnostics(
  ctx: CanvasRenderingContext2D,
  diagnostics: EditorRenderParams["diagnostics"],
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  gutterW: number,
  charW: number
) {
  if (!diagnostics || diagnostics.length === 0) return;

  for (const diag of diagnostics) {
    for (let r = firstVisRow; r < lastVisRow; r++) {
      const dr = displayRows[r];
      if (dr.bufferLine >= diag.line && dr.bufferLine <= diag.endLine) {
        const startC = dr.bufferLine === diag.line ? Math.max(0, diag.col - dr.startCol) : 0;
        const endC = dr.bufferLine === diag.endLine ? Math.min(dr.text.length, diag.endCol - dr.startCol) : dr.text.length;
        if (endC > startC) {
          const x1 = gutterW + PADDING_LEFT + colToPixel(dr.text, startC, charW);
          const x2 = gutterW + PADDING_LEFT + colToPixel(dr.text, endC, charW);
          const y = (r - firstVisRow + 1) * lineHeight + offsetY - 2;
          // Wavy underline
          ctx.strokeStyle = diag.severity === 1 ? "#f38ba8" : diag.severity === 2 ? "#fab387" : "#89b4fa";
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let wx = x1; wx < x2; wx += 4) {
            const wy = y + (Math.floor((wx - x1) / 4) % 2 === 0 ? 0 : 2);
            if (wx === x1) ctx.moveTo(wx, wy);
            else ctx.lineTo(wx, wy);
          }
          ctx.stroke();
        }
      }
    }
  }
}

// --- Hover Tooltip ---

function drawHoverTooltip(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  fontSize: number,
  gutterW: number,
  charW: number,
  w: number
) {
  if (!params.hoverText || !params.hoverPos) return;

  const hp = params.hoverPos;
  const text = params.hoverText;
  const tooltipLines = text.split("\n").slice(0, 8);
  const maxDisplayW = Math.max(...tooltipLines.map(l => stringDisplayWidth(l)));
  const tipW = Math.min(Math.max(maxDisplayW * charW * 0.65 + 24, 120), w - 40);
  const tipH = tooltipLines.length * (fontSize + 4) + 12;

  let tipX = gutterW + PADDING_LEFT;
  let tipY = 0;
  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.bufferLine === hp.line) {
      tipX = gutterW + PADDING_LEFT + colToPixel(dr.text, hp.col - dr.startCol, charW);
      tipY = (r - firstVisRow) * lineHeight + offsetY - tipH - 4;
      break;
    }
  }
  if (tipY < 0) tipY += tipH + lineHeight + 8;
  if (tipX + tipW > w) tipX = w - tipW - 8;

  ctx.fillStyle = "#181825";
  ctx.fillRect(tipX, tipY, tipW, tipH);
  ctx.strokeStyle = "#45475a";
  ctx.lineWidth = 1;
  ctx.strokeRect(tipX, tipY, tipW, tipH);

  const tipFont = `${fontSize - 1}px JetBrains Mono, monospace`;
  const tipCharW = getCharWidth(fontSize - 1);
  const tipLineH = fontSize + 4;
  const tipBaselineY = Math.round(tipLineH * 0.7);
  for (let i = 0; i < tooltipLines.length; i++) {
    monoText(ctx, tooltipLines[i], tipX + 8, tipY + 10 + i * tipLineH, "#cdd6f4", tipFont, tipCharW, tipLineH, tipBaselineY);
  }
}

// --- Signature Help ---

function drawSignatureHelp(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  fontSize: number,
  gutterW: number,
  charW: number,
  font: string,
  w: number
) {
  const sig = params.signatureHelp;
  if (!sig) return;

  const cLine = params.cursors[0]?.line ?? 0;
  const cCol = params.cursors[0]?.col ?? 0;

  // Position above the cursor
  let tipX = gutterW + PADDING_LEFT;
  let tipY = 0;
  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.bufferLine === cLine) {
      tipX = gutterW + PADDING_LEFT + colToPixel(dr.text, cCol - dr.startCol, charW);
      tipY = (r - firstVisRow) * lineHeight + offsetY - lineHeight - 8;
      break;
    }
  }

  // Measure width via Pretext
  const sigW = Math.min(Math.max(measureTextWidth(sig.label, font) + 24, 200), w - 40);
  const sigH = lineHeight + 8;

  if (tipX + sigW > w) tipX = w - sigW - 8;
  if (tipX < gutterW + 4) tipX = gutterW + 4;
  if (tipY < 0) tipY += sigH + lineHeight + 16;

  // Background
  ctx.fillStyle = "#181825";
  ctx.fillRect(tipX, tipY, sigW, sigH);
  ctx.strokeStyle = "#45475a";
  ctx.lineWidth = 1;
  ctx.strokeRect(tipX, tipY, sigW, sigH);

  // Render signature label with active parameter bolded
  const sigBaselineY = sigH - Math.floor(fontSize * 0.35) - 4;

  if (sig.parameters.length > 0 && sig.active_parameter < sig.parameters.length) {
    const activeParam = sig.parameters[sig.active_parameter].label;
    const idx = sig.label.indexOf(activeParam);
    if (idx >= 0) {
      const before = sig.label.slice(0, idx);
      const after = sig.label.slice(idx + activeParam.length);

      monoText(ctx, before, tipX + 8, tipY, "#a6adc8", font, charW, sigH, sigBaselineY);
      const beforeW = stringDisplayWidth(before) * charW;

      // Active param (bold, accent color)
      const boldFont = `bold ${fontSize}px JetBrains Mono, monospace`;
      monoText(ctx, activeParam, tipX + 8 + beforeW, tipY, "#f9e2af", boldFont, charW, sigH, sigBaselineY);
      const paramW = stringDisplayWidth(activeParam) * charW;

      monoText(ctx, after, tipX + 8 + beforeW + paramW, tipY, "#a6adc8", font, charW, sigH, sigBaselineY);
      return;
    }
  }

  // Fallback: plain label
  monoText(ctx, sig.label, tipX + 8, tipY, "#cdd6f4", font, charW, sigH, sigBaselineY);
}

// --- Code Action Light Bulb ---

function drawCodeActionLightBulb(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  gutterW: number
) {
  if (params.codeActionLine === null || params.codeActionItems.length === 0) return;

  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.bufferLine === params.codeActionLine && dr.startCol === 0) {
      const y = (r - firstVisRow) * lineHeight + offsetY + lineHeight / 2;
      const x = gutterW - 24;
      // Yellow circle with "!"
      ctx.fillStyle = "#f9e2af";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      monoText(ctx, "!", x - 3, y - 5, "#1e1e2e", "bold 8px JetBrains Mono, monospace", 6, 10, 8);
      break;
    }
  }
}

// --- Code Action Menu ---

function drawCodeActionMenu(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  fontSize: number,
  gutterW: number,
  charW: number,
  font: string,
  w: number,
  h: number
) {
  if (!params.codeActionMenuVisible || params.codeActionItems.length === 0) return;

  const cLine = params.cursors[0]?.line ?? 0;
  const cCol = params.cursors[0]?.col ?? 0;
  const items = params.codeActionItems;
  const itemH = lineHeight;
  const maxVisible = Math.min(items.length, 10);
  const dropW = Math.min(400, w - gutterW - 40);
  const dropH = maxVisible * itemH + 4;

  let dropX = gutterW + PADDING_LEFT;
  let dropY = 0;
  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.bufferLine === cLine) {
      dropX = gutterW + PADDING_LEFT + colToPixel(dr.text, cCol - dr.startCol, charW);
      dropY = (r - firstVisRow + 1) * lineHeight + offsetY;
      break;
    }
  }

  if (dropX + dropW > w) dropX = w - dropW - 8;
  if (dropX < gutterW + 4) dropX = gutterW + 4;
  if (dropY + dropH > h) dropY = dropY - dropH - lineHeight;

  ctx.fillStyle = "#181825";
  ctx.fillRect(dropX, dropY, dropW, dropH);
  ctx.strokeStyle = "#45475a";
  ctx.lineWidth = 1;
  ctx.strokeRect(dropX, dropY, dropW, dropH);

  const selIdx = params.codeActionIdx;
  const caBaselineY = itemH - Math.floor(fontSize * 0.35);
  for (let i = 0; i < maxVisible; i++) {
    const item = items[i];
    const iy = dropY + 2 + i * itemH;

    if (i === selIdx) {
      ctx.fillStyle = "#313244";
      ctx.fillRect(dropX + 1, iy, dropW - 2, itemH);
    }

    const titleColor = i === selIdx ? "#cdd6f4" : "#a6adc8";
    monoText(ctx, item.title, dropX + 8, iy, titleColor, font, charW, itemH, caBaselineY);

    if (item.kind) {
      const kindX = dropX + dropW - 8 - stringDisplayWidth(item.kind) * charW;
      monoText(ctx, item.kind, kindX, iy, "#585b70", font, charW, itemH, caBaselineY);
    }
  }
}

// --- Fold markers ---

function drawFoldMarkers(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  _charW: number,
) {
  let lastLine = -1;
  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.bufferLine === lastLine) continue;
    lastLine = dr.bufferLine;
    const y = (r - firstVisRow) * lineHeight + offsetY;
    const isFolded = params.foldStartLines.has(dr.bufferLine);
    const canFold = isFolded || params.isFoldable(dr.bufferLine);

    if (canFold) {
      const cx = 10;
      const cy = y + lineHeight / 2;
      const sz = 4;

      ctx.fillStyle = params.palette.textMuted;
      ctx.beginPath();
      if (isFolded) {
        // Right-pointing triangle (collapsed)
        ctx.moveTo(cx, cy - sz);
        ctx.lineTo(cx + sz, cy);
        ctx.lineTo(cx, cy + sz);
      } else {
        // Down-pointing triangle (expanded)
        ctx.moveTo(cx - sz, cy - sz / 2);
        ctx.lineTo(cx + sz, cy - sz / 2);
        ctx.lineTo(cx, cy + sz);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}

// --- Minimap + Scrollbar Indicator ---

const MINIMAP_W = 64;
const MINIMAP_LINE_H = 2;
const MINIMAP_PAD = 4;
const SCROLLBAR_W = 8;

function drawMinimap(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  lineHeight: number,
  w: number,
  h: number,
  _gutterW: number,
  charW: number,
) {
  const totalRows = displayRows.length;
  if (totalRows === 0) return;

  const p = params.palette;
  const mapX = w - MINIMAP_W - SCROLLBAR_W - MINIMAP_PAD;
  const mapW = MINIMAP_W;
  const mapH = h;
  const scrollBarX = w - SCROLLBAR_W;

  // Scale: fit all rows into the minimap height, but cap line height at MINIMAP_LINE_H
  const scaledH = totalRows * MINIMAP_LINE_H;
  const scale = scaledH <= mapH ? 1 : mapH / scaledH;
  const rowH = MINIMAP_LINE_H * scale;

  // ── Minimap background ──
  ctx.fillStyle = p.gutterBg;
  ctx.globalAlpha = 0.6;
  ctx.fillRect(mapX, 0, mapW + SCROLLBAR_W + MINIMAP_PAD, h);
  ctx.globalAlpha = 1;

  // ── Viewport indicator on minimap ──
  const visRows = Math.ceil(h / lineHeight);
  const firstVisRow = Math.floor(params.scrollTop / lineHeight);
  const vpY = firstVisRow * rowH;
  const vpH = Math.max(8, visRows * rowH);
  ctx.fillStyle = p.selection || "rgba(205, 214, 244, 0.1)";
  ctx.fillRect(mapX, vpY, mapW, vpH);

  // ── Draw minimap lines (simplified colored strips) ──
  const lineTokens = params.lineTokens;
  const miniCharW = mapW / 80; // assume 80-char viewport for minimap scaling

  for (let r = 0; r < totalRows; r++) {
    const y = r * rowH;
    if (y > mapH) break;
    const dr = displayRows[r];
    const text = dr.text;
    if (text.length === 0) continue;

    // Get tokens for this line if available
    const tokens = lineTokens[dr.bufferLine];
    if (tokens && tokens.length > 0) {
      // Render colored segments from syntax tokens
      for (const token of tokens) {
        const startCol = Math.max(0, token.startCol - dr.startCol);
        const endCol = Math.min(text.length, token.endCol - dr.startCol);
        if (endCol <= startCol) continue;
        const tx = mapX + startCol * miniCharW;
        const tw = (endCol - startCol) * miniCharW;
        ctx.fillStyle = p.syntax[token.type] || p.text;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(tx, y, Math.max(1, tw), Math.max(1, rowH));
      }
    } else {
      // No tokens — draw as dim text color
      const tw = Math.min(text.length, 80) * miniCharW;
      ctx.fillStyle = p.textMuted;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(mapX, y, Math.max(1, tw), Math.max(1, rowH));
    }
    ctx.globalAlpha = 1;
  }

  // ── Scrollbar track ──
  ctx.fillStyle = p.surface0 || "#313244";
  ctx.globalAlpha = 0.3;
  ctx.fillRect(scrollBarX, 0, SCROLLBAR_W, h);
  ctx.globalAlpha = 1;

  // ── Scrollbar thumb ──
  const totalH = totalRows * lineHeight;
  const thumbRatio = h / totalH;
  const thumbH = Math.max(20, h * thumbRatio);
  const thumbY = (params.scrollTop / totalH) * (h - thumbH);
  ctx.fillStyle = p.textMuted;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(scrollBarX + 1, thumbY, SCROLLBAR_W - 2, thumbH);
  ctx.globalAlpha = 1;

  // ── Diagnostic markers on scrollbar ──
  if (params.diagnostics.length > 0) {
    for (const d of params.diagnostics) {
      const diagRow = d.line / Math.max(1, params.lines.length);
      const markerY = diagRow * h;
      ctx.fillStyle = d.severity === 1 ? "#f38ba8" : d.severity === 2 ? "#fab387" : "#89b4fa";
      ctx.fillRect(scrollBarX, markerY, SCROLLBAR_W, 2);
    }
  }

  // ── Search match markers on scrollbar ──
  if (params.searchMatches.length > 0) {
    ctx.fillStyle = p.searchHighlight || "#f9e2af";
    for (const m of params.searchMatches) {
      const matchRow = m.line / Math.max(1, params.lines.length);
      const markerY = matchRow * h;
      ctx.fillRect(scrollBarX, markerY, SCROLLBAR_W, 2);
    }
  }

  // ── Cursor position marker on scrollbar ──
  if (params.cursors.length > 0) {
    const cursorRow = params.cursors[0].line / Math.max(1, params.lines.length);
    const cursorY = cursorRow * h;
    ctx.fillStyle = p.text;
    ctx.fillRect(scrollBarX, cursorY, SCROLLBAR_W, 2);
  }
}
