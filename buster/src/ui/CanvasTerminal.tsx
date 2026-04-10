import { Component, createEffect, on, onMount, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import CanvasSurface from "./CanvasSurface";
import { tabTrapping } from "../lib/app-state";
import { FONT_FAMILY } from "../editor/text-measure";

interface TermCell {
  ch: string;
  fg: [number, number, number];
  bg: [number, number, number];
  bold: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
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
}

import { settings } from "../lib/app-state";

interface CanvasTerminalProps {
  termTabId: string;
  active: boolean;
  cwd?: string;
  onTermIdReady: (termTabId: string, ptyId: string) => void;
}

import { palette } from "../lib/app-state";
import { createTerminalA11y } from "./terminal-a11y";
// Cursor is always visible when focused — no blink

const CanvasTerminal: Component<CanvasTerminalProps> = (props) => {
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
  let scrollback: TermCell[][] = [];
  let scrollOffset = 0;
  const MAX_SCROLLBACK = 10_000;
  let mouseMode = "none";
  let mouseEncoding = "default";
  let bracketedPaste = false;
  let sixelImages: SixelImageData[] = [];
  let sixelBitmapCache: Map<string, ImageData> = new Map();

  const termA11y = createTerminalA11y();

  function fontSize() { return settings().font_size; }

  function measureChar() {
    const c = document.createElement("canvas");
    c.width = 1; c.height = 1;
    const ctx = c.getContext("2d")!;
    ctx.font = `${fontSize()}px ${FONT_FAMILY}`;
    charWidth = ctx.measureText("M").width;
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

  function getVisibleRows(): (TermCell[] | undefined)[] {
    if (scrollOffset === 0) return cells;
    const combined = [...scrollback, ...cells];
    const visibleCount = cells.length || termRows;
    const start = Math.max(0, combined.length - visibleCount - scrollOffset);
    return combined.slice(start, start + visibleCount);
  }

  let renderScheduled = false;

  function scheduleTermRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    animId = requestAnimationFrame(render);
  }

  function render() {
    renderScheduled = false;
    if (!canvasRef || !containerRef) return;
    if (!needsRedraw) return;
    needsRedraw = false;

    const dpr = window.devicePixelRatio || 1;
    const w = containerRef.clientWidth;
    const h = containerRef.clientHeight;

    // Only resize backing store when dimensions change
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvasRef.width !== targetW || canvasRef.height !== targetH) {
      canvasRef.width = targetW;
      canvasRef.height = targetH;
    }
    const ctx = canvasRef.getContext("2d", { alpha: false })!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background (theme-aware)
    const p = palette();
    ctx.fillStyle = p.editorBg;
    ctx.fillRect(0, 0, w, h);

    if (cells.length === 0) return;

    const cw = charWidth;
    const ch = charHeight;
    const visibleRows = getVisibleRows();

    // Draw cell backgrounds
    for (let row = 0; row < visibleRows.length; row++) {
      const rowCells = visibleRows[row];
      if (!rowCells) continue;

      for (let col = 0; col < rowCells.length; col++) {
        const cell = rowCells[col];
        const x = col * cw;
        const y = row * ch;

        // Background (skip default terminal bg for performance)
        const isDefaultBg = cell.bg[0] === 30 && cell.bg[1] === 30 && cell.bg[2] === 46;
        if (!isDefaultBg) {
          ctx.fillStyle = `rgb(${cell.bg[0]}, ${cell.bg[1]}, ${cell.bg[2]})`;
          ctx.fillRect(x, y, cw + 1, ch);
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

    // Draw text — direct fillText (browser's internal glyph cache handles caching)
    const fs = fontSize();
    const baseFont = `${fs}px ${FONT_FAMILY}`;
    ctx.textBaseline = "top";

    for (let row = 0; row < visibleRows.length; row++) {
      const rowCells = visibleRows[row];
      if (!rowCells) continue;

      for (let col = 0; col < rowCells.length; col++) {
        const cell = rowCells[col];
        if (cell.ch === " " || cell.ch === "") continue;

        const x = col * cw;
        const y = row * ch;

        // Font style
        const weight = cell.bold ? "bold " : "";
        const style = cell.italic ? "italic " : "";
        const cellFont = (weight || style) ? `${style}${weight}${fs}px ${FONT_FAMILY}` : baseFont;

        const fgColor = `rgb(${cell.fg[0]}, ${cell.fg[1]}, ${cell.fg[2]})`;
        ctx.font = cellFont;
        ctx.fillStyle = fgColor;
        ctx.fillText(cell.ch, x, y);

        // Underline
        if (cell.underline) {
          ctx.strokeStyle = fgColor;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y + ch - 1);
          ctx.lineTo(x + cw, y + ch - 1);
          ctx.stroke();
        }
      }
    }

    // Cursor (only when focused and showing live view)
    if (isFocused && scrollOffset === 0) {
      const cx = cursorCol * cw;
      const cy = cursorRow * ch;
      ctx.fillStyle = p.cursor;
      ctx.fillRect(cx, cy, cw, ch);

      // Redraw the character under the cursor in inverted color
      const cursorCell = cells[cursorRow]?.[cursorCol];
      if (cursorCell && cursorCell.ch !== " " && cursorCell.ch !== "") {
        ctx.font = baseFont;
        ctx.fillStyle = p.editorBg;
        ctx.fillText(cursorCell.ch, cx, cy);
      }
    }

    // Draw sixel images on the canvas
    for (const img of sixelImages) {
      if (img.width === 0 || img.height === 0) continue;

      const cacheKey = `${img.row},${img.col},${img.width},${img.height}`;
      let imgData = sixelBitmapCache.get(cacheKey);
      if (!imgData) {
        imgData = new ImageData(img.width, img.height);
        const src = img.pixels;
        const dst = imgData.data;
        const len = Math.min(src.length, dst.length);
        for (let i = 0; i < len; i++) {
          dst[i] = src[i];
        }
        sixelBitmapCache.set(cacheKey, imgData);
      }

      const sx = img.col * cw;
      const sy = img.row * ch;
      ctx.putImageData(imgData, sx, sy);
    }

    // Scroll indicator
    if (scrollOffset > 0) {
      const label = `↑ ${scrollOffset} lines`;
      const smallFont = `${fs - 2}px ${FONT_FAMILY}`;
      ctx.font = smallFont;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = p.surface1;
      ctx.fillRect(w - tw - 16, 4, tw + 12, fs + 4);
      ctx.fillStyle = p.text;
      ctx.fillText(label, w - tw - 10, 6);
    }
  }

  async function handleResize() {
    if (!containerRef) return;
    measureChar();
    const { rows, cols } = computeGridSize();
    if (rows !== termRows || cols !== termCols) {
      termRows = rows;
      termCols = cols;
      if (ptyId) {
        try {
          await invoke("terminal_resize", { termId: ptyId, rows, cols });
        } catch {}
      }
    }
  }

  function handleInput() {
    if (!hiddenInput || !ptyId) return;
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

    scrollOffset = 0;
    selStart = pos;
    selEnd = pos;
    isSelecting = true;
    needsRedraw = true; scheduleTermRender();
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
    if (!isSelecting) return;
    selEnd = mouseToCell(e);
    needsRedraw = true; scheduleTermRender();
  }

  function handleMouseUp(e: MouseEvent) {
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
      scrollOffset = Math.min(scrollback.length, scrollOffset + lines);
    } else {
      scrollOffset = Math.max(0, scrollOffset - lines);
    }
    selStart = null;
    selEnd = null;
    needsRedraw = true; scheduleTermRender();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!ptyId) return;

    // Cmd+C: copy selection (Ctrl+C goes to terminal as interrupt)
    if (e.metaKey && e.key === "c") {
      const text = getSelectedText();
      if (text) {
        e.preventDefault();
        navigator.clipboard.writeText(text).catch((e) => console.warn("Terminal IPC error:", e));
        return;
      }
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

    // Ctrl+key combinations
    if (e.ctrlKey && e.key.length === 1) {
      const code = e.key.toLowerCase().charCodeAt(0) - 96;
      if (code > 0 && code < 27) {
        data = String.fromCharCode(code);
      }
    }

    if (data) {
      e.preventDefault();
      invoke("terminal_write", { termId: ptyId, data }).catch((e) => console.warn("Terminal IPC error:", e));
      return;
    }

    // Let printable characters go through the hidden textarea input event
  }

  // React to active state changes — send focus/blur events to PTY
  createEffect(
    on(
      () => props.active,
      (active, prevActive) => {
        if (active && !prevActive) {
          requestAnimationFrame(() => {
            hiddenInput?.focus();
            handleResize();
          });
          if (ptyId) invoke("terminal_write", { termId: ptyId, data: "\x1b[I" }).catch((e) => console.warn("Terminal IPC error:", e));
        }
        if (!active && prevActive) {
          if (ptyId) invoke("terminal_write", { termId: ptyId, data: "\x1b[O" }).catch((e) => console.warn("Terminal IPC error:", e));
        }
      }
    )
  );

  onMount(async () => {
    if (!canvasRef || !containerRef) return;

    measureChar();

    // Listen for screen deltas from Rust
    unlisten = (await listen<{ term_id: string; delta: TermScreenDelta }>(
      "terminal-screen",
      (event) => {
        if (event.payload.term_id === ptyId) {
          const d = event.payload.delta;

          // Detect scrolling and capture scrollback before applying delta
          if (!d.full && cells.length > 1 && d.changed_rows.length > cells.length / 2) {
            const newRow0 = d.changed_rows.find(cr => cr.index === 0)?.cells;
            if (newRow0 && rowTextMatch(cells[1], newRow0) && cells[0]) {
              scrollback.push(cells[0]);
              if (scrollback.length > MAX_SCROLLBACK) scrollback.shift();
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
    } catch (err) {
      console.error("Failed to spawn terminal:", err);
    }

    resizeObs = new ResizeObserver(() => {
      if (props.active) handleResize();
    });
    resizeObs.observe(containerRef);

    scheduleTermRender();

    if (props.active) hiddenInput?.focus();

    onCleanup(() => {
      cancelAnimationFrame(animId);
      if (unlisten) unlisten();
      if (unlistenSixel) unlistenSixel();
      if (unlistenTheme) unlistenTheme();
      if (resizeObs) resizeObs.disconnect();
      termA11y.cleanup();
      sixelImages = [];
      sixelBitmapCache.clear();
      if (ptyId) {
        invoke("terminal_kill", { termId: ptyId }).catch((e) => console.warn("Terminal IPC error:", e));
      }
    });
  });

  function handleClick() {
    hiddenInput?.focus();
  }

  return (
    <CanvasSurface
      containerRef={(el) => { containerRef = el; }}
      class="canvas-terminal"
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
        onFocus: () => { isFocused = true; needsRedraw = true; scheduleTermRender(); },
        onBlur: () => { isFocused = false; needsRedraw = true; scheduleTermRender(); },
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: false,
        tabIndex: 0,
      }}
    />
  );
};

export default CanvasTerminal;
