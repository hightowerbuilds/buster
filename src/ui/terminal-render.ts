/**
 * Terminal render paths (WebGL and Canvas 2D fallback).
 * Extracted from CanvasTerminal.tsx.
 */

import { FONT_FAMILY, measureTextWidth } from "../editor/text-measure";
import type { TerminalGLContext, FontVariant } from "./terminal-webgl";
import type { TermCell, TerminalCursorStyle } from "./terminal-binary";
import type { ThemePalette } from "../lib/theme";

export interface TermRenderState {
  cells: TermCell[][];
  cursorRow: number;
  cursorCol: number;
  cursorStyle: TerminalCursorStyle;
  charWidth: number;
  charHeight: number;
  termRows: number;
  termCols: number;
  isFocused: boolean;
  scrollOffset: number;
  searchVisible: boolean;
  searchMatches: { row: number; col: number; len: number }[];
  searchMatchIdx: number;
  bellFlashUntil: number;
  sixelImages: { width: number; height: number; pixels: number[]; row: number; col: number }[];
  sixelBitmapCache: Map<string, ImageData>;
}

export interface TermRenderDeps {
  state: TermRenderState;
  palette: () => ThemePalette;
  fontSize: () => number;
  getVisibleRows: () => (TermCell[] | undefined)[];
  normalizedSelection: () => { start: { row: number; col: number }; end: { row: number; col: number } } | null;
  scrollback: () => TermCell[][];
  scheduleTermRender: () => void;
  sixelOverlay: HTMLCanvasElement | null;
  containerRef: HTMLDivElement | undefined;
  setSixelOverlay: (el: HTMLCanvasElement | null) => void;
}

const MAX_SIXEL_CACHE = 64;

function cursorRect(
  style: TerminalCursorStyle,
  cx: number,
  cy: number,
  cursorW: number,
  ch: number,
): { x: number; y: number; w: number; h: number } {
  if (style === "bar") return { x: cx, y: cy, w: 2, h: ch };
  if (style === "underline") return { x: cx, y: cy + ch - 2, w: cursorW, h: 2 };
  return { x: cx, y: cy, w: cursorW, h: ch };
}

export function renderWebGL(w: number, h: number, gpu: TerminalGLContext, deps: TermRenderDeps) {
  const { state } = deps;
  const p = deps.palette();
  const fs = deps.fontSize();
  const cw = state.charWidth;
  const ch = state.charHeight;

  gpu.beginFrame(w, h, p.editorBg, fs, FONT_FAMILY);

  if (state.cells.length === 0) return;
  const visibleRows = deps.getVisibleRows();

  // Pass 1: cell backgrounds
  for (let row = 0; row < visibleRows.length; row++) {
    const rowCells = visibleRows[row];
    if (!rowCells) continue;
    for (let col = 0; col < rowCells.length; col++) {
      const cell = rowCells[col];
      if (cell.width === 0) continue;
      const isDefaultBg = cell.bg[0] === 30 && cell.bg[1] === 30 && cell.bg[2] === 46;
      if (isDefaultBg) continue;
      const x = Math.round(col * cw);
      const y = Math.round(row * ch);
      const cellW = cell.width === 2 ? cw * 2 : cw;
      gpu.addBg(x, y, cellW + 1, ch, cell.bg[0], cell.bg[1], cell.bg[2]);
    }
  }
  gpu.flushQuads();

  // Pass 2: selection highlight
  const sel = deps.normalizedSelection();
  if (sel) {
    for (let row = sel.start.row; row <= Math.min(sel.end.row, visibleRows.length - 1); row++) {
      const cs = row === sel.start.row ? sel.start.col : 0;
      const ce = row === sel.end.row ? sel.end.col : (visibleRows[row]?.length ?? state.termCols) - 1;
      gpu.addOverlayCss(cs * cw, row * ch, (ce - cs + 1) * cw, ch, p.selection);
    }
  }

  // Search match highlights
  if (state.searchVisible && state.searchMatches.length > 0) {
    const sb = deps.scrollback();
    const totalRows = sb.length + (state.cells.length || state.termRows);
    const visibleCount = state.cells.length || state.termRows;
    const viewStart = totalRows - visibleCount - state.scrollOffset;
    for (let mi = 0; mi < state.searchMatches.length; mi++) {
      const m = state.searchMatches[mi];
      const displayRow = m.row - viewStart;
      if (displayRow < 0 || displayRow >= visibleCount) continue;
      if (mi === state.searchMatchIdx) {
        gpu.addOverlay(m.col * cw, displayRow * ch, m.len * cw, ch, 250 / 255, 179 / 255, 135 / 255, 0.4);
      } else {
        gpu.addOverlay(m.col * cw, displayRow * ch, m.len * cw, ch, 137 / 255, 180 / 255, 250 / 255, 0.25);
      }
    }
  }
  gpu.flushQuads();

  // Pass 3: text glyphs
  for (let row = 0; row < visibleRows.length; row++) {
    const rowCells = visibleRows[row];
    if (!rowCells) continue;
    for (let col = 0; col < rowCells.length; col++) {
      const cell = rowCells[col];
      if (cell.width === 0) continue;
      if (cell.ch === " " || cell.ch === "") continue;
      const x = Math.round(col * cw);
      const y = Math.round(row * ch);
      const variant: FontVariant = ((cell.bold ? 1 : 0) | (cell.italic ? 2 : 0)) as FontVariant;
      const alpha = cell.faint ? 0.5 : 1.0;
      gpu.addChar(cell.ch, variant, x, y, cell.fg[0], cell.fg[1], cell.fg[2], alpha);
    }
  }
  gpu.flushText();

  // Pass 4: decorations
  for (let row = 0; row < visibleRows.length; row++) {
    const rowCells = visibleRows[row];
    if (!rowCells) continue;
    for (let col = 0; col < rowCells.length; col++) {
      const cell = rowCells[col];
      if (cell.width === 0) continue;
      if (!cell.underline && !cell.strikethrough) continue;
      const x = Math.round(col * cw);
      const y = Math.round(row * ch);
      const cellW = cell.width === 2 ? cw * 2 : cw;
      const alpha = cell.faint ? 0.5 : 1.0;
      if (cell.underline) {
        gpu.addOverlay(x, y + ch - 1, cellW, 1, cell.fg[0] / 255, cell.fg[1] / 255, cell.fg[2] / 255, alpha);
      }
      if (cell.strikethrough) {
        gpu.addOverlay(x, Math.round(y + ch / 2), cellW, 1, cell.fg[0] / 255, cell.fg[1] / 255, cell.fg[2] / 255, alpha);
      }
    }
  }
  gpu.flushQuads();

  // Pass 5: cursor
  if (state.isFocused && state.scrollOffset === 0) {
    const cx = Math.round(state.cursorCol * cw);
    const cy = Math.round(state.cursorRow * ch);
    const cursorCell = state.cells[state.cursorRow]?.[state.cursorCol];
    const cursorW = cursorCell?.width === 2 ? cw * 2 : cw;
    const r = cursorRect(state.cursorStyle, cx, cy, cursorW, ch);
    gpu.addOverlayCss(r.x, r.y, r.w, r.h, p.cursor);
    gpu.flushQuads();
    if (state.cursorStyle === "block" && cursorCell && cursorCell.ch !== " " && cursorCell.ch !== "") {
      gpu.addCharHex(cursorCell.ch, 0, cx, cy, p.editorBg);
      gpu.flushText();
    }
  }

  // Pass 6: scroll indicator
  if (state.scrollOffset > 0) {
    const label = `\u2191 ${state.scrollOffset} lines`;
    const tw = label.length * cw;
    gpu.addOverlayCss(w - tw - 16, 4, tw + 12, fs + 4, p.surface1);
    gpu.flushQuads();
    for (let i = 0; i < label.length; i++) {
      gpu.addCharHex(label[i], 0, w - tw - 10 + i * cw, 6, p.text);
    }
    gpu.flushText();
  }

  // Pass 7: bell flash
  if (state.bellFlashUntil > 0) {
    const remaining = state.bellFlashUntil - performance.now();
    if (remaining > 0) {
      gpu.addOverlay(0, 0, w, h, 205 / 255, 214 / 255, 244 / 255, 0.08);
      gpu.flushQuads();
      state.bellFlashUntil = state.bellFlashUntil; // keep alive
      deps.scheduleTermRender();
    } else {
      state.bellFlashUntil = 0;
    }
  }

  renderSixelOverlay(w, h, deps);
}

export function renderSixelOverlay(w: number, h: number, deps: TermRenderDeps) {
  const { state } = deps;
  if (state.sixelImages.length === 0) {
    if (deps.sixelOverlay) deps.sixelOverlay.style.display = "none";
    return;
  }
  if (!deps.sixelOverlay && deps.containerRef) {
    const overlay = document.createElement("canvas");
    overlay.style.position = "absolute";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.pointerEvents = "none";
    deps.containerRef.appendChild(overlay);
    deps.setSixelOverlay(overlay);
  }
  const sixelOverlay = deps.sixelOverlay;
  if (!sixelOverlay) return;
  sixelOverlay.style.display = "block";

  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.round(w * dpr);
  const targetH = Math.round(h * dpr);
  if (sixelOverlay.width !== targetW || sixelOverlay.height !== targetH) {
    sixelOverlay.width = targetW;
    sixelOverlay.height = targetH;
  }
  const ctx = sixelOverlay.getContext("2d", { alpha: true })!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const cw = state.charWidth;
  const ch = state.charHeight;
  for (const img of state.sixelImages) {
    if (img.width === 0 || img.height === 0) continue;
    const cacheKey = `${img.row},${img.col},${img.width},${img.height}`;
    let imgData = state.sixelBitmapCache.get(cacheKey);
    if (!imgData) {
      imgData = new ImageData(img.width, img.height);
      const src = img.pixels;
      const dst = imgData.data;
      const len = Math.min(src.length, dst.length);
      for (let i = 0; i < len; i++) dst[i] = src[i];
      state.sixelBitmapCache.set(cacheKey, imgData);
      if (state.sixelBitmapCache.size > MAX_SIXEL_CACHE) {
        const first = state.sixelBitmapCache.keys().next().value!;
        state.sixelBitmapCache.delete(first);
      }
    }
    ctx.putImageData(imgData, img.col * cw, img.row * ch);
  }
}

export function renderCanvas2D(w: number, h: number, canvas: HTMLCanvasElement, deps: TermRenderDeps) {
  const { state } = deps;
  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.round(w * dpr);
  const targetH = Math.round(h * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const p = deps.palette();
  ctx.fillStyle = p.editorBg;
  ctx.fillRect(0, 0, w, h);

  if (state.cells.length === 0) return;

  const cw = state.charWidth;
  const ch = state.charHeight;
  const fs = deps.fontSize();
  const visibleRows = deps.getVisibleRows();

  // Cell backgrounds
  for (let row = 0; row < visibleRows.length; row++) {
    const rowCells = visibleRows[row];
    if (!rowCells) continue;
    for (let col = 0; col < rowCells.length; col++) {
      const cell = rowCells[col];
      if (cell.width === 0) continue;
      const isDefaultBg = cell.bg[0] === 30 && cell.bg[1] === 30 && cell.bg[2] === 46;
      if (!isDefaultBg) {
        ctx.fillStyle = `rgb(${cell.bg[0]}, ${cell.bg[1]}, ${cell.bg[2]})`;
        ctx.fillRect(Math.round(col * cw), Math.round(row * ch), (cell.width === 2 ? cw * 2 : cw) + 1, ch);
      }
    }
  }

  // Selection
  const sel = deps.normalizedSelection();
  if (sel) {
    ctx.fillStyle = p.selection;
    for (let row = sel.start.row; row <= Math.min(sel.end.row, visibleRows.length - 1); row++) {
      const cs = row === sel.start.row ? sel.start.col : 0;
      const ce = row === sel.end.row ? sel.end.col : (visibleRows[row]?.length ?? state.termCols) - 1;
      ctx.fillRect(cs * cw, row * ch, (ce - cs + 1) * cw, ch);
    }
  }

  // Search highlights
  if (state.searchVisible && state.searchMatches.length > 0) {
    const sb = deps.scrollback();
    const totalRows = sb.length + (state.cells.length || state.termRows);
    const visibleCount = state.cells.length || state.termRows;
    const viewStart = totalRows - visibleCount - state.scrollOffset;
    for (let mi = 0; mi < state.searchMatches.length; mi++) {
      const m = state.searchMatches[mi];
      const displayRow = m.row - viewStart;
      if (displayRow < 0 || displayRow >= visibleCount) continue;
      ctx.fillStyle = mi === state.searchMatchIdx ? "rgba(250, 179, 135, 0.4)" : "rgba(137, 180, 250, 0.25)";
      ctx.fillRect(m.col * cw, displayRow * ch, m.len * cw, ch);
    }
  }

  // Text
  const baseFont = `${fs}px ${FONT_FAMILY}`;
  ctx.textBaseline = "top";
  for (let row = 0; row < visibleRows.length; row++) {
    const rowCells = visibleRows[row];
    if (!rowCells) continue;
    for (let col = 0; col < rowCells.length; col++) {
      const cell = rowCells[col];
      if (cell.width === 0 || cell.ch === " " || cell.ch === "") continue;
      const x = Math.round(col * cw);
      const y = Math.round(row * ch);
      const cellW = cell.width === 2 ? cw * 2 : cw;
      const weight = cell.bold ? "bold " : "";
      const style = cell.italic ? "italic " : "";
      const cellFont = (weight || style) ? `${style}${weight}${fs}px ${FONT_FAMILY}` : baseFont;
      const fgColor = cell.faint
        ? `rgba(${cell.fg[0]}, ${cell.fg[1]}, ${cell.fg[2]}, 0.5)`
        : `rgb(${cell.fg[0]}, ${cell.fg[1]}, ${cell.fg[2]})`;
      ctx.font = cellFont;
      ctx.fillStyle = fgColor;
      ctx.fillText(cell.ch, x, y);
      if (cell.underline) {
        ctx.strokeStyle = fgColor; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y + ch - 1); ctx.lineTo(x + cellW, y + ch - 1); ctx.stroke();
      }
      if (cell.strikethrough) {
        ctx.strokeStyle = fgColor; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, Math.round(y + ch / 2)); ctx.lineTo(x + cellW, Math.round(y + ch / 2)); ctx.stroke();
      }
    }
  }

  // Cursor
  if (state.isFocused && state.scrollOffset === 0) {
    const cx = Math.round(state.cursorCol * cw);
    const cy = Math.round(state.cursorRow * ch);
    const cursorCell = state.cells[state.cursorRow]?.[state.cursorCol];
    const cursorW = cursorCell?.width === 2 ? cw * 2 : cw;
    const r = cursorRect(state.cursorStyle, cx, cy, cursorW, ch);
    ctx.fillStyle = p.cursor;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    if (state.cursorStyle === "block" && cursorCell && cursorCell.ch !== " " && cursorCell.ch !== "") {
      ctx.font = baseFont;
      ctx.fillStyle = p.editorBg;
      ctx.fillText(cursorCell.ch, cx, cy);
    }
  }

  // Sixel images
  for (const img of state.sixelImages) {
    if (img.width === 0 || img.height === 0) continue;
    const cacheKey = `${img.row},${img.col},${img.width},${img.height}`;
    let imgData = state.sixelBitmapCache.get(cacheKey);
    if (!imgData) {
      imgData = new ImageData(img.width, img.height);
      const src = img.pixels;
      const dst = imgData.data;
      const len = Math.min(src.length, dst.length);
      for (let i = 0; i < len; i++) dst[i] = src[i];
      state.sixelBitmapCache.set(cacheKey, imgData);
      if (state.sixelBitmapCache.size > MAX_SIXEL_CACHE) {
        const first = state.sixelBitmapCache.keys().next().value!;
        state.sixelBitmapCache.delete(first);
      }
    }
    ctx.putImageData(imgData, img.col * cw, img.row * ch);
  }

  // Scroll indicator
  if (state.scrollOffset > 0) {
    const label = `\u2191 ${state.scrollOffset} lines`;
    const smallFont = `${fs - 2}px ${FONT_FAMILY}`;
    ctx.font = smallFont;
    const tw = measureTextWidth(label, smallFont);
    ctx.fillStyle = p.surface1;
    ctx.fillRect(w - tw - 16, 4, tw + 12, fs + 4);
    ctx.fillStyle = p.text;
    ctx.fillText(label, w - tw - 10, 6);
  }

  // Bell flash
  if (state.bellFlashUntil > 0) {
    const remaining = state.bellFlashUntil - performance.now();
    if (remaining > 0) {
      ctx.fillStyle = "rgba(205, 214, 244, 0.08)";
      ctx.fillRect(0, 0, w, h);
      deps.scheduleTermRender();
    } else {
      state.bellFlashUntil = 0;
    }
  }
}
