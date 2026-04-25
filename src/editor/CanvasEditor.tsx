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
import { handleEditorKeyDown, type KeyboardDeps } from "./editor-keyboard";
import { handleEditorMouseDown, handleEditorMouseMove, handleEditorMouseUp, type MouseDeps } from "./editor-mouse";
import { handleEditorInput, type InputDeps } from "./editor-input";
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
  languagePath?: () => string | null;
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
  const languagePath = () => props.languagePath?.() ?? props.filePath ?? null;
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
    const fp = engine.filePath() ?? languagePath();
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
    pushNavHistory: (path, line, col) => actions.pushNavHistory(path, line, col),
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

  // ── Delegated mouse/keyboard/input handlers ─────────────────────

  const mouseDeps: MouseDeps = {
    engine, ac, hover,
    containerRef: () => containerRef,
    filePath: () => props.filePath ?? null,
    lineNumbers: () => props.lineNumbers !== false,
    wordWrap, canvasWidth, scrollTop, fontSize,
    isDragging, setIsDragging,
    diagnostics: () => props.diagnostics ?? [],
    setBreakpointSet,
    clearHighlightCache, focusInput, scheduleRender,
  };

  const keyboardDeps: KeyboardDeps = {
    engine, vim, vimDeps, ac, hover, sigHelp, codeActions, ghost, a11y,
    filePath: () => props.filePath ?? null,
    languagePath,
    wordWrap, charW, canvasWidth, canvasHeight,
    gutterW, lineHeight,
    tabTrapping, indentUnit,
    settings: () => store.settings,
    clearHighlightCache, ensureCursorVisible, scheduleRender, focusInput,
    hiddenInput: () => hiddenInput,
    isComposing: () => isComposing,
  };

  const inputDeps: InputDeps = {
    engine, vim, ac, sigHelp, ghost,
    filePath: () => props.filePath ?? null,
    languagePath,
    hiddenInput: () => hiddenInput,
    isComposing: () => isComposing,
    indentUnit, clearHighlightCache,
  };

  function handleMouseDown(e: MouseEvent) { handleEditorMouseDown(e, mouseDeps); }
  function handleMouseMove(e: MouseEvent) { handleEditorMouseMove(e, mouseDeps); }
  function handleMouseUp() { handleEditorMouseUp(mouseDeps); }

  function handleKeyDown(e: KeyboardEvent) {
    // Toggle blame (Cmd+Shift+B) — handled here since it uses local state
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "B") {
      e.preventDefault(); toggleBlame(); return;
    }
    handleEditorKeyDown(e, keyboardDeps);
  }

  function handleInput() { handleEditorInput(inputDeps); }

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
    // Scroll past end: allow the last line to sit near the top of the viewport
    const maxScroll = Math.max(0, totalHeight - lineHeight());
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
      tabSize: store.settings.tab_size || 4,
      showIndentGuides: store.settings.show_indent_guides ?? true,
      showWhitespace: store.settings.show_whitespace ?? false,
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
    languagePath();
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
      // Clean up GPU text renderer — loseContext() first to release the
      // macOS GPU layer cleanly, preventing CFRelease(NULL) crash.
      if (gpuCtx) {
        const lc = gpuCtx.canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context");
        if (lc) lc.loseContext();
        gpuCtx = null;
      }
    });
  });

  // ── Context menu ─────────────────────────────────────────────────

  const [editorCtxMenu, setEditorCtxMenu] = createSignal<ContextMenuState | null>(null);

  function handleEditorContextMenu(e: MouseEvent) {
    e.preventDefault();
    const hasSel = !!engine.getOrderedSelection();
    const hasLsp = !!props.filePath;
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
        { label: "Go to Definition", action: () => { hover.goToDefinition(); }, disabled: !hasLsp },
        { label: "Go to Type Definition", action: () => { hover.goToTypeDefinition(); }, disabled: !hasLsp },
        { label: "Find References", action: () => {
          if (!props.filePath) return;
          const c = engine.cursor();
          import("../lib/ipc").then(({ lspReferences }) => {
            lspReferences(props.filePath!, c.line, c.col).then(locations => {
              if (locations.length > 0) {
                const text = locations.map(l => {
                  const name = basename(l.file_path) || l.file_path;
                  return `${name}:${l.line + 1}:${l.col + 1}`;
                }).join("\n");
                hover.showImmediate(`${locations.length} references:\n${text}`, c.line, c.col);
              }
            }).catch(() => showError("Find references failed"));
          });
        }, disabled: !hasLsp },
        { label: "Rename Symbol", action: () => {
          if (!props.filePath) return;
          const c = engine.cursor();
          const line = engine.getLine(c.line);
          const wordStart = line.slice(0, c.col).search(/\w+$/) ?? c.col;
          const wordEnd = c.col + (line.slice(c.col).match(/^\w+/)?.[0]?.length ?? 0);
          const word = line.slice(wordStart, wordEnd);
          const newName = prompt("Rename symbol:", word);
          if (newName && newName !== word) {
            import("../lib/ipc").then(({ lspRename }) => {
              lspRename(props.filePath!, c.line, c.col, newName).then(edits => {
                if (edits.length > 0) {
                  const fileEdits = edits
                    .filter(e => e.file_path === props.filePath)
                    .sort((a, b) => b.start_line !== a.start_line ? b.start_line - a.start_line : b.start_col - a.start_col);
                  engine.beginUndoGroup();
                  for (const edit of fileEdits) {
                    engine.deleteRange({ line: edit.start_line, col: edit.start_col }, { line: edit.end_line, col: edit.end_col });
                    engine.setCursor({ line: edit.start_line, col: edit.start_col });
                    engine.insert(edit.new_text);
                  }
                  engine.endUndoGroup();
                }
              }).catch(() => showError("Rename failed"));
            });
          }
        }, disabled: !hasLsp },
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
            const pasteLines = text.split("\n");
            if (pasteLines.length > 1) {
              // Auto-indent: adjust pasted lines to match cursor context
              const curLine = engine.getLine(engine.cursor().line);
              const targetIndent = curLine.match(/^\s*/)![0];
              // Find the common indent of the pasted text (skip first line)
              let minIndent = Infinity;
              for (let i = 1; i < pasteLines.length; i++) {
                if (pasteLines[i].trim().length === 0) continue;
                const spaces = pasteLines[i].match(/^\s*/)![0].length;
                if (spaces < minIndent) minIndent = spaces;
              }
              if (minIndent === Infinity) minIndent = 0;
              // Re-indent lines 1+ relative to target
              const adjusted = [pasteLines[0]];
              for (let i = 1; i < pasteLines.length; i++) {
                const stripped = pasteLines[i].slice(minIndent);
                adjusted.push(targetIndent + stripped);
              }
              engine.insert(adjusted.join("\n"));
            } else {
              engine.insert(text);
            }
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
