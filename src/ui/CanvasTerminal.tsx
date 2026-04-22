import { Component, createEffect, on, onMount, onCleanup, createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import CanvasSurface from "./CanvasSurface";
import { useBuster } from "../lib/buster-context";
import { FONT_FAMILY, getCharWidth, measureTextWidth } from "../editor/text-measure";
import { showToast } from "./CanvasToasts";
import { showError } from "../lib/notify";
import ContextMenu, { type ContextMenuState } from "./ContextMenu";
import { TerminalGLContext, type FontVariant } from "./terminal-webgl";

interface TermCell {
  ch: string;
  fg: [number, number, number];
  bg: [number, number, number];
  bold: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strikethrough: boolean;
  faint: boolean;
  /** 0 = wide-char continuation (skip), 1 = normal, 2 = double-width */
  width: number;
}

/** A decoded sixel image received from the Rust backend. */
interface SixelImageData {
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /** RGBA pixel data (width * height * 4 bytes), base64-encoded. */
  pixels: number[];
  /** Terminal row where the image starts. */
  row: number;
  /** Terminal column where the image starts. */
  col: number;
}

interface ChangedRow {
  index: number;
  cells: TermCell[];
}

interface TermScreenDelta {
  rows: number;
  cols: number;
  cursor_row: number;
  cursor_col: number;
  changed_rows: ChangedRow[];
  full: boolean;
  mouse_mode?: string;
  mouse_encoding?: string;
  bracketed_paste?: boolean;
  title?: string;
  bell?: boolean;
  alt_screen?: boolean;
}

interface CanvasTerminalProps {
  termTabId: string;
  active: boolean;
  cwd?: string;
  onTermIdReady: (termTabId: string, ptyId: string) => void;
  onTitleChange?: (termTabId: string, title: string) => void;
  autoFocus?: boolean;
}

import { createTerminalA11y } from "./terminal-a11y";
// Cursor is always visible when focused — no blink

const CanvasTerminal: Component<CanvasTerminalProps> = (props) => {
  const { store } = useBuster();
  const settings = () => store.settings;
  const palette = () => store.palette;
  const tabTrapping = () => store.tabTrapping;
  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let hiddenInput: HTMLTextAreaElement | undefined;
  let animId: number;
  let isFocused = false;
  let ptyId: string | null = null;
  let unlisten: (() => void) | null = null;
  let resizeObs: ResizeObserver | null = null;

  let cells: TermCell[][] = [];
  let cursorRow = 0;
  let cursorCol = 0;
  let charWidth = 0;
  let charHeight = 0;
  let termRows = 24;
  let termCols = 80;
  let needsRedraw = true;
  let selStart: { row: number; col: number } | null = null;
  let selEnd: { row: number; col: number } | null = null;
  let isSelecting = false;
  let scrollbackNormal: TermCell[][] = [];
  let scrollbackAlt: TermCell[][] = [];
  let inAltScreen = false;
  let scrollOffset = 0;
  let isComposingInput = false;
  const MAX_SCROLLBACK = 10_000;
  const MAX_SIXEL_CACHE = 64;
  let mouseMode = "none";
  let mouseEncoding = "default";
  let bracketedPaste = false;
  let sixelImages: SixelImageData[] = [];
  let sixelBitmapCache: Map<string, ImageData> = new Map();
  let bellFlashUntil = 0;
  let searchVisible = false;
  let searchQuery = "";
  let searchUseRegex = false;
  let searchCaseSensitive = false;
  let searchMatches: { row: number; col: number; len: number }[] = [];
  let searchMatchIdx = -1;

  // WebGL renderer (null = Canvas 2D fallback)
  let gpuCtx: TerminalGLContext | null = null;
  let sixelOverlay: HTMLCanvasElement | null = null;

  const termA11y = createTerminalA11y();

  function fontSize() { return settings().font_size; }

  function measureChar() {
    charWidth = getCharWidth(fontSize());
    charHeight = fontSize() + 4;
  }

  function computeGridSize(): { rows: number; cols: number } {
    if (!containerRef) return { rows: 24, cols: 80 };
    const w = containerRef.clientWidth;
    const h = containerRef.clientHeight;
    if (charWidth === 0) measureChar();
    const cols = Math.max(10, Math.floor(w / charWidth));
    const rows = Math.max(5, Math.floor(h / charHeight));
    return { rows, cols };
  }

  function mouseToCell(e: MouseEvent): { row: number; col: number } {
    if (!containerRef) return { row: 0, col: 0 };
    const rect = containerRef.getBoundingClientRect();
    return {
      row: Math.max(0, Math.min((cells.length || termRows) - 1, Math.floor((e.clientY - rect.top) / charHeight))),
      col: Math.max(0, Math.floor((e.clientX - rect.left) / charWidth)),
    };
  }

  function normalizedSelection() {
    if (!selStart || !selEnd) return null;
    let s = selStart, e = selEnd;
    if (s.row > e.row || (s.row === e.row && s.col > e.col)) {
      [s, e] = [e, s];
    }
    return { start: s, end: e };
  }

  function getSelectedText(): string {
    const sel = normalizedSelection();
    if (!sel) return "";
    const rows = scrollOffset === 0 ? cells : getVisibleRows();
    let text = "";
    for (let row = sel.start.row; row <= sel.end.row; row++) {
      const rowCells = rows[row];
      if (!rowCells) continue;
      const cs = row === sel.start.row ? sel.start.col : 0;
      const ce = row === sel.end.row ? sel.end.col : rowCells.length - 1;
      for (let col = cs; col <= ce; col++) {
        text += rowCells[col]?.ch || " ";
      }
      if (row < sel.end.row) text += "\n";
    }
    return text.replace(/\s+$/gm, "");
  }

  function rowTextMatch(a: TermCell[] | undefined, b: TermCell[] | undefined): boolean {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].ch !== b[i].ch) return false;
    }
    return true;
  }

  function scrollback(): TermCell[][] {
    return inAltScreen ? scrollbackAlt : scrollbackNormal;
  }

  function getVisibleRows(): (TermCell[] | undefined)[] {
    if (scrollOffset === 0) return cells;
    const sb = scrollback();
    const combined = [...sb, ...cells];
    const visibleCount = cells.length || termRows;
    const start = Math.max(0, combined.length - visibleCount - scrollOffset);
    return combined.slice(start, start + visibleCount);
  }

  function runTermSearch(query: string) {
    searchMatches = [];
    if (!query) { needsRedraw = true; scheduleTermRender(); return; }

    let regex: RegExp | null = null;
    if (searchUseRegex) {
      try {
        regex = new RegExp(query, searchCaseSensitive ? "g" : "gi");
      } catch {
        // Invalid regex — show no matches
        needsRedraw = true; scheduleTermRender(); return;
      }
    }

    const allRows = [...scrollback(), ...cells];
    for (let r = 0; r < allRows.length; r++) {
      const row = allRows[r];
      if (!row) continue;
      const rawText = row.map(c => c.ch).join("");

      if (regex) {
        regex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(rawText)) !== null) {
          if (m[0].length === 0) { regex.lastIndex++; continue; }
          searchMatches.push({ row: r, col: m.index, len: m[0].length });
        }
      } else {
        const text = searchCaseSensitive ? rawText : rawText.toLowerCase();
        const q = searchCaseSensitive ? query : query.toLowerCase();
        let idx = 0;
        while ((idx = text.indexOf(q, idx)) !== -1) {
          searchMatches.push({ row: r, col: idx, len: q.length });
          idx += q.length;
        }
      }
    }
    searchMatchIdx = searchMatches.length > 0 ? searchMatches.length - 1 : -1;
    // Scroll to the current match
    if (searchMatchIdx >= 0) {
      const match = searchMatches[searchMatchIdx];
      const sb = scrollback();
      const totalRows = sb.length + (cells.length || termRows);
      const visibleCount = cells.length || termRows;
      const matchAbsolute = match.row;
      const liveStart = totalRows - visibleCount;
      if (matchAbsolute < liveStart) {
        scrollOffset = liveStart - matchAbsolute;
      }
    }
    needsRedraw = true; scheduleTermRender();
  }

  function jumpToSearchMatch(dir: 1 | -1) {
    if (searchMatches.length === 0) return;
    searchMatchIdx = (searchMatchIdx + dir + searchMatches.length) % searchMatches.length;
    const match = searchMatches[searchMatchIdx];
    const sb = scrollback();
    const totalRows = sb.length + (cells.length || termRows);
    const visibleCount = cells.length || termRows;
    const liveStart = totalRows - visibleCount;
    if (match.row < liveStart - scrollOffset || match.row >= liveStart - scrollOffset + visibleCount) {
      scrollOffset = Math.max(0, liveStart - match.row);
    }
    needsRedraw = true; scheduleTermRender();
  }

  let renderScheduled = false;

  function scheduleTermRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    animId = requestAnimationFrame(render);
  }

  function render() {
    renderScheduled = false;
    if (!containerRef) return;
    if (!needsRedraw) return;
    if (!props.active) return;
    needsRedraw = false;

    const w = containerRef.clientWidth;
    const h = containerRef.clientHeight;
    if (w === 0 || h === 0) return;

    if (gpuCtx?.isActive()) {
      renderWebGL(w, h);
    } else if (canvasRef) {
      renderCanvas2D(w, h);
    }
  }

  // ── WebGL render path ─────────────────────────────────────

  function renderWebGL(w: number, h: number) {
    const gpu = gpuCtx!;
    const p = palette();
    const fs = fontSize();
    const cw = charWidth;
    const ch = charHeight;

    gpu.beginFrame(w, h, p.editorBg, fs, FONT_FAMILY);

    if (cells.length === 0) return;
    const visibleRows = getVisibleRows();

    // Pass 1: cell backgrounds (skip default bg)
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
    const sel = normalizedSelection();
    if (sel) {
      for (let row = sel.start.row; row <= Math.min(sel.end.row, visibleRows.length - 1); row++) {
        const cs = row === sel.start.row ? sel.start.col : 0;
        const ce = row === sel.end.row ? sel.end.col : (visibleRows[row]?.length ?? termCols) - 1;
        gpu.addOverlayCss(cs * cw, row * ch, (ce - cs + 1) * cw, ch, p.selection);
      }
    }

    // Search match highlights
    if (searchVisible && searchMatches.length > 0) {
      const sb = scrollback();
      const totalRows = sb.length + (cells.length || termRows);
      const visibleCount = cells.length || termRows;
      const viewStart = totalRows - visibleCount - scrollOffset;
      for (let mi = 0; mi < searchMatches.length; mi++) {
        const m = searchMatches[mi];
        const displayRow = m.row - viewStart;
        if (displayRow < 0 || displayRow >= visibleCount) continue;
        if (mi === searchMatchIdx) {
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

    // Pass 4: decorations (underline, strikethrough as thin quads)
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
    if (isFocused && scrollOffset === 0) {
      const cx = Math.round(cursorCol * cw);
      const cy = Math.round(cursorRow * ch);
      const cursorCell = cells[cursorRow]?.[cursorCol];
      const cursorW = cursorCell?.width === 2 ? cw * 2 : cw;
      gpu.addOverlayCss(cx, cy, cursorW, ch, p.cursor);
      gpu.flushQuads();
      if (cursorCell && cursorCell.ch !== " " && cursorCell.ch !== "") {
        gpu.addCharHex(cursorCell.ch, 0, cx, cy, p.editorBg);
        gpu.flushText();
      }
    }

    // Pass 6: scroll indicator
    if (scrollOffset > 0) {
      const label = `\u2191 ${scrollOffset} lines`;
      const tw = label.length * cw;
      gpu.addOverlayCss(w - tw - 16, 4, tw + 12, fs + 4, p.surface1);
      gpu.flushQuads();
      for (let i = 0; i < label.length; i++) {
        gpu.addCharHex(label[i], 0, w - tw - 10 + i * cw, 6, p.text);
      }
      gpu.flushText();
    }

    // Pass 7: bell flash
    if (bellFlashUntil > 0) {
      const remaining = bellFlashUntil - performance.now();
      if (remaining > 0) {
        gpu.addOverlay(0, 0, w, h, 205 / 255, 214 / 255, 244 / 255, 0.08);
        gpu.flushQuads();
        needsRedraw = true;
        scheduleTermRender();
      } else {
        bellFlashUntil = 0;
      }
    }

    // Sixel images: draw on a 2D overlay canvas
    renderSixelOverlay(w, h);
  }

  function renderSixelOverlay(w: number, h: number) {
    if (sixelImages.length === 0) {
      // Hide overlay if no sixel images
      if (sixelOverlay) sixelOverlay.style.display = "none";
      return;
    }
    // Lazily create the sixel overlay canvas
    if (!sixelOverlay && containerRef) {
      sixelOverlay = document.createElement("canvas");
      sixelOverlay.style.position = "absolute";
      sixelOverlay.style.top = "0";
      sixelOverlay.style.left = "0";
      sixelOverlay.style.width = "100%";
      sixelOverlay.style.height = "100%";
      sixelOverlay.style.pointerEvents = "none";
      containerRef.appendChild(sixelOverlay);
    }
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

    const cw = charWidth;
    const ch = charHeight;
    for (const img of sixelImages) {
      if (img.width === 0 || img.height === 0) continue;
      const cacheKey = `${img.row},${img.col},${img.width},${img.height}`;
      let imgData = sixelBitmapCache.get(cacheKey);
      if (!imgData) {
        imgData = new ImageData(img.width, img.height);
        const src = img.pixels;
        const dst = imgData.data;
        const len = Math.min(src.length, dst.length);
        for (let i = 0; i < len; i++) dst[i] = src[i];
        sixelBitmapCache.set(cacheKey, imgData);
        if (sixelBitmapCache.size > MAX_SIXEL_CACHE) {
          const first = sixelBitmapCache.keys().next().value!;
          sixelBitmapCache.delete(first);
        }
      }
      ctx.putImageData(imgData, img.col * cw, img.row * ch);
    }
  }

  // ── Canvas 2D fallback render path ────────────��───────────

  function renderCanvas2D(w: number, h: number) {
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvasRef!.width !== targetW || canvasRef!.height !== targetH) {
      canvasRef!.width = targetW;
      canvasRef!.height = targetH;
    }
    const ctx = canvasRef!.getContext("2d", { alpha: false })!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const p = palette();
    ctx.fillStyle = p.editorBg;
    ctx.fillRect(0, 0, w, h);

    if (cells.length === 0) return;

    const cw = charWidth;
    const ch = charHeight;
    const visibleRows = getVisibleRows();

    // Cell backgrounds
    for (let row = 0; row < visibleRows.length; row++) {
      const rowCells = visibleRows[row];
      if (!rowCells) continue;
      for (let col = 0; col < rowCells.length; col++) {
        const cell = rowCells[col];
        if (cell.width === 0) continue;
        const x = Math.round(col * cw);
        const y = Math.round(row * ch);
        const cellW = cell.width === 2 ? cw * 2 : cw;
        const isDefaultBg = cell.bg[0] === 30 && cell.bg[1] === 30 && cell.bg[2] === 46;
        if (!isDefaultBg) {
          ctx.fillStyle = `rgb(${cell.bg[0]}, ${cell.bg[1]}, ${cell.bg[2]})`;
          ctx.fillRect(x, y, cellW + 1, ch);
        }
      }
    }

    // Selection highlight
    const sel = normalizedSelection();
    if (sel) {
      ctx.fillStyle = p.selection;
      for (let row = sel.start.row; row <= Math.min(sel.end.row, visibleRows.length - 1); row++) {
        const cs = row === sel.start.row ? sel.start.col : 0;
        const ce = row === sel.end.row ? sel.end.col : (visibleRows[row]?.length ?? termCols) - 1;
        ctx.fillRect(cs * cw, row * ch, (ce - cs + 1) * cw, ch);
      }
    }

    // Search match highlights
    if (searchVisible && searchMatches.length > 0) {
      const sb = scrollback();
      const totalRows = sb.length + (cells.length || termRows);
      const visibleCount = cells.length || termRows;
      const viewStart = totalRows - visibleCount - scrollOffset;
      for (let mi = 0; mi < searchMatches.length; mi++) {
        const m = searchMatches[mi];
        const displayRow = m.row - viewStart;
        if (displayRow < 0 || displayRow >= visibleCount) continue;
        const isCurrent = mi === searchMatchIdx;
        ctx.fillStyle = isCurrent ? "rgba(250, 179, 135, 0.4)" : "rgba(137, 180, 250, 0.25)";
        ctx.fillRect(m.col * cw, displayRow * ch, m.len * cw, ch);
      }
    }

    // Text
    const fs = fontSize();
    const baseFont = `${fs}px ${FONT_FAMILY}`;
    ctx.textBaseline = "top";
    for (let row = 0; row < visibleRows.length; row++) {
      const rowCells = visibleRows[row];
      if (!rowCells) continue;
      for (let col = 0; col < rowCells.length; col++) {
        const cell = rowCells[col];
        if (cell.width === 0) continue;
        if (cell.ch === " " || cell.ch === "") continue;
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
          ctx.strokeStyle = fgColor;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y + ch - 1);
          ctx.lineTo(x + cellW, y + ch - 1);
          ctx.stroke();
        }
        if (cell.strikethrough) {
          ctx.strokeStyle = fgColor;
          ctx.lineWidth = 1;
          ctx.beginPath();
          const mid = y + ch / 2;
          ctx.moveTo(x, mid);
          ctx.lineTo(x + cellW, mid);
          ctx.stroke();
        }
      }
    }

    // Cursor
    if (isFocused && scrollOffset === 0) {
      const cx = Math.round(cursorCol * cw);
      const cy = Math.round(cursorRow * ch);
      const cursorCell = cells[cursorRow]?.[cursorCol];
      const cursorW = cursorCell?.width === 2 ? cw * 2 : cw;
      ctx.fillStyle = p.cursor;
      ctx.fillRect(cx, cy, cursorW, ch);
      if (cursorCell && cursorCell.ch !== " " && cursorCell.ch !== "") {
        ctx.font = baseFont;
        ctx.fillStyle = p.editorBg;
        ctx.fillText(cursorCell.ch, cx, cy);
      }
    }

    // Sixel images
    for (const img of sixelImages) {
      if (img.width === 0 || img.height === 0) continue;
      const cacheKey = `${img.row},${img.col},${img.width},${img.height}`;
      let imgData = sixelBitmapCache.get(cacheKey);
      if (!imgData) {
        imgData = new ImageData(img.width, img.height);
        const src = img.pixels;
        const dst = imgData.data;
        const len = Math.min(src.length, dst.length);
        for (let i = 0; i < len; i++) dst[i] = src[i];
        sixelBitmapCache.set(cacheKey, imgData);
        if (sixelBitmapCache.size > MAX_SIXEL_CACHE) {
          const first = sixelBitmapCache.keys().next().value!;
          sixelBitmapCache.delete(first);
        }
      }
      ctx.putImageData(imgData, img.col * cw, img.row * ch);
    }

    // Scroll indicator
    if (scrollOffset > 0) {
      const label = `\u2191 ${scrollOffset} lines`;
      const smallFont = `${fs - 2}px ${FONT_FAMILY}`;
      ctx.font = smallFont;
      const tw = measureTextWidth(label, smallFont);
      ctx.fillStyle = p.surface1;
      ctx.fillRect(w - tw - 16, 4, tw + 12, fs + 4);
      ctx.fillStyle = p.text;
      ctx.fillText(label, w - tw - 10, 6);
    }

    // Bell flash overlay
    if (bellFlashUntil > 0) {
      const remaining = bellFlashUntil - performance.now();
      if (remaining > 0) {
        ctx.fillStyle = "rgba(205, 214, 244, 0.08)";
        ctx.fillRect(0, 0, w, h);
        needsRedraw = true;
        scheduleTermRender();
      } else {
        bellFlashUntil = 0;
      }
    }
  }

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const RESIZE_DEBOUNCE_MS = 80;

  function handleResize() {
    if (!containerRef) return;
    const w = containerRef.clientWidth;
    const h = containerRef.clientHeight;
    // Skip zero-size measurements (display: none)
    if (w === 0 || h === 0) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(commitResize, RESIZE_DEBOUNCE_MS);
  }

  async function commitResize() {
    if (!containerRef) return;
    const w = containerRef.clientWidth;
    const h = containerRef.clientHeight;
    if (w === 0 || h === 0) return;
    measureChar();
    const { rows, cols } = computeGridSize();
    if (rows !== termRows || cols !== termCols) {
      termRows = rows;
      termCols = cols;
      if (ptyId) {
        try {
          await invoke("terminal_resize", { termId: ptyId, rows, cols });
        } catch (e) {
          console.warn("Terminal resize failed:", e);
        }
      }
    }
    needsRedraw = true;
    scheduleTermRender();
  }

  function handleInput() {
    // Only used as fallback for IME/composition input.
    // All regular keystrokes are captured directly in handleKeyDown.
    if (!hiddenInput || !ptyId) return;
    if (isComposingInput) return; // Wait for compositionend
    const text = hiddenInput.value;
    if (!text) return;
    hiddenInput.value = "";
    invoke("terminal_write", { termId: ptyId, data: text }).catch((e) => console.warn("Terminal IPC error:", e));
  }

  function sendMouseEvent(button: number, row: number, col: number, release: boolean) {
    if (!ptyId || mouseMode === "none") return;
    // SGR encoding: \x1b[<button;col;rowM (press) or \x1b[<button;col;rowm (release)
    // Coordinates are 1-based
    if (mouseEncoding === "sgr") {
      const suffix = release ? "m" : "M";
      invoke("terminal_write", { termId: ptyId, data: `\x1b[<${button};${col + 1};${row + 1}${suffix}` }).catch((e) => console.warn("Terminal IPC error:", e));
    } else {
      // Default encoding: \x1b[M + 3 bytes (button+32, col+33, row+33)
      if (!release) {
        const data = `\x1b[M${String.fromCharCode(button + 32)}${String.fromCharCode(col + 33)}${String.fromCharCode(row + 33)}`;
        invoke("terminal_write", { termId: ptyId, data }).catch((e) => console.warn("Terminal IPC error:", e));
      }
    }
  }

  function handleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    const pos = mouseToCell(e);

    // If app wants mouse events, forward them instead of selecting
    if (mouseMode !== "none") {
      sendMouseEvent(0, pos.row, pos.col, false);
      return;
    }

    e.preventDefault(); // Suppress native text selection
    scrollOffset = 0;
    selStart = pos;
    selEnd = pos;
    isSelecting = true;
    needsRedraw = true; scheduleTermRender();

    // Use document-level listeners so selection continues outside the terminal
    document.addEventListener("mousemove", handleDocMouseMove);
    document.addEventListener("mouseup", handleDocMouseUp);
  }

  function handleMouseMove(e: MouseEvent) {
    if (mouseMode === "button_motion" || mouseMode === "any_motion") {
      const pos = mouseToCell(e);
      if (e.buttons & 1) {
        sendMouseEvent(32, pos.row, pos.col, false); // 32 = motion + button 0
      } else if (mouseMode === "any_motion") {
        sendMouseEvent(35, pos.row, pos.col, false); // 35 = motion, no button
      }
      return;
    }
    // Selection moves are handled by document-level listener
  }

  function handleDocMouseMove(e: MouseEvent) {
    if (!isSelecting) return;
    selEnd = mouseToCell(e);
    needsRedraw = true; scheduleTermRender();
  }

  function handleDocMouseUp(e: MouseEvent) {
    document.removeEventListener("mousemove", handleDocMouseMove);
    document.removeEventListener("mouseup", handleDocMouseUp);

    if (mouseMode !== "none") {
      const pos = mouseToCell(e);
      if (mouseMode !== "press") {
        sendMouseEvent(0, pos.row, pos.col, true);
      }
      return;
    }
    if (!isSelecting) return;
    isSelecting = false;
    if (selStart && selEnd && selStart.row === selEnd.row && selStart.col === selEnd.col) {
      selStart = null;
      selEnd = null;
    }
    needsRedraw = true; scheduleTermRender();
    hiddenInput?.focus();
  }

  function handleMouseUp(e: MouseEvent) {
    // Primary mouseup handling is on document (handleDocMouseUp)
    // This handles mouse-mode forwarding when no selection is active
    if (mouseMode !== "none" && !isSelecting) {
      const pos = mouseToCell(e);
      if (mouseMode !== "press") {
        sendMouseEvent(0, pos.row, pos.col, true);
      }
    }
  }

  function handlePaste(e: ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData?.getData("text");
    if (text && ptyId) {
      const data = bracketedPaste ? `\x1b[200~${text}\x1b[201~` : text;
      invoke("terminal_write", { termId: ptyId, data }).catch((e) => console.warn("Terminal IPC error:", e));
      selStart = null;
      selEnd = null;
    }
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();

    // If app wants mouse events, send scroll as mouse buttons 64/65
    if (mouseMode !== "none") {
      const pos = mouseToCell(e);
      const button = e.deltaY < 0 ? 64 : 65;
      sendMouseEvent(button, pos.row, pos.col, false);
      return;
    }

    const lines = Math.ceil(Math.abs(e.deltaY) / charHeight) || 3;
    if (e.deltaY < 0) {
      scrollOffset = Math.min(scrollback().length, scrollOffset + lines);
    } else {
      scrollOffset = Math.max(0, scrollOffset - lines);
    }
    selStart = null;
    selEnd = null;
    needsRedraw = true; scheduleTermRender();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!ptyId) return;

    // Cmd+F: open terminal search
    if (e.metaKey && e.key === "f") {
      e.preventDefault();
      e.stopPropagation();
      searchVisible = true;
      searchQuery = "";
      searchMatches = [];
      searchMatchIdx = -1;
      needsRedraw = true; scheduleTermRender();
      // Focus the search input after it renders
      requestAnimationFrame(() => {
        containerRef?.querySelector<HTMLInputElement>(".term-search-input")?.focus();
      });
      return;
    }

    // Cmd+Z: readline undo (undo edits on current command line)
    if (e.metaKey && e.key === "z") {
      e.preventDefault();
      invoke("terminal_write", { termId: ptyId, data: "\x1f" }).catch(() => {});
      return;
    }

    // Cmd+C: copy selection (Ctrl+C goes to terminal as interrupt)
    if (e.metaKey && e.key === "c") {
      const text = getSelectedText();
      if (text) {
        e.preventDefault();
        navigator.clipboard.writeText(text).catch(() => {});
        return;
      }
    }

    // Cmd+V: paste from clipboard
    if (e.metaKey && e.key === "v") {
      e.preventDefault();
      navigator.clipboard.readText().then(text => {
        if (text && ptyId) {
          const data = bracketedPaste ? `\x1b[200~${text}\x1b[201~` : text;
          invoke("terminal_write", { termId: ptyId, data }).catch(() => {});
        }
      }).catch(() => {});
      return;
    }

    // Cmd+A: select all visible content
    if (e.metaKey && e.key === "a") {
      e.preventDefault();
      const rows = getVisibleRows();
      selStart = { row: 0, col: 0 };
      selEnd = { row: rows.length - 1, col: (rows[rows.length - 1]?.length ?? 1) - 1 };
      needsRedraw = true; scheduleTermRender();
      return;
    }

    // Any other key clears selection and returns to live view
    if (selStart) {
      selStart = null;
      selEnd = null;
      needsRedraw = true; scheduleTermRender();
    }
    if (scrollOffset > 0) {
      scrollOffset = 0;
      needsRedraw = true; scheduleTermRender();
    }

    // Map special keys to escape sequences
    let data: string | null = null;
    switch (e.key) {
      case "Enter": data = "\r"; break;
      case "Backspace": data = "\x7f"; break;
      case "Tab":
        // When tab trapping is off (Ctrl+M), let Tab move focus naturally
        if (!tabTrapping()) return;
        data = "\t"; break;
      case "Escape": data = "\x1b"; e.stopPropagation(); break;
      case "ArrowUp": data = "\x1b[A"; break;
      case "ArrowDown": data = "\x1b[B"; break;
      case "ArrowRight": data = "\x1b[C"; break;
      case "ArrowLeft": data = "\x1b[D"; break;
      case "Home": data = "\x1b[H"; break;
      case "End": data = "\x1b[F"; break;
      case "Delete": data = "\x1b[3~"; break;
      case "PageUp": data = "\x1b[5~"; break;
      case "PageDown": data = "\x1b[6~"; break;
    }

    // Ctrl+key combinations — use e.code (physical key) so Ctrl+Shift+C !== Ctrl+C
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.code.startsWith("Key")) {
      const letter = e.code.charCodeAt(3); // "KeyA" → 65
      const code = letter - 64; // A=1, B=2, ... Z=26
      if (code > 0 && code < 27) {
        data = String.fromCharCode(code);
      }
    }

    // Alt+key combinations — send ESC prefix (meta convention for readline word nav etc.)
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
      data = "\x1b" + e.key;
    }

    if (data) {
      e.preventDefault();
      if (hiddenInput) hiddenInput.value = "";
      invoke("terminal_write", { termId: ptyId, data }).catch((e) => console.warn("Terminal IPC error:", e));
      return;
    }

    // Capture printable characters directly instead of relying on textarea input event.
    // This avoids WKWebView race conditions between keydown/input event ordering.
    if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1 && !isComposingInput) {
      e.preventDefault();
      if (hiddenInput) hiddenInput.value = "";
      invoke("terminal_write", { termId: ptyId, data: e.key }).catch((e) => console.warn("Terminal IPC error:", e));
    }
  }

  // React to visibility changes — resize once the terminal becomes visible.
  createEffect(
    on(
      () => props.active,
      (active, prevActive) => {
        if (active && !prevActive) {
          requestAnimationFrame(() => {
            // Debounced — waits for layout to settle before resizing PTY
            handleResize();
          });
        }
      }
    )
  );

  onMount(async () => {
    if (!canvasRef || !containerRef) return;

    measureChar();

    // Try to create WebGL renderer — falls back to Canvas 2D silently
    gpuCtx = TerminalGLContext.tryCreate(fontSize(), FONT_FAMILY);
    if (gpuCtx) {
      // Insert WebGL canvas before the 2D canvas and hide the 2D fallback
      containerRef.insertBefore(gpuCtx.canvas, canvasRef);
      canvasRef.style.display = "none";
    }

    // Listen for screen deltas from Rust
    unlisten = (await listen<{ term_id: string; delta: TermScreenDelta }>(
      "terminal-screen",
      (event) => {
        if (event.payload.term_id === ptyId) {
          const d = event.payload.delta;

          // Handle alt-screen transitions
          if (d.alt_screen !== undefined && d.alt_screen !== inAltScreen) {
            if (d.alt_screen) {
              // Entering alt screen — start fresh alt scrollback
              scrollbackAlt = [];
            }
            // Exiting alt screen — discard alt scrollback (normal scrollback preserved)
            inAltScreen = d.alt_screen;
            scrollOffset = 0;
          }

          // Detect scrolling and capture scrollback before applying delta
          if (!d.full && cells.length > 1 && d.changed_rows.length > cells.length / 2) {
            const newRow0 = d.changed_rows.find(cr => cr.index === 0)?.cells;
            if (newRow0 && rowTextMatch(cells[1], newRow0) && cells[0]) {
              const sb = inAltScreen ? scrollbackAlt : scrollbackNormal;
              sb.push(cells[0]);
              if (sb.length > MAX_SCROLLBACK) sb.shift();
            }
          }

          // Full update on first render or resize (dimensions changed)
          if (d.full || cells.length !== d.rows) {
            cells = new Array(d.rows);
          }
          // Merge only the rows that actually changed
          for (const cr of d.changed_rows) {
            cells[cr.index] = cr.cells;
          }
          cursorRow = d.cursor_row;
          cursorCol = d.cursor_col;
          mouseMode = d.mouse_mode ?? "none";
          mouseEncoding = d.mouse_encoding ?? "default";
          bracketedPaste = d.bracketed_paste ?? false;

          // OSC 2 title → update tab name
          if (d.title) {
            props.onTitleChange?.(props.termTabId, d.title);
          }

          // Bell flash
          if (d.bell) {
            bellFlashUntil = performance.now() + 150;
          }

          needsRedraw = true; scheduleTermRender();
          termA11y.onScreenDelta(d);
        }
      }
    )) as unknown as () => void;

    // Listen for sixel images from Rust
    let unlistenSixel: (() => void) | null = null;
    listen<{ term_id: string; image: SixelImageData }>(
      "terminal-sixel",
      (event) => {
        if (event.payload.term_id === ptyId) {
          const img = event.payload.image;
          // Replace any existing image at the same position, or add new
          const idx = sixelImages.findIndex(
            (s) => s.row === img.row && s.col === img.col
          );
          if (idx >= 0) {
            sixelImages[idx] = img;
          } else {
            sixelImages.push(img);
          }
          // Invalidate cache for this position
          sixelBitmapCache.delete(`${img.row},${img.col},${img.width},${img.height}`);
          needsRedraw = true;
          scheduleTermRender();
        }
      }
    ).then((fn) => { unlistenSixel = fn as unknown as () => void; });

    // Listen for PTY crash recovery
    let unlistenRestart: (() => void) | null = null;
    listen<{ term_id: string; restart_count: number }>(
      "terminal-pty-restart",
      (event) => {
        if (event.payload.term_id === ptyId) {
          showToast(`Terminal restarted (attempt ${event.payload.restart_count}/3)`, "info");
        }
      }
    ).then((fn) => { unlistenRestart = fn as unknown as () => void; });

    // Listen for fatal PTY errors
    let unlistenError: (() => void) | null = null;
    listen<{ term_id: string; message: string }>(
      "terminal-pty-error",
      (event) => {
        if (event.payload.term_id === ptyId) {
          showToast(event.payload.message, "error");
        }
      }
    ).then((fn) => { unlistenError = fn as unknown as () => void; });

    // Listen for terminal theme changes — force a full re-render
    let unlistenTheme: (() => void) | null = null;
    listen<void>("terminal-theme-changed", () => {
      // Request a fresh full screen from the backend to pick up new theme colors
      if (ptyId) {
        invoke("terminal_write", { termId: ptyId, data: "" }).catch(() => {});
      }
      needsRedraw = true;
      scheduleTermRender();
    }).then((fn) => { unlistenTheme = fn as unknown as () => void; });

    // Compute initial grid size
    const { rows, cols } = computeGridSize();
    termRows = rows;
    termCols = cols;

    // Spawn PTY
    try {
      ptyId = await invoke<string>("terminal_spawn", {
        rows: termRows,
        cols: termCols,
        cwd: props.cwd || null,
      });
      props.onTermIdReady(props.termTabId, ptyId);
      // The initial delta from Rust fires during spawn (before ptyId is set),
      // so it gets dropped by the listener filter. Request a full resync now.
      await invoke("terminal_resync", { termId: ptyId });
    } catch (err) {
      showError("Failed to spawn terminal", err);
    }

    resizeObs = new ResizeObserver(() => {
      if (props.active) handleResize();
    });
    resizeObs.observe(containerRef);

    scheduleTermRender();

    if (props.autoFocus) hiddenInput?.focus();

    onCleanup(() => {
      cancelAnimationFrame(animId);
      clearTimeout(resizeTimer);
      document.removeEventListener("mousemove", handleDocMouseMove);
      document.removeEventListener("mouseup", handleDocMouseUp);
      if (unlisten) unlisten();
      if (unlistenSixel) unlistenSixel();
      if (unlistenRestart) unlistenRestart();
      if (unlistenError) unlistenError();
      if (unlistenTheme) unlistenTheme();
      if (resizeObs) resizeObs.disconnect();
      termA11y.cleanup();
      if (gpuCtx) { gpuCtx.dispose(); gpuCtx = null; }
      if (sixelOverlay) { sixelOverlay.remove(); sixelOverlay = null; }
      sixelImages = [];
      sixelBitmapCache.clear();
      scrollbackNormal = [];
      scrollbackAlt = [];
      if (ptyId) {
        invoke("terminal_kill", { termId: ptyId }).catch((e) => console.warn("Terminal IPC error:", e));
      }
    });
  });

  function handleClick() {
    hiddenInput?.focus();
  }

  function closeSearch() {
    searchVisible = false;
    searchQuery = "";
    searchMatches = [];
    searchMatchIdx = -1;
    needsRedraw = true; scheduleTermRender();
    hiddenInput?.focus();
  }

  function handleSearchKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); closeSearch(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      jumpToSearchMatch(e.shiftKey ? -1 : 1);
    }
  }

  function handleSearchInput(e: InputEvent) {
    searchQuery = (e.target as HTMLInputElement).value;
    runTermSearch(searchQuery);
  }

  // ── Context menu ─────────────────────────────────────────────────
  const [termCtxMenu, setTermCtxMenu] = createSignal<ContextMenuState | null>(null);

  function handleTermContextMenu(e: MouseEvent) {
    e.preventDefault();
    const hasSel = !!getSelectedText();
    setTermCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Copy", action: () => {
          const t = getSelectedText();
          if (t) navigator.clipboard.writeText(t).catch(() => {});
        }, disabled: !hasSel },
        { label: "Paste", action: () => {
          navigator.clipboard.readText().then(t => {
            if (t && ptyId) invoke("terminal_write", { termId: ptyId, data: t }).catch(() => {});
          }).catch(() => {});
        }},
        { separator: true },
        { label: "Clear", action: () => {
          if (ptyId) invoke("terminal_write", { termId: ptyId, data: "\x0c" }).catch(() => {});
        }},
      ],
    });
  }

  return (
    <CanvasSurface
      containerRef={(el) => { containerRef = el; }}
      class="canvas-terminal"
      onContextMenu={handleTermContextMenu}
      searchOverlay={searchVisible ? (
        <div class="term-search-bar" style={{
          position: "absolute", top: "4px", right: "8px", "z-index": "10",
          display: "flex", "align-items": "center", gap: "4px",
          background: "var(--surface0, #313244)", padding: "4px 8px",
          "border-radius": "4px", "font-size": "13px",
          "font-family": "'Courier New', Courier, monospace",
          color: "var(--text, #cdd6f4)",
        }}>
          <input
            class="term-search-input"
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onInput={handleSearchInput}
            onKeyDown={handleSearchKeyDown}
            style={{
              background: "var(--surface1, #45475a)", border: "none",
              color: "var(--text, #cdd6f4)", padding: "2px 6px",
              "font-size": "13px", "font-family": "'Courier New', Courier, monospace",
              outline: "none", width: "160px",
            }}
          />
          <button onClick={() => { searchUseRegex = !searchUseRegex; runTermSearch(searchQuery); }} style={{ background: searchUseRegex ? "var(--surface2, #585b70)" : "none", border: "none", color: "var(--text, #cdd6f4)", cursor: "pointer", padding: "1px 4px", "border-radius": "2px", "font-size": "11px" }} title="Use regex">.*</button>
          <button onClick={() => { searchCaseSensitive = !searchCaseSensitive; runTermSearch(searchQuery); }} style={{ background: searchCaseSensitive ? "var(--surface2, #585b70)" : "none", border: "none", color: "var(--text, #cdd6f4)", cursor: "pointer", padding: "1px 4px", "border-radius": "2px", "font-size": "11px" }} title="Match case">Aa</button>
          <span style={{ opacity: "0.6", "font-size": "11px" }}>
            {searchMatches.length > 0 ? `${searchMatchIdx + 1}/${searchMatches.length}` : "0/0"}
          </span>
          <button onClick={() => jumpToSearchMatch(-1)} style={{ background: "none", border: "none", color: "var(--text, #cdd6f4)", cursor: "pointer", padding: "0 2px" }} title="Previous">↑</button>
          <button onClick={() => jumpToSearchMatch(1)} style={{ background: "none", border: "none", color: "var(--text, #cdd6f4)", cursor: "pointer", padding: "0 2px" }} title="Next">↓</button>
          <button onClick={closeSearch} style={{ background: "none", border: "none", color: "var(--text, #cdd6f4)", cursor: "pointer", padding: "0 2px" }} title="Close">×</button>
        </div>
      ) : undefined}
      canvasRef={(el) => { canvasRef = el; }}
      inputRef={(el) => { hiddenInput = el; }}
      a11y={<termA11y.ParallelDOM />}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      style={{ display: props.active ? "block" : "none", cursor: isSelecting ? "text" : "default" }}
      textareaProps={{
        role: "textbox",
        "aria-label": "Terminal input",
        "aria-roledescription": "terminal",
        onKeyDown: handleKeyDown,
        onInput: handleInput,
        onPaste: handlePaste,
        onCopy: (e: ClipboardEvent) => {
          const text = getSelectedText();
          if (text) {
            e.preventDefault();
            e.clipboardData?.setData("text/plain", text);
          }
        },
        onCompositionStart: () => { isComposingInput = true; },
        onCompositionEnd: () => {
          isComposingInput = false;
          // Flush composed text via handleInput
          handleInput();
        },
        onFocus: () => {
          isFocused = true;
          needsRedraw = true;
          scheduleTermRender();
          if (ptyId) invoke("terminal_write", { termId: ptyId, data: "\x1b[I" }).catch((e) => console.warn("Terminal IPC error:", e));
        },
        onBlur: () => {
          isFocused = false;
          needsRedraw = true;
          scheduleTermRender();
          if (ptyId) invoke("terminal_write", { termId: ptyId, data: "\x1b[O" }).catch((e) => console.warn("Terminal IPC error:", e));
        },
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: false,
        tabIndex: 0,
        "data-tab-focus-target": "true",
      }}
    >
      <ContextMenu menu={termCtxMenu()} onClose={() => setTermCtxMenu(null)} />
    </CanvasSurface>
  );
};

export default CanvasTerminal;
