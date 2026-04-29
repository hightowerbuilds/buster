import { Component, createEffect, on, onMount, onCleanup, createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import CanvasSurface from "./CanvasSurface";
import { useBuster } from "../lib/buster-context";
import { getCharWidth } from "../editor/text-measure";
import { showToast } from "./CanvasToasts";
import { showError } from "../lib/notify";
import ContextMenu, { type ContextMenuState } from "./ContextMenu";
import { TerminalGLContext } from "./terminal-webgl";
import { mapSpecialKey, mapCtrlKey, mapAltKey, encodeSgrMouse, encodeDefaultMouse } from "./terminal-keys";
import { searchTerminalRows, scrollToMatch } from "./terminal-search";
import { decodeBinaryDelta, type TermCell, type TermScreenDelta, type TerminalCursorStyle } from "./terminal-binary";
import { renderWebGL as doRenderWebGL, renderCanvas2D as doRenderCanvas2D, type TermRenderState, type TermRenderDeps } from "./terminal-render";
import {
  findTerminalWordBounds,
  getTerminalSelectedText,
  normalizeTerminalSelection,
  terminalRowText,
} from "./terminal-selection";
import { terminalUrlAt } from "./terminal-links";

const TERMINAL_WEBGL_ENABLED = false;

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

interface CanvasTerminalProps {
  termTabId: string;
  active: boolean;
  cwd?: string;
  onTermIdReady: (termTabId: string, ptyId: string) => void;
  onTitleChange?: (termTabId: string, title: string) => void;
  autoFocus?: boolean;
}

import { createTerminalA11y } from "./terminal-a11y";
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
  let cursorBlinkVisible = true;
  let cursorBlinkTimer: ReturnType<typeof setInterval> | undefined;
  let bellAudioContext: AudioContext | null = null;
  let ptyId: string | null = null;
  let unlisten: (() => void) | null = null;
  let resizeObs: ResizeObserver | null = null;

  let cells: TermCell[][] = [];
  let cursorRow = 0;
  let cursorCol = 0;
  let cursorStyle: TerminalCursorStyle = "block";
  let charWidth = 0;
  let charHeight = 0;
  let termRows = 24;
  let termCols = 80;
  let needsRedraw = true;
  let selStart: { row: number; col: number } | null = null;
  let selEnd: { row: number; col: number } | null = null;
  let selectedTextSnapshot = "";
  let isSelecting = false;
  let scrollbackNormal: TermCell[][] = [];
  let scrollbackAlt: TermCell[][] = [];
  let inAltScreen = false;
  let scrollOffset = 0;
  let isComposingInput = false;
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
  let hoverUrl: string | null = null;
  let suppressNextClick = false;

  // WebGL renderer (null = Canvas 2D fallback)
  let gpuCtx: TerminalGLContext | null = null;
  let sixelOverlay: HTMLCanvasElement | null = null;

  const termA11y = createTerminalA11y();

  function fontSize() { return settings().font_size; }

  function maxScrollbackRows() {
    const rows = settings().terminal_scrollback_rows ?? 10_000;
    return Math.max(1_000, Math.min(100_000, rows));
  }

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
    return normalizeTerminalSelection(selStart, selEnd);
  }

  function getSelectedText(): string {
    if (selectedTextSnapshot && !isSelecting) return selectedTextSnapshot;
    return getTerminalSelectedText(getVisibleRows(), selStart, selEnd);
  }

  function clearSelection() {
    selStart = null;
    selEnd = null;
    selectedTextSnapshot = "";
  }

  function updateSelectionSnapshot() {
    selectedTextSnapshot = getTerminalSelectedText(getVisibleRows(), selStart, selEnd);
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
    if (!query) { searchMatches = []; needsRedraw = true; scheduleTermRender(); return; }
    const allRows = [...scrollback(), ...cells];
    searchMatches = searchTerminalRows(allRows, query, { useRegex: searchUseRegex, caseSensitive: searchCaseSensitive });
    searchMatchIdx = searchMatches.length > 0 ? searchMatches.length - 1 : -1;
    if (searchMatchIdx >= 0) {
      const newOffset = scrollToMatch(searchMatches[searchMatchIdx].row, scrollback().length, cells.length || termRows, scrollOffset);
      if (newOffset !== null) scrollOffset = newOffset;
    }
    needsRedraw = true; scheduleTermRender();
  }

  function jumpToSearchMatch(dir: 1 | -1) {
    if (searchMatches.length === 0) return;
    searchMatchIdx = (searchMatchIdx + dir + searchMatches.length) % searchMatches.length;
    const newOffset = scrollToMatch(searchMatches[searchMatchIdx].row, scrollback().length, cells.length || termRows, scrollOffset);
    if (newOffset !== null) scrollOffset = newOffset;
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

    // Render state bridge for the extracted render module
    const rs: TermRenderState = {
      cells, cursorRow, cursorCol, charWidth, charHeight,
      cursorStyle,
      termRows, termCols, isFocused: isFocused && (!settings().cursor_blink || cursorBlinkVisible), scrollOffset,
      searchVisible, searchMatches, searchMatchIdx,
      bellFlashUntil, sixelImages, sixelBitmapCache,
    };
    const rd: TermRenderDeps = {
      state: rs, palette, fontSize, getVisibleRows, normalizedSelection,
      scrollback, scheduleTermRender,
      sixelOverlay, containerRef,
      setSixelOverlay: (el) => { sixelOverlay = el; },
    };

    if (gpuCtx?.isActive()) {
      doRenderWebGL(w, h, gpuCtx, rd);
      // Sync mutable state back
      bellFlashUntil = rs.bellFlashUntil;
      if (rs.bellFlashUntil > 0) { needsRedraw = true; }
    } else if (canvasRef) {
      doRenderCanvas2D(w, h, canvasRef, rd);
      bellFlashUntil = rs.bellFlashUntil;
      if (rs.bellFlashUntil > 0) { needsRedraw = true; }
    }
  }

  // Render paths extracted to terminal-render.ts

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
          await requestTerminalResync();
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
    const data = mouseEncoding === "sgr"
      ? encodeSgrMouse(button, row, col, release)
      : encodeDefaultMouse(button, row, col, release);
    if (data) {
      invoke("terminal_write", { termId: ptyId, data }).catch((e) => console.warn("Terminal IPC error:", e));
    }
  }

  function updateHoverUrl(e: MouseEvent) {
    if (!containerRef || mouseMode !== "none" || isSelecting) return;
    const match = terminalUrlAt(getVisibleRows(), mouseToCell(e));
    hoverUrl = match?.url ?? null;
    containerRef.style.cursor = hoverUrl ? "pointer" : "default";
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
    selectedTextSnapshot = "";
    const visibleRows = getVisibleRows();
    if (e.detail >= 3) {
      suppressNextClick = true;
      const lineLength = terminalRowText(visibleRows[pos.row]).length || termCols;
      selStart = { row: pos.row, col: 0 };
      selEnd = { row: pos.row, col: Math.max(0, lineLength - 1) };
      updateSelectionSnapshot();
      needsRedraw = true; scheduleTermRender();
      hiddenInput?.focus();
      return;
    }
    if (e.detail === 2) {
      suppressNextClick = true;
      const bounds = findTerminalWordBounds(terminalRowText(visibleRows[pos.row]), pos.col);
      selStart = { row: pos.row, col: bounds.start };
      selEnd = { row: pos.row, col: bounds.end };
      updateSelectionSnapshot();
      needsRedraw = true; scheduleTermRender();
      hiddenInput?.focus();
      return;
    }
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
    updateHoverUrl(e);
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
      clearSelection();
    } else {
      updateSelectionSnapshot();
      suppressNextClick = true;
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
      clearSelection();
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

    // Cmd+K: clear screen and local scrollback
    if (e.metaKey && e.key === "k") {
      e.preventDefault();
      e.stopPropagation();
      clearTerminal();
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
      clearSelection();
      needsRedraw = true; scheduleTermRender();
    }
    if (scrollOffset > 0) {
      scrollOffset = 0;
      needsRedraw = true; scheduleTermRender();
    }

    // Map special keys, Ctrl+key, and Alt+key to escape sequences
    let data: string | null = mapSpecialKey(e.key, tabTrapping());
    if (e.key === "Escape" && data) e.stopPropagation();
    if (!data) data = mapCtrlKey(e.code, e.ctrlKey, e.altKey, e.metaKey);
    if (!data) data = mapAltKey(e.key, e.altKey, e.ctrlKey, e.metaKey);

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

  function applyEncodedDelta(data: string) {
    applyTerminalDelta(decodeBinaryDelta(data));
  }

  function applyTerminalDelta(d: TermScreenDelta) {
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
        while (sb.length > maxScrollbackRows()) sb.shift();
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
    cursorStyle = d.cursor_style ?? "block";
    mouseMode = d.mouse_mode ?? "none";
    mouseEncoding = d.mouse_encoding ?? "default";
    bracketedPaste = d.bracketed_paste ?? false;

    // OSC 2 title → update tab name
    if (d.title) {
      props.onTitleChange?.(props.termTabId, d.title);
    }

    // Bell flash
    if (d.bell) {
      const mode = settings().terminal_bell_mode || "visual";
      if (mode === "visual") {
        bellFlashUntil = performance.now() + 150;
      } else if (mode === "audible") {
        playTerminalBell();
      }
    }

    needsRedraw = true; scheduleTermRender();
    termA11y.onScreenDelta(d);
  }

  async function requestTerminalResync() {
    if (!ptyId) return;
    const data = await invoke<string>("terminal_resync", { termId: ptyId });
    applyEncodedDelta(data);
  }

  function clearTerminal() {
    scrollbackNormal = [];
    scrollbackAlt = [];
    sixelImages = [];
    sixelBitmapCache.clear();
    scrollOffset = 0;
    clearSelection();
    if (ptyId) invoke("terminal_write", { termId: ptyId, data: "\x0c" }).catch(() => {});
    needsRedraw = true; scheduleTermRender();
  }

  function playTerminalBell() {
    try {
      bellAudioContext ??= new AudioContext();
      const now = bellAudioContext.currentTime;
      const oscillator = bellAudioContext.createOscillator();
      const gain = bellAudioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      oscillator.connect(gain);
      gain.connect(bellAudioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.13);
    } catch {
      bellFlashUntil = performance.now() + 150;
    }
  }

  onMount(async () => {
    if (!canvasRef || !containerRef) return;

    measureChar();
    cursorBlinkTimer = setInterval(() => {
      if (!isFocused || !settings().cursor_blink) {
        if (!cursorBlinkVisible) {
          cursorBlinkVisible = true;
          needsRedraw = true;
          scheduleTermRender();
        }
        return;
      }
      cursorBlinkVisible = !cursorBlinkVisible;
      needsRedraw = true;
      scheduleTermRender();
    }, 530);

    // Try to create WebGL renderer — falls back to Canvas 2D silently
    gpuCtx = TERMINAL_WEBGL_ENABLED ? TerminalGLContext.tryCreate(fontSize(), FONT_FAMILY) : null;
    if (gpuCtx) {
      // Insert WebGL canvas before the 2D canvas and hide the 2D fallback
      containerRef.insertBefore(gpuCtx.canvas, canvasRef);
      canvasRef.style.display = "none";
    }

    // Listen for binary screen deltas from Rust
    unlisten = (await listen<{ term_id: string; data: string }>(
      "terminal-screen",
      (event) => {
        if (event.payload.term_id === ptyId) {
          applyEncodedDelta(event.payload.data);
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
      await requestTerminalResync();
      window.setTimeout(() => {
        requestTerminalResync().catch(() => {});
      }, 150);
      window.setTimeout(() => {
        if (!ptyId) return;
        invoke("terminal_write", { termId: ptyId, data: "\r" })
          .then(() => requestTerminalResync())
          .catch(() => {});
      }, 250);
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
      if (cursorBlinkTimer) clearInterval(cursorBlinkTimer);
      document.removeEventListener("mousemove", handleDocMouseMove);
      document.removeEventListener("mouseup", handleDocMouseUp);
      if (unlisten) unlisten();
      if (unlistenSixel) unlistenSixel();
      if (unlistenRestart) unlistenRestart();
      if (unlistenError) unlistenError();
      if (unlistenTheme) unlistenTheme();
      if (resizeObs) resizeObs.disconnect();
      if (containerRef) containerRef.style.cursor = "";
      termA11y.cleanup();
      if (bellAudioContext) {
        bellAudioContext.close().catch(() => {});
        bellAudioContext = null;
      }
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

  function handleClick(e: MouseEvent) {
    if (suppressNextClick) {
      suppressNextClick = false;
      hiddenInput?.focus();
      return;
    }
    if (mouseMode === "none") {
      const match = terminalUrlAt(getVisibleRows(), mouseToCell(e));
      if (match) {
        openUrl(match.url).catch((err) => console.warn("Open terminal URL failed:", err));
        hiddenInput?.focus();
        return;
      }
    }
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
        { label: "Clear", action: clearTerminal },
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
      style={{ cursor: isSelecting ? "text" : "default" }}
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
          cursorBlinkVisible = true;
          needsRedraw = true;
          scheduleTermRender();
        },
        onBlur: () => {
          isFocused = false;
          cursorBlinkVisible = true;
          needsRedraw = true;
          scheduleTermRender();
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
