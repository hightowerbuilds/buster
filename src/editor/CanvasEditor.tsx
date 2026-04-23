import { Component, onMount, onCleanup, createSignal, createEffect } from "solid-js";
import type { SearchMatch, DiffHunk, GitBlameLine } from "../lib/ipc";
import { gitBlame, evaluateKeymap } from "../lib/ipc";
import { createEditorEngine, getCharWidth, type EditorEngine } from "./engine";
import { FONT_FAMILY } from "./text-measure";
import { requestHighlights, spansToLineTokens, setSyntaxPalette, syntaxOpen, syntaxClose, type LineToken } from "./ts-highlighter";
import { renderEditor } from "./canvas-renderer";
import { WebGLTextContext } from "./webgl-text";
import { createAutocomplete } from "./editor-autocomplete";
import { createHover } from "./editor-hover";
import { createSignatureHelp } from "./editor-signature";
import { createCodeActions } from "./editor-code-actions";
import { createGhostText } from "./editor-ghost-text";
import { createInlayHints } from "./editor-inlay-hints";
import { createEditorA11y } from "./editor-a11y";
import { createVimHandler } from "./vim-mode";
import CanvasSurface from "../ui/CanvasSurface";
import { clipboardWrite, clipboardRead } from "../lib/clipboard";
import { basename, extname } from "buster-path";
import { lspDidChange, lspDidChangeIncremental } from "../lib/ipc";
import { useBuster } from "../lib/buster-context";
import { showError } from "../lib/notify";
import ContextMenu, { type ContextMenuState } from "../ui/ContextMenu";

// ─── Props ──────────────────────────────────────────────────────────

interface CanvasEditorProps {
  initialText: string;
  filePath: string | null;
  active?: boolean;
  autoFocus?: boolean;
  onEngineReady?: (engine: EditorEngine) => void;
  onCursorChange?: (line: number, col: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
  searchMatches?: SearchMatch[];
  currentSearchIdx?: number;
  wordWrap?: boolean;
  fontSize?: number;
  lineNumbers?: boolean;
  autocomplete?: boolean;
  onGoToFile?: (path: string, line: number, col: number) => void;
  diagnostics?: { line: number; col: number; endLine: number; endCol: number; severity: number; message: string }[];
  diffHunks?: DiffHunk[];
  minimap?: boolean;
}

// Cursor is always visible — no blink

// ─── Active-panel scroll routing ────────────────────────────────────
// A wheel event over ANY editor panel (hover-routed by the browser) is
// forwarded here, then dispatched to whichever editor registered itself
// as "the active one". This gives the user focus-based scroll semantics:
// click a panel → every subsequent scroll scrolls THAT panel, regardless
// of cursor position. Inactive panels' scroll state never mutates, so the
// paint-skip optimization at doRender() remains sound.
const activeScrollTarget: { apply: ((deltaY: number) => void) | null } = { apply: null };

// ─── Component ──────────────────────────────────────────────────────

const CanvasEditor: Component<CanvasEditorProps> = (props) => {
  const { store, setStore, actions } = useBuster();
  const palette = () => store.palette;
  const workspaceRoot = () => store.workspaceRoot;
  const tabTrapping = () => store.tabTrapping;
  let canvasRef: HTMLCanvasElement | undefined;
  let hiddenInput: HTMLTextAreaElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let animFrameId: number;
  let gpuCtx: WebGLTextContext | null = null;
  // ── Engine ──────────────────────────────────────────────────────

  const engine = createEditorEngine(props.initialText, props.filePath ?? undefined);

  /** Return the whitespace string for one indent level (respects tab_size and use_spaces settings). */
  function indentUnit(): string {
    const size = store.settings.tab_size || 4;
    return store.settings.use_spaces !== false ? " ".repeat(size) : "\t";
  }

  // ── Vim mode ──────────────────────────────────────────────────
  const vim = createVimHandler();
  createEffect(() => { vim.setEnabled(store.settings.vim_mode ?? false); });
  // Load Lua keymap from backend
  evaluateKeymap().then(json => vim.loadKeymap(json)).catch(e => console.warn("Keymap load failed:", e));
  // Push mode changes to global store for status bar display
  createEffect(() => {
    const m = vim.enabled() ? vim.mode() : null;
    setStore("vimMode", m);
  });

  const vimDeps = {
    openFind: () => setStore("findVisible", true),
    findNext: () => {
      const m = store.searchMatches;
      if (m.length === 0) return;
      const next = (store.currentSearchIdx + 1) % m.length;
      setStore("currentSearchIdx", next);
      engine.setCursor({ line: m[next].line, col: m[next].start_col });
    },
    findPrev: () => {
      const m = store.searchMatches;
      if (m.length === 0) return;
      const prev = (store.currentSearchIdx - 1 + m.length) % m.length;
      setStore("currentSearchIdx", prev);
      engine.setCursor({ line: m[prev].line, col: m[prev].start_col });
    },
    openCommandPalette: (prefix: string) => {
      setStore("paletteInitialQuery", prefix);
      setStore("paletteVisible", true);
    },
    handleSave: () => actions.handleSave(),
    handleTabClose: () => {
      const tab = store.tabs.find(t => t.id === store.activeTabId);
      if (tab) actions.handleTabClose(tab.id);
    },
  };

  // Expose engine to parent (for save, getText, etc.)
  props.onEngineReady?.(engine);

  // Derived signals for subsystems that need separate line/col accessors
  const cursorLine = () => engine.cursor().line;
  const cursorCol = () => engine.cursor().col;

  // Notify parent of cursor changes
  createEffect(() => {
    const c = engine.cursor();
    props.onCursorChange?.(c.line, c.col);
  });

  // Notify parent of dirty changes
  createEffect(() => {
    props.onDirtyChange?.(engine.dirty());
  });

  // ── Debounced LSP didChange ─────────────────────────────────────
  let didChangeTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const seq = engine.editSeq();
    const fp = props.filePath;
    if (!fp || seq === 0) return;
    clearTimeout(didChangeTimer);
    didChangeTimer = setTimeout(() => {
      const deltas = engine.takeEditDeltas();
      if (deltas === null || deltas.length === 0) {
        // Full-document sync (complex op, undo/redo, or no deltas)
        lspDidChange(fp, engine.getText(), seq).catch(() => {});
      } else {
        // Incremental sync with fallback
        lspDidChangeIncremental(fp, deltas, seq).catch(() => {
          lspDidChange(fp, engine.getText(), seq).catch(() => {});
        });
      }
    }, 300);
  });
  onCleanup(() => clearTimeout(didChangeTimer));

  // ── View state (not part of engine) ─────────────────────────────

  const [scrollTop, setScrollTop] = createSignal(0);
  const [canvasWidth, setCanvasWidth] = createSignal(800);
  const [canvasHeight, setCanvasHeight] = createSignal(600);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isFocused, setIsFocused] = createSignal(false);
  const [blameVisible, setBlameVisible] = createSignal(false);
  const [breakpointSet, setBreakpointSet] = createSignal<Set<number>>(new Set());
  const [blameData, setBlameData] = createSignal<GitBlameLine[] | null>(null);

  function toggleBlame() {
    const next = !blameVisible();
    setBlameVisible(next);
    if (next) {
      fetchBlame();
    } else {
      setBlameData(null);
    }
  }

  function fetchBlame() {
    const root = workspaceRoot();
    const fp = props.filePath;
    if (!root || !fp) return;
    gitBlame(root, fp).then(data => {
      if (blameVisible()) setBlameData(data);
    }).catch(() => setBlameData(null));
  }

  // ── Syntax highlights ───────────────────────────────────────────

  let cachedLineTokens: LineToken[][] = [];
  let highlightDirty = true;
  let highlightPending = false;

  function refreshHighlights() {
    const ls = engine.lines();
    const fp = engine.filePath();
    if (!fp || highlightPending || !highlightDirty) return;

    // Compute visible viewport for scoped highlighting
    const lh = lineHeight();
    const startLine = Math.max(0, Math.floor(scrollTop() / lh) - 5);
    const endLine = Math.min(ls.length - 1, Math.ceil((scrollTop() + canvasHeight()) / lh) + 5);

    highlightPending = true;
    highlightDirty = false;
    const source = ls.join("\n");
    requestHighlights(fp, source, startLine, endLine).then((spans) => {
      cachedLineTokens = spansToLineTokens(spans, ls);
      highlightPending = false;
    }).catch(() => { highlightPending = false; });
  }

  function clearHighlightCache() { highlightDirty = true; }

  // ── Layout helpers ──────────────────────────────────────────────

  const fontSize = () => props.fontSize ?? 14;
  const lineHeight = () => fontSize() + 8;
  const gutterW = () => {
    const base = (props.lineNumbers !== false) ? 50 : 0;
    return blameVisible() ? base + 180 : base;
  };
  const wordWrap = () => props.wordWrap !== false;
  const charW = () => getCharWidth(fontSize());

  function getDisplayRows() {
    return engine.computeDisplayRows(charW(), canvasWidth(), wordWrap(), gutterW());
  }

  // ── Scroll to cursor ────────────────────────────────────────────

  function ensureCursorVisible() {
    const row = engine.cursorDisplayRow(charW(), canvasWidth(), wordWrap(), gutterW());
    const cursorY = row * lineHeight();
    const viewTop = scrollTop();
    const viewBottom = viewTop + canvasHeight() - lineHeight();
    if (cursorY < viewTop) setScrollTop(cursorY);
    else if (cursorY > viewBottom) setScrollTop(cursorY - canvasHeight() + lineHeight() * 2);
  }

  // ── Subsystems (LSP-backed, still use IPC for their features) ──

  const ac = createAutocomplete({
    filePath: () => props.filePath ?? null,
    autocompleteEnabled: () => props.autocomplete !== false,
    cursorLine,
    cursorCol,
    lines: () => engine.lines(),
    updateCursor: (line: number, col: number) => engine.setCursor({ line, col }),
    insertText: (text: string) => engine.insert(text),
    setSelection: (aL: number, aC: number, hL: number, hC: number) =>
      engine.setSelection({ line: aL, col: aC }, { line: hL, col: hC }),
    resetCursorBlink: () => {},
    clearHighlightCache,
  });

  const hover = createHover({
    filePath: () => props.filePath ?? null,
    cursorLine,
    cursorCol,
    updateCursor: (line: number, col: number) => engine.setCursor({ line, col }),
    ensureCursorVisible,
    onGoToFile: props.onGoToFile,
  });

  const sigHelp = createSignatureHelp({
    filePath: () => props.filePath ?? null,
    cursorLine,
    cursorCol,
  });

  const codeActions = createCodeActions({
    filePath: () => props.filePath ?? null,
    cursorLine,
    cursorCol,
  });

  const ghost = createGhostText({
    filePath: () => props.filePath ?? null,
    cursorLine,
    cursorCol,
    content: () => {
      const ls = engine.lines();
      return { lines: ls, total_lines: ls.length, file_path: engine.filePath(), edit_seq: engine.editSeq() };
    },
  });

  const inlayHints = createInlayHints({
    filePath: () => props.filePath ?? null,
    scrollTop,
    canvasHeight,
    fontSize,
    editSeq: () => engine.editSeq(),
  });

  // ── Accessibility parallel DOM ─────────────────────────────────

  const a11y = createEditorA11y({
    lines: () => engine.lines(),
    cursor: () => engine.cursor(),
    editSeq: () => engine.editSeq(),
    scrollTop,
    canvasHeight,
    fontSize,
    filePath: () => props.filePath ?? null,
  });

  // ── IME ─────────────────────────────────────────────────────────

  let isComposing = false;

  // ── Mouse → position ────────────────────────────────────────────

  function posFromMouse(e: MouseEvent) {
    if (!containerRef) return { line: 0, col: 0 };
    const rect = containerRef.getBoundingClientRect();
    return engine.posFromPixel(
      e.clientX, e.clientY, rect, scrollTop(),
      fontSize(), props.lineNumbers !== false, wordWrap(), canvasWidth(),
    );
  }

  // ── Mouse handlers ──────────────────────────────────────────────

  function handleMouseDown(e: MouseEvent) {
    ac.dismiss();
    hover.dismiss();

    // Gutter interactions
    if (containerRef && props.lineNumbers !== false) {
      const rect = containerRef.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < 50) {
        const pos = posFromMouse(e);
        // Fold toggle (left edge, < 20px)
        if (x < 20 && engine.toggleFold(pos.line)) {
          e.preventDefault();
          clearHighlightCache();
          focusInput();
          return;
        }
        // Breakpoint toggle (click on line number area, 20-50px)
        if (x >= 20 && props.filePath) {
          e.preventDefault();
          import("../lib/ipc").then(({ debugToggleBreakpoint }) => {
            debugToggleBreakpoint(props.filePath!, pos.line).then(() => {
              // Refresh breakpoints from backend
              import("../lib/ipc").then(({ debugGetBreakpoints }) => {
                debugGetBreakpoints(props.filePath!).then(bps => {
                  setBreakpointSet(new Set(bps.map(bp => bp.line)));
                  scheduleRender();
                }).catch(() => showError("Failed to refresh breakpoints"));
              });
            }).catch(() => showError("Failed to toggle breakpoint"));
          });
          focusInput();
          return;
        }

        // Diagnostic gutter dot click — jump to the diagnostic
        const diag = props.diagnostics;
        if (diag && diag.length > 0) {
          const hit = diag.find(d => d.line === pos.line);
          if (hit) {
            e.preventDefault();
            engine.setCursor({ line: hit.line, col: hit.col });
            focusInput();
            return;
          }
        }
      }
    }

    const pos = posFromMouse(e);

    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      engine.setCursor(pos);
      hover.goToDefinition();
      focusInput();
      return;
    }

    if (e.altKey) {
      e.preventDefault();
      engine.addCursor(pos);
           focusInput();
      return;
    }

    engine.clearExtras();
    engine.setCursor(pos);
    engine.setSelection(pos, pos);
    setIsDragging(true);
       focusInput();
  }

  function handleMouseMove(e: MouseEvent) {
    if (isDragging()) {
      const pos = posFromMouse(e);
      const anchor = engine.sel()?.anchor ?? engine.cursor();
      engine.setSelection(anchor, pos);
      return;
    }
    const pos = posFromMouse(e);

    // Check if hovering over a gutter diagnostic dot
    if (containerRef && props.lineNumbers !== false) {
      const rect = containerRef.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < 50) {  // gutter width
        const diag = props.diagnostics;
        if (diag && diag.length > 0) {
          const gutterHit = diag.find(d => d.line === pos.line);
          if (gutterHit) {
            const prefix = gutterHit.severity === 1 ? "Error" : gutterHit.severity === 2 ? "Warning" : "Info";
            hover.showImmediate(`${prefix}: ${gutterHit.message}`, pos.line, 0);
            return;
          }
        }
      }
    }

    // Check if hovering over a diagnostic underline — show message as tooltip
    const diag = props.diagnostics;
    if (diag && diag.length > 0) {
      const hit = diag.find(d =>
        (pos.line > d.line || (pos.line === d.line && pos.col >= d.col)) &&
        (pos.line < d.endLine || (pos.line === d.endLine && pos.col <= d.endCol))
      );
      if (hit) {
        const prefix = hit.severity === 1 ? "Error" : hit.severity === 2 ? "Warning" : "Info";
        hover.showImmediate(`${prefix}: ${hit.message}`, pos.line, pos.col);
        return;
      }
    }

    hover.schedule(pos.line, pos.col);
  }

  function handleMouseUp() {
    setIsDragging(false);
    const s = engine.sel();
    if (s && s.anchor.line === s.head.line && s.anchor.col === s.head.col) {
      engine.clearSelection();
    }
  }

  // ── Keyboard handler ────────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent) {
    if (isComposing) return;

    // Vim mode intercept — returns true if Vim consumed the key
    if (vim.enabled() && vim.handleVimKey(e, engine, vimDeps)) {
      e.preventDefault();
      scheduleRender();
      return;
    }

    const isMod = e.metaKey || e.ctrlKey;

    // Autocomplete interception
    if (ac.completionVisible() && ac.completions().length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); ac.navigateDown(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); ac.navigateUp(); return; }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        // Accept completion — insert the label text
        ac.accept();
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); ac.dismiss(); return; }
    }

    if (e.ctrlKey && e.key === " ") { e.preventDefault(); ac.trigger(); return; }
    if (e.key === "F12") { e.preventDefault(); hover.goToDefinition(); return; }

    // Code action menu
    if (codeActions.menuVisible()) {
      if (e.key === "ArrowDown") { e.preventDefault(); codeActions.navigateDown(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); codeActions.navigateUp(); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const action = codeActions.selectedAction();
        if (action && action.edits.length > 0) {
          engine.clearExtras();
          engine.beginUndoGroup();

          // Sort edits back-to-front so earlier offsets stay valid
          const sorted = [...action.edits].sort((a, b) =>
            b.start_line !== a.start_line ? b.start_line - a.start_line : b.start_col - a.start_col
          );

          // Remember the first edit in document order for cursor placement
          const firstEdit = action.edits.reduce((a, b) =>
            a.start_line < b.start_line || (a.start_line === b.start_line && a.start_col < b.start_col) ? a : b
          );

          for (const edit of sorted) {
            engine.deleteRange(
              { line: edit.start_line, col: edit.start_col },
              { line: edit.end_line, col: edit.end_col },
            );
            if (edit.new_text) {
              engine.setCursor({ line: edit.start_line, col: edit.start_col });
              engine.insert(edit.new_text);
            }
          }

          // Place cursor at end of the first edit's new text
          const newTextLines = (firstEdit.new_text || "").split("\n");
          const endLine = firstEdit.start_line + newTextLines.length - 1;
          const endCol = newTextLines.length === 1
            ? firstEdit.start_col + newTextLines[0].length
            : newTextLines[newTextLines.length - 1].length;
          engine.setCursor({ line: endLine, col: endCol });

          engine.endUndoGroup();
          clearHighlightCache();
        }
        codeActions.dismiss();
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); codeActions.dismiss(); return; }
    }
    if (isMod && e.key === ".") { e.preventDefault(); codeActions.fetchActions().then(() => codeActions.showMenu()); return; }

    // Toggle blame view (Cmd/Ctrl+Shift+B)
    if (isMod && e.shiftKey && e.key === "B") { e.preventDefault(); toggleBlame(); return; }

    // Escape cascade
    if (e.key === "Escape") {
      if (ac.isInSnippet()) { e.preventDefault(); ac.exitSnippet(); return; }
      if (ghost.ghostText()) { e.preventDefault(); ghost.dismiss(); return; }
      if (sigHelp.signature()) { e.preventDefault(); sigHelp.dismiss(); return; }
      if (codeActions.menuVisible()) { e.preventDefault(); codeActions.dismiss(); return; }
      if (engine.hasMultiCursors()) { e.preventDefault(); engine.clearExtras(); return; }
    }

    // Undo
    if (isMod && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      engine.undo();
      a11y.announceUndo();
      clearHighlightCache();      return;
    }

    // Redo
    if ((isMod && e.key === "z" && e.shiftKey) || (isMod && e.key === "y")) {
      e.preventDefault();
      engine.redo();
      a11y.announceRedo();
      clearHighlightCache();      return;
    }

    // Select All
    if (isMod && e.key === "a") {
      e.preventDefault();
      engine.selectAll();
      return;
    }

    // Select next occurrence (Cmd+D)
    if (isMod && e.key === "d") {
      e.preventDefault();
      const sel = engine.getOrderedSelection();
      if (sel) {
        // Selection exists — find next occurrence of selected text
        const selectedText = engine.getTextRange(sel.from, sel.to);
        if (selectedText) {
          const ls = engine.lines();
          // Search from after current selection
          let found = false;
          for (let line = sel.to.line; line < ls.length && !found; line++) {
            const startCol = line === sel.to.line ? sel.to.col : 0;
            const idx = ls[line].indexOf(selectedText, startCol);
            if (idx !== -1) {
              engine.addCursor({ line, col: idx + selectedText.length });
              engine.setSelection(sel.from, sel.to); // keep original selection
              found = true;
            }
          }
          // Wrap around from beginning if not found
          if (!found) {
            for (let line = 0; line <= sel.from.line && !found; line++) {
              const endCol = line === sel.from.line ? sel.from.col : ls[line].length;
              const idx = ls[line].indexOf(selectedText);
              if (idx !== -1 && idx + selectedText.length <= endCol) {
                engine.addCursor({ line, col: idx + selectedText.length });
                found = true;
              }
            }
          }
        }
      } else {
        // No selection — select the word under cursor
        const word = engine.getWordUnderCursor();
        if (word) {
          const c = engine.cursor();
          const line = engine.getLine(c.line);
          let start = c.col;
          while (start > 0 && /\w/.test(line[start - 1])) start--;
          engine.setSelection({ line: c.line, col: start }, { line: c.line, col: start + word.length });
        }
      }
      return;
    }

    // Copy/Cut/Paste are handled by onCopy/onCut/onPaste on the textarea,
    // using e.clipboardData which works reliably in all Tauri contexts.

    // Toggle line comment (Cmd+/)
    if (isMod && e.key === "/") {
      e.preventDefault();
      const ext = props.filePath ? extname(props.filePath).slice(1) : "";
      const prefix = (ext === "py" || ext === "sh" || ext === "bash" || ext === "zsh" || ext === "yml" || ext === "yaml" || ext === "toml") ? "#"
        : (ext === "css") ? "//" // CSS uses /* */ but // is simpler for line toggle
        : "//";
      engine.toggleLineComment(prefix);
      clearHighlightCache();
      return;
    }

    // Duplicate line (Cmd+Shift+D)
    if (isMod && e.shiftKey && e.key === "D") {
      e.preventDefault();
      engine.duplicateLines();
      clearHighlightCache(); ensureCursorVisible();
      return;
    }

    // Join lines (Cmd+J)
    if (isMod && e.key === "j") {
      e.preventDefault();
      engine.joinLines();
      clearHighlightCache();
      return;
    }

    // Rename symbol (F2)
    if (e.key === "F2" && props.filePath) {
      e.preventDefault();
      const c = engine.cursor();
      const word = engine.getLine(c.line).slice(
        engine.getLine(c.line).slice(0, c.col).search(/\w+$/) ?? c.col,
        c.col + (engine.getLine(c.line).slice(c.col).match(/^\w+/)?.[0]?.length ?? 0)
      );
      const newName = prompt("Rename symbol:", word);
      if (newName && newName !== word) {
        import("../lib/ipc").then(({ lspRename }) => {
          lspRename(props.filePath!, c.line, c.col, newName).then(edits => {
            if (edits.length > 0) {
              // Apply edits for current file (bottom-up to keep positions valid)
              const fileEdits = edits
                .filter(e => e.file_path === props.filePath)
                .sort((a, b) => b.start_line !== a.start_line ? b.start_line - a.start_line : b.start_col - a.start_col);
              engine.beginUndoGroup();
              for (const edit of fileEdits) {
                engine.deleteRange(
                  { line: edit.start_line, col: edit.start_col },
                  { line: edit.end_line, col: edit.end_col }
                );
                engine.setCursor({ line: edit.start_line, col: edit.start_col });
                engine.insert(edit.new_text);
              }
              engine.endUndoGroup();
              clearHighlightCache();
            }
          }).catch(() => showError("Rename failed"));
        });
      }
      return;
    }

    // Find references (Shift+F12)
    if (e.key === "F12" && e.shiftKey && props.filePath) {
      e.preventDefault();
      const c = engine.cursor();
      import("../lib/ipc").then(({ lspReferences }) => {
        lspReferences(props.filePath!, c.line, c.col).then(locations => {
          if (locations.length > 0) {
            // Show in hover tooltip as a simple list
            const text = locations.map(l => {
              const name = basename(l.file_path) || l.file_path;
              return `${name}:${l.line + 1}:${l.col + 1}`;
            }).join("\n");
            hover.showImmediate(`${locations.length} references:\n${text}`, c.line, c.col);
          }
        }).catch(() => showError("Find references failed"));
      });
      return;
    }

    // Move line up (Alt+Up)
    if (e.altKey && !isMod && e.key === "ArrowUp") {
      e.preventDefault();
      engine.moveLines("up");
      clearHighlightCache(); ensureCursorVisible();
      return;
    }

    // Move line down (Alt+Down)
    if (e.altKey && !isMod && e.key === "ArrowDown") {
      e.preventDefault();
      engine.moveLines("down");
      clearHighlightCache(); ensureCursorVisible();
      return;
    }

    // Clear selection on most non-modifier, non-shift keys
    const isModifier = e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta";
    const extend = e.shiftKey && !isModifier;

    // Navigation — word/line/document level (modifier keys)
    const isMac = navigator.platform.startsWith("Mac");
    if (e.key === "ArrowLeft" && (e.altKey || (!isMac && e.ctrlKey))) {
      e.preventDefault(); ac.dismiss(); engine.moveWord("left", extend); return;
    } else if (e.key === "ArrowRight" && (e.altKey || (!isMac && e.ctrlKey))) {
      e.preventDefault(); ac.dismiss(); engine.moveWord("right", extend); return;
    } else if (e.key === "ArrowLeft" && e.metaKey) {
      e.preventDefault(); ac.dismiss(); engine.moveCursorToLineStart(); return;
    } else if (e.key === "ArrowRight" && e.metaKey) {
      e.preventDefault(); ac.dismiss(); engine.moveCursorToLineEnd(); return;
    } else if (e.key === "ArrowUp" && e.metaKey) {
      e.preventDefault(); ac.dismiss();
      engine.setCursor({ line: 0, col: 0 }); ensureCursorVisible(); return;
    } else if (e.key === "ArrowDown" && e.metaKey) {
      e.preventDefault(); ac.dismiss();
      const ls = engine.lines(); engine.setCursor({ line: ls.length - 1, col: ls[ls.length - 1].length });
      ensureCursorVisible(); return;
    }

    // Navigation — character level
    if (e.key === "ArrowLeft") {
      e.preventDefault(); ac.dismiss();
      engine.moveCursor("left", extend);
    } else if (e.key === "ArrowRight") {
      e.preventDefault(); ac.dismiss();
      engine.moveCursor("right", extend);
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); ac.dismiss();
      if (wordWrap()) {
        engine.moveCursorByDisplayRow("up", extend, charW(), canvasWidth(), true, gutterW());
      } else {
        engine.moveCursor("up", extend);
      }
      ensureCursorVisible();
    } else if (e.key === "ArrowDown") {
      e.preventDefault(); ac.dismiss();
      if (wordWrap()) {
        engine.moveCursorByDisplayRow("down", extend, charW(), canvasWidth(), true, gutterW());
      } else {
        engine.moveCursor("down", extend);
      }
      ensureCursorVisible();
    } else if (e.key === "Home") {
      e.preventDefault(); ac.dismiss();
      engine.moveCursorToLineStart();
    } else if (e.key === "End") {
      e.preventDefault(); ac.dismiss();
      engine.moveCursorToLineEnd();
    } else if (e.key === "PageDown") {
      e.preventDefault(); ac.dismiss();
      const pageRows = Math.max(1, Math.floor(canvasHeight() / lineHeight()) - 2);
      const c = engine.cursor();
      const maxLine = engine.lines().length - 1;
      engine.setCursor({ line: Math.min(c.line + pageRows, maxLine), col: c.col });
      ensureCursorVisible();
    } else if (e.key === "PageUp") {
      e.preventDefault(); ac.dismiss();
      const pageRows = Math.max(1, Math.floor(canvasHeight() / lineHeight()) - 2);
      const c = engine.cursor();
      engine.setCursor({ line: Math.max(c.line - pageRows, 0), col: c.col });
      ensureCursorVisible();
    } else if (e.key === "Backspace" && e.altKey) {
      e.preventDefault();
      if (hiddenInput) hiddenInput.value = "";
      engine.deleteWordBackward();
      clearHighlightCache(); ac.trigger();
         } else if (e.key === "Backspace") {
      e.preventDefault();
      if (hiddenInput) hiddenInput.value = "";
      // Auto-delete matching bracket/quote pair: backspace inside () removes both
      const bCur = engine.cursor();
      if (!engine.sel() && bCur.col > 0) {
        const bLine = engine.getLine(bCur.line);
        const charBefore = bLine[bCur.col - 1];
        const charAfter = bLine[bCur.col];
        if (charBefore && charAfter && BRACKET_PAIRS[charBefore] === charAfter) {
          engine.deleteRange({ line: bCur.line, col: bCur.col - 1 }, { line: bCur.line, col: bCur.col + 1 });
          clearHighlightCache(); ac.trigger();
          return;
        }
      }
      engine.backspace();
      clearHighlightCache(); ac.trigger();
    } else if (e.key === "Delete") {
      e.preventDefault(); ac.dismiss();
      if (hiddenInput) hiddenInput.value = "";
      engine.deleteForward();
      clearHighlightCache();
    } else if (e.key === "Enter") {
      e.preventDefault(); ac.dismiss();
      const cur = engine.cursor();
      const currentLine = engine.getLine(cur.line);
      const indent = currentLine.match(/^\s*/)![0];
      const charBefore = currentLine[cur.col - 1] ?? "";
      const charAfter = currentLine[cur.col] ?? "";

      // Smart indent: split braces {|} → {\n  |\n}
      if (charBefore === "{" && charAfter === "}") {
        const deeper = indent + indentUnit();
        engine.insert("\n" + deeper + "\n" + indent);
        // Move cursor to the middle line
        engine.setCursor({ line: cur.line + 1, col: deeper.length });
      }
      // Smart indent: split parens (|) and brackets [|]
      else if ((charBefore === "(" && charAfter === ")") || (charBefore === "[" && charAfter === "]")) {
        const deeper = indent + indentUnit();
        engine.insert("\n" + deeper + "\n" + indent);
        engine.setCursor({ line: cur.line + 1, col: deeper.length });
      }
      // Increase indent after { [ (
      else if ("{[(".includes(charBefore)) {
        engine.insert("\n" + indent + indentUnit());
      }
      // Normal auto-indent
      else {
        engine.insert("\n" + indent);
      }
      clearHighlightCache(); ensureCursorVisible();
    } else if (e.key === "Tab") {
      // When tab trapping is off (Ctrl+M), let Tab move focus naturally
      if (!tabTrapping()) return;
      e.preventDefault();
      // Advance snippet tab stops if in a snippet session
      if (!e.shiftKey && ac.isInSnippet()) {
        ac.advanceSnippet();
        return;
      }
      // Accept ghost text if visible
      const accepted = ghost.accept();
      if (accepted) {
        engine.insert(accepted);
        clearHighlightCache();        return;
      }
      if (e.shiftKey) {
        engine.outdentLines(store.settings.tab_size || 4);
      } else if (engine.sel()) {
        engine.indentLines(indentUnit());
      } else {
        engine.insert(indentUnit());
      }
      clearHighlightCache();    } else if (!isModifier && !isMod && !extend) {
      // Clear selection for regular character keys (they'll go through handleInput)
      engine.clearSelection();
    }
  }

  // ── Text input (synchronous — no race conditions!) ──────────────

  const BRACKET_PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
  const CLOSE_BRACKETS = new Set([")", "]", "}"]);

  function handleInput() {
    if (!hiddenInput || isComposing) return;
    const text = hiddenInput.value;
    if (!text) return;
    hiddenInput.value = "";

    // In Vim Normal/Visual mode, suppress text insertion
    if (vim.enabled() && vim.mode() !== "insert") return;

    // Emmet-style HTML boilerplate: typing "!" in an empty HTML file expands to full document
    if (text === "!" && props.filePath) {
      const ext = extname(props.filePath).toLowerCase();
      if ((ext === ".html" || ext === ".htm") && engine.lineCount() <= 1 && engine.getLine(0).trim() === "") {
        const unit = indentUnit();
        const boilerplate =
`<!DOCTYPE html>
<html lang="en">
<head>
${unit}<meta charset="UTF-8">
${unit}<meta name="viewport" content="width=device-width, initial-scale=1.0">
${unit}<title>Document</title>
</head>
<body>
${unit}
</body>
</html>`;
        engine.insert(boilerplate);
        // Place cursor inside <body> on the indented blank line
        engine.setCursor({ line: 8, col: unit.length });
        clearHighlightCache();
        return;
      }
    }

    // Auto-close brackets and quotes
    if (text.length === 1 && BRACKET_PAIRS[text]) {
      const closing = BRACKET_PAIRS[text];
      // For quotes, only auto-close if not already inside the same quote
      const isQuote = text === '"' || text === "'" || text === "`";
      const line = engine.getLine(engine.cursor().line);
      const col = engine.cursor().col;
      const charAfter = line[col] ?? "";

      if (isQuote) {
        // Skip over closing quote if next char matches
        if (charAfter === text) {
          engine.moveCursor("right");
          clearHighlightCache();
          return;
        }
      }

      // Skip over closing bracket if next char matches
      if (CLOSE_BRACKETS.has(text) && charAfter === text) {
        engine.moveCursor("right");
        clearHighlightCache();
        return;
      }

      // Auto-close: insert pair and move cursor back
      if (!isQuote || charAfter === "" || /[\s)\]},;]/.test(charAfter)) {
        engine.insert(text + closing);
        engine.moveCursor("left");
        clearHighlightCache();
        ac.trigger();
        if (text.length === 1) sigHelp.onChar(text);
        ghost.scheduleRequest();
        return;
      }
    }

    // Skip over closing bracket if typed explicitly
    if (text.length === 1 && CLOSE_BRACKETS.has(text)) {
      const line = engine.getLine(engine.cursor().line);
      const charAfter = line[engine.cursor().col] ?? "";
      if (charAfter === text) {
        engine.moveCursor("right");
        clearHighlightCache();
        return;
      }
    }

    // Auto-outdent: typing } on whitespace-only line reduces indent
    if (text === "}" || text === "]" || text === ")") {
      const cur = engine.cursor();
      const line = engine.getLine(cur.line);
      if (/^\s*$/.test(line.slice(0, cur.col))) {
        const unit = indentUnit();
        const currentIndent = line.match(/^\s*/)![0];
        if (currentIndent.length >= unit.length) {
          const newIndent = currentIndent.slice(unit.length);
          engine.deleteRange({ line: cur.line, col: 0 }, { line: cur.line, col: currentIndent.length });
          engine.setCursor({ line: cur.line, col: 0 });
          engine.insert(newIndent + text);
          clearHighlightCache();
          ac.trigger();
          sigHelp.onChar(text);
          ghost.scheduleRequest();
          return;
        }
      }
    }

    engine.insert(text);
    clearHighlightCache();
    ac.trigger();
    if (text.length === 1) sigHelp.onChar(text);
    ghost.scheduleRequest();
  }

  // ── Scroll (batched per frame to prevent event accumulation) ────

  let pendingScrollDelta = 0;
  let scrollRafId = 0;

  function flushScroll() {
    scrollRafId = 0;
    if (pendingScrollDelta === 0) return;
    const delta = pendingScrollDelta;
    pendingScrollDelta = 0;
    const rows = getDisplayRows();
    const totalHeight = rows.length * lineHeight();
    const maxScroll = Math.max(0, totalHeight - canvasHeight() + lineHeight());
    setScrollTop(Math.max(0, Math.min(scrollTop() + delta, maxScroll)));
  }

  /** Apply a wheel delta to THIS editor's scroll state. Registered with
   *  `activeScrollTarget` when this panel is active, so every wheel event
   *  in the app (regardless of cursor position) lands here. */
  function applyScroll(deltaY: number) {
    pendingScrollDelta += deltaY;
    if (!scrollRafId) {
      scrollRafId = requestAnimationFrame(flushScroll);
    }
  }

  function handleScroll(e: WheelEvent) {
    e.preventDefault();
    // Route to whichever editor is currently the active panel, not to
    // whichever panel the cursor happens to be over. Null = no active
    // editor registered (e.g., welcome screen).
    activeScrollTarget.apply?.(e.deltaY);
  }

  // Register/unregister as the active scroll target based on props.active.
  // Also focus the hidden input so keyboard events are captured.
  createEffect(() => {
    if (props.active !== false) {
      activeScrollTarget.apply = applyScroll;
      requestAnimationFrame(() => focusInput());
    } else if (activeScrollTarget.apply === applyScroll) {
      activeScrollTarget.apply = null;
    }
  });

  // ── On-demand rendering (no permanent rAF loop) ────────────────

  let renderScheduled = false;

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    animFrameId = requestAnimationFrame(doRender);
  }

  function doRender() {
    renderScheduled = false;
    if (!canvasRef) return;
    // Skip rendering when panel is hidden — canvas retains its last frame
    if (props.active === false) return;

    refreshHighlights();
    inlayHints.requestHints();

    const currentPalette = palette();
    setSyntaxPalette(currentPalette);

    const sel = engine.sel();
    const w = canvasWidth();
    const h = canvasHeight();
    const st = scrollTop();
    const sm = props.searchMatches ?? [];
    const diag = props.diagnostics ?? [];
    const dh = props.diffHunks ?? [];
    const bd = blameData();

    renderEditor(canvasRef, {
      width: w,
      height: h,
      scrollTop: st,
      lines: engine.lines(),
      fontSize: fontSize(),
      lineNumbers: props.lineNumbers !== false,
      wordWrap: wordWrap(),
      cursors: engine.getCursors(),
      cursorVisible: isFocused(),
      selStart: sel?.anchor ?? null,
      selEnd: sel?.head ?? null,
      searchMatches: sm,
      currentSearchIdx: props.currentSearchIdx ?? -1,
      diagnostics: diag,
      lineTokens: cachedLineTokens,
      completionVisible: ac.completionVisible(),
      completionItems: ac.completions(),
      completionIdx: ac.completionIdx(),
      hoverText: hover.hoverText(),
      hoverPos: hover.hoverPos(),
      hasBuffer: true,
      signatureHelp: sigHelp.signature(),
      codeActionLine: codeActions.actionLine(),
      codeActionMenuVisible: codeActions.menuVisible(),
      codeActionItems: codeActions.actions(),
      codeActionIdx: codeActions.menuIdx(),
      palette: currentPalette,
      phantomTexts: [...ghost.getPhantomTexts(), ...inlayHints.getPhantomTexts()],
      diffHunks: dh,
      blameData: bd,
      minimap: props.minimap ?? false,
      bracketMatch: engine.findMatchingBracket(),
      foldedLines: engine.foldedLines(),
      foldStartLines: new Set(engine.lines().map((_, i) => i).filter(i => engine.isFolded(i))),
      isFoldable: (line: number) => engine.isFoldable(line),
      breakpointLines: breakpointSet(),
      cursorStyle: vim.enabled() && vim.mode() !== "insert" ? "block" : "line",
      gpu: gpuCtx,
    });
  }

  // ── Resize (debounced) ──────────────────────────────────────────

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const RESIZE_DEBOUNCE_MS = 60;

  function handleResize() {
    if (!containerRef) return;
    const w = containerRef.clientWidth;
    const h = containerRef.clientHeight;
    // Ignore zero-size measurements (display: none)
    if (w === 0 || h === 0) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!containerRef) return;
      const fw = containerRef.clientWidth;
      const fh = containerRef.clientHeight;
      if (fw === 0 || fh === 0) return;
      setCanvasWidth(fw);
      setCanvasHeight(fh);
    }, RESIZE_DEBOUNCE_MS);
  }

  // ── Focus ───────────────────────────────────────────────────────

  function focusInput() {
    if (hiddenInput && document.activeElement !== hiddenInput) {
      hiddenInput.focus({ preventScroll: true });
    }
  }

  // ── Reactive render scheduling ──────────────────────────────────
  // Touch all render-affecting signals so SolidJS tracks them as dependencies.
  // Any change triggers a single scheduleRender().
  createEffect(() => {
    engine.cursor();
    engine.sel();
    engine.editSeq();
    engine.lines();
    scrollTop();
    canvasWidth();
    canvasHeight();
    isFocused();
    isDragging();
    ac.completionVisible();
    ac.completionIdx();
    hover.hoverText();
    codeActions.menuVisible();
    codeActions.menuIdx();
    ghost.getPhantomTexts();
    inlayHints.getPhantomTexts();
    blameData();
    palette();
    props.searchMatches;
    props.diagnostics;
    props.diffHunks;
    props.fontSize;
    props.lineNumbers;
    props.wordWrap;
    scheduleRender();
  });

  // ── Lifecycle ───────────────────────────────────────────────────

  onMount(() => {
    handleResize();
    const resizeObserver = new ResizeObserver(handleResize);
    if (containerRef) resizeObserver.observe(containerRef);

    // Open document for incremental syntax highlighting
    const fp = props.filePath;
    if (fp) {
      syntaxOpen(fp, engine.lines().join("\n"));
    }

    // Initialize per-instance GPU text renderer (falls back to Canvas 2D
    // if WebGL unavailable). Each CanvasEditor owns its own context — this
    // is what lets split-panel layouts render two files without clobbering.
    gpuCtx = WebGLTextContext.tryCreate(fontSize(), FONT_FAMILY);
    if (gpuCtx && containerRef) {
      containerRef.appendChild(gpuCtx.canvas);
    }

    scheduleRender();
    if (props.autoFocus) {
      requestAnimationFrame(() => focusInput());
    }

    onCleanup(() => {
      cancelAnimationFrame(animFrameId);
      cancelAnimationFrame(scrollRafId);
      clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      a11y.cleanup();
      if (activeScrollTarget.apply === applyScroll) activeScrollTarget.apply = null;
      // Close document syntax tree
      if (fp) syntaxClose(fp);
      // Clean up GPU text renderer
      gpuCtx?.dispose();
      gpuCtx = null;
    });
  });

  // ── Context menu ─────────────────────────────────────────────────

  const [editorCtxMenu, setEditorCtxMenu] = createSignal<ContextMenuState | null>(null);

  function handleEditorContextMenu(e: MouseEvent) {
    e.preventDefault();
    const hasSel = !!engine.getOrderedSelection();
    setEditorCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Cut", action: () => {
          const sel = engine.getOrderedSelection();
          if (sel) { clipboardWrite(engine.getTextRange(sel.from, sel.to)); engine.deleteRange(sel.from, sel.to); }
        }, disabled: !hasSel },
        { label: "Copy", action: () => {
          const sel = engine.getOrderedSelection();
          if (sel) clipboardWrite(engine.getTextRange(sel.from, sel.to));
        }, disabled: !hasSel },
        { label: "Paste", action: () => { clipboardRead().then(t => { if (t) engine.insert(t); }); } },
        { separator: true },
        { label: "Select All", action: () => engine.selectAll() },
      ],
    });
  }

  // ── JSX ─────────────────────────────────────────────────────────

  return (
    <CanvasSurface
      containerRef={(el) => { containerRef = el; }}
      class="canvas-editor"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleScroll}
      onClick={focusInput}
      onContextMenu={handleEditorContextMenu}
      canvasRef={(el) => { canvasRef = el; }}
      inputRef={(el) => { hiddenInput = el; }}
      a11y={<a11y.ParallelDOM />}
      textareaProps={{
        role: "textbox",
        "aria-label": `Code editor${props.filePath ? `: ${basename(props.filePath)}` : ""}`,
        "aria-multiline": "true",
        onKeyDown: handleKeyDown,
        onInput: handleInput,
        onCopy: (e: ClipboardEvent) => {
          const sel = engine.getOrderedSelection();
          if (sel) {
            e.preventDefault();
            const text = engine.getTextRange(sel.from, sel.to);
            e.clipboardData?.setData("text/plain", text);
            clipboardWrite(text);
          }
        },
        onCut: (e: ClipboardEvent) => {
          const sel = engine.getOrderedSelection();
          if (sel) {
            e.preventDefault();
            const text = engine.getTextRange(sel.from, sel.to);
            e.clipboardData?.setData("text/plain", text);
            clipboardWrite(text);
            engine.deleteRange(sel.from, sel.to);
            clearHighlightCache();
          }
        },
        onPaste: (e: ClipboardEvent) => {
          e.preventDefault();
          const text = e.clipboardData?.getData("text/plain");
          if (text) {
            engine.insert(text);
            clearHighlightCache();
          }
        },
        onFocus: () => setIsFocused(true),
        onBlur: () => setIsFocused(false),
        onCompositionStart: () => { isComposing = true; },
        onCompositionEnd: () => { isComposing = false; handleInput(); },
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: false,
        tabIndex: 0,
        "data-tab-focus-target": "true",
      }}
    >
      <ContextMenu menu={editorCtxMenu()} onClose={() => setEditorCtxMenu(null)} />
    </CanvasSurface>
  );
};

export default CanvasEditor;
