import { Component, onMount, onCleanup, createSignal, createEffect, createMemo, batch, untrack } from "solid-js";
import type { SearchMatch, DiffHunk, GitBlameLine } from "../lib/ipc";
import { gitBlame } from "../lib/ipc";
import { createEditorEngine, getCharWidth, type EditorEngine } from "./engine";
import { FONT_FAMILY, colToPixel } from "./text-measure";
import { PADDING_LEFT, type DisplayRow } from "./engine-text-ops";
import { captureWritingScroll, restoreWritingScroll, clampWritingScroll, isMarkdownPath } from "./writing-viewport";
import { writingPalette, writingPulse, writingTypography } from "./writing-effects";
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
import { handleEditorKeyDown, type KeyboardDeps } from "./editor-keyboard";
import { createRenameHandler } from "./editor-rename";
import { handleEditorMouseDown, handleEditorMouseMove, handleEditorMouseUp, type MouseDeps } from "./editor-mouse";
import { handleEditorInput, type InputDeps } from "./editor-input";
import CanvasSurface from "../ui/CanvasSurface";
import { clipboardWrite, clipboardRead } from "../lib/clipboard";
import { basename } from "buster-path";
import { lspDidChange, lspDidChangeIncremental } from "../lib/ipc";
import { useBuster } from "../lib/buster-context";
import { showError } from "../lib/notify";
import ContextMenu, { type ContextMenuState } from "../ui/ContextMenu";
import { resolveEditorSettings } from "../lib/editor-settings";
import SelectionActions from "./SelectionActions";

// ─── Props ──────────────────────────────────────────────────────────

interface CanvasEditorProps {
  tabId: string;
  initialText: string;
  initialDirty?: boolean;
  initialSelection?: import("./engine").Selection | null;
  initialCursor?: { line: number; col: number };
  initialScrollTop?: number;
  onScrollChange?: (top: number) => void;
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
  const { store, actions, appearance } = useBuster();
  const palette = () => store.palette;
  const workspaceRoot = () => store.workspaceRoot;
  const tabTrapping = () => store.tabTrapping;
  const languagePath = () => props.languagePath?.() ?? props.filePath ?? null;
  const writingStyle = createMemo(() => isMarkdownPath(languagePath())
    ? appearance.forPane(store.paneWorkspace.panes.find(pane => pane.tabId === props.tabId)?.id) : null);
  const [reducedMotion, setReducedMotion] = createSignal(false);
  const motionEnabled = () => !reducedMotion() && writingStyle()?.motion !== false;
  let pulseStarted: number | null = null;
  const editorSettings = () => resolveEditorSettings(store.settings, languagePath());
  let canvasRef: HTMLCanvasElement | undefined;
  let hiddenInput: HTMLTextAreaElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let animFrameId: number;
  let gpuCtx: WebGLTextContext | null = null;
  // ── Engine ──────────────────────────────────────────────────────

  const engine = createEditorEngine(props.initialText, props.filePath ?? undefined);
  if (props.initialDirty) engine.markDirty();
  if (props.initialCursor) engine.setCursor(props.initialCursor);
  if (props.initialSelection) engine.setSelection(props.initialSelection.anchor, props.initialSelection.head);

  /** Return the whitespace string for one indent level (respects tab_size and use_spaces settings). */
  function indentUnit(): string {
    const settings = editorSettings();
    return settings.use_spaces ? " ".repeat(settings.tab_size) : "\t";
  }

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

  const [scrollTop, setScrollTop] = createSignal(props.initialScrollTop ?? 0);
  createEffect(() => props.onScrollChange?.(scrollTop()));
  const [canvasWidth, setCanvasWidth] = createSignal(800);
  const [canvasHeight, setCanvasHeight] = createSignal(600);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isFocused, setIsFocused] = createSignal(false);
  const [blameVisible, setBlameVisible] = createSignal(false);
  const [blameData, setBlameData] = createSignal<GitBlameLine[] | null>(null);
  const [errorPeekLine, setErrorPeekLine] = createSignal<number | null>(null);

  function toggleErrorPeek() {
    const cur = errorPeekLine();
    const line = engine.cursor().line;
    if (cur === line) {
      setErrorPeekLine(null); // toggle off
    } else {
      // Check if there are diagnostics on this line
      const diags = props.diagnostics ?? [];
      if (diags.some(d => d.line === line)) {
        setErrorPeekLine(line);
      }
    }
  }

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

  const typography = createMemo(() => writingTypography(writingStyle(), props.fontSize ?? 14));
  const fontSize = () => typography().fontSize;
  const lineHeight = () => typography().lineHeight;
  const gutterW = () => {
    const base = (props.lineNumbers !== false) ? 50 : 0;
    return blameVisible() ? base + 180 : base;
  };
  const wordWrap = () => props.wordWrap !== false;
  const charW = () => {
    store.settings.font_family;
    return getCharWidth(fontSize());
  };

  function getDisplayRows() {
    return engine.computeDisplayRows(charW(), canvasWidth(), wordWrap(), gutterW());
  }

  // ── Scroll to cursor ────────────────────────────────────────────

  function ensureCursorVisible() {
    const row = engine.cursorDisplayRow(charW(), canvasWidth(), wordWrap(), gutterW());
    const cursorY = row * lineHeight();
    const viewTop = scrollTop();
    const viewBottom = viewTop + canvasHeight() - lineHeight();
    if (cursorY < viewTop) smoothScrollTo(cursorY);
    else if (cursorY > viewBottom) smoothScrollTo(cursorY - canvasHeight() + lineHeight() * 2);
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
    settings: () => store.settings,
  });

  const inlayHints = createInlayHints({
    filePath: () => props.filePath ?? null,
    scrollTop,
    canvasHeight,
    fontSize,
    lineHeight,
    editSeq: () => engine.editSeq(),
  });

  // ── Inline rename ──────────────────────────────────────────────
  const rename = createRenameHandler({
    filePath: () => props.filePath ?? null,
    engine,
    clearHighlightCache,
  });

  // ── Accessibility parallel DOM ─────────────────────────────────

  const a11y = createEditorA11y({
    lines: () => engine.lines(),
    cursor: () => engine.cursor(),
    editSeq: () => engine.editSeq(),
    scrollTop,
    canvasHeight,
    fontSize,
    lineHeight,
    filePath: () => props.filePath ?? null,
  });

  // ── IME ─────────────────────────────────────────────────────────

  let isComposing = false;
  const [composing, setComposing] = createSignal(false);

  // ── Delegated mouse/keyboard/input handlers ─────────────────────

  const mouseDeps: MouseDeps = {
    engine, ac, hover,
    containerRef: () => containerRef,
    filePath: () => props.filePath ?? null,
    lineNumbers: () => props.lineNumbers !== false,
    wordWrap,
    minimap: () => props.minimap ?? false,
    canvasWidth, canvasHeight, scrollTop, fontSize, lineHeight, charW, gutterW,
    isDragging, setIsDragging,
    diagnostics: () => props.diagnostics ?? [],
    clearHighlightCache, focusInput, scheduleRender,
    scrollTo: smoothScrollTo,
  };

  const keyboardDeps: KeyboardDeps = {
    engine, ac, hover, sigHelp, codeActions, ghost, a11y,
    filePath: () => props.filePath ?? null,
    languagePath,
    wordWrap, charW, canvasWidth, canvasHeight,
    gutterW, lineHeight,
    tabTrapping, indentUnit,
    settings: () => store.settings,
    clearHighlightCache, ensureCursorVisible, scheduleRender, focusInput,
    hiddenInput: () => hiddenInput,
    isComposing: () => isComposing,
    startRename: () => rename.start(),
  };

  const inputDeps: InputDeps = {
    engine, ac, sigHelp, ghost,
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
    if (isComposing || e.isComposing || e.keyCode === 229) return;
    // Toggle blame (Cmd+Shift+B) — handled here since it uses local state
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "B") {
      e.preventDefault(); toggleBlame(); return;
    }
    // Toggle error peek (Cmd+Shift+M) — inline diagnostic detail
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "M") {
      e.preventDefault(); toggleErrorPeek(); scheduleRender(); return;
    }
    // Inline rename intercepts all keys while active
    if (rename.renameState()?.active && rename.handleKey(e)) {
      e.preventDefault(); scheduleRender(); return;
    }
    const before = engine.editSeq();
    handleEditorKeyDown(e, keyboardDeps);
    if (engine.editSeq() !== before) startTypingPulse();
  }

  function startTypingPulse() {
    if (props.active === false || !motionEnabled() || !writingStyle()?.typingPulse) return;
    pulseStarted = performance.now();
    scheduleRender();
  }

  function handleInput() {
    const before = engine.editSeq();
    handleEditorInput(inputDeps);
    if (engine.editSeq() !== before) { ensureCursorVisible(); startTypingPulse(); }
  }

  // ── Smooth scroll animation ─────────────────────────────────────

  let scrollTarget = props.initialScrollTop ?? 0; // where we're animating toward
  let scrollAnimId = 0;    // rAF handle for the animation loop
  const SCROLL_EASE = 0.25; // fraction of remaining distance per frame (~4 frames to settle)
  const SCROLL_SNAP = 0.5;  // snap to target when within this many pixels

  function getMaxScroll(): number {
    const rows = getDisplayRows();
    return clampWritingScroll(Infinity, rows.length, lineHeight());
  }

  function clampScroll(v: number): number {
    return Math.max(0, Math.min(v, getMaxScroll()));
  }

  function animateScroll() {
    const current = scrollTop();
    const diff = scrollTarget - current;
    if (Math.abs(diff) < SCROLL_SNAP) {
      setScrollTop(scrollTarget);
      scrollAnimId = 0;
      return;
    }
    setScrollTop(current + diff * SCROLL_EASE);
    scrollAnimId = requestAnimationFrame(animateScroll);
  }

  function smoothScrollTo(target: number) {
    scrollTarget = clampScroll(target);
    if (!motionEnabled()) {
      cancelAnimationFrame(scrollAnimId);
      scrollAnimId = 0;
      setScrollTop(scrollTarget);
      return;
    }
    if (!scrollAnimId) {
      scrollAnimId = requestAnimationFrame(animateScroll);
    }
  }

  /** Apply a wheel delta to THIS editor's scroll state. */
  function applyScroll(deltaY: number) {
    // Accumulate on top of the current target (not current position)
    // so rapid wheel events feel responsive
    smoothScrollTo(scrollTarget + deltaY);
  }

  function handleScroll(e: WheelEvent) {
    e.preventDefault();
    // Route to whichever editor is currently the active panel, not to
    // whichever panel the cursor happens to be over. Null = no active
    // editor registered (e.g., welcome screen).
    activeScrollTarget.apply?.(e.deltaY);
  }

  // Preserve the passage being read as the DOM viewport changes width. Never
  // seek the caret here: it may intentionally be far outside the visible page.
  let previousLayout: { width: number; height: number; lineHeight: number; charWidth: number; gutter: number; wrap: boolean; rows: DisplayRow[] } | undefined;
  createEffect(() => {
    engine.editSeq();
    engine.foldSeq();
    const next = { width: canvasWidth(), height: canvasHeight(), lineHeight: lineHeight(), charWidth: charW(), gutter: gutterW(), wrap: wordWrap(), rows: getDisplayRows() };
    untrack(() => {
      const old = previousLayout;
      const layoutChanged = old && (old.width !== next.width || old.height !== next.height || old.lineHeight !== next.lineHeight || old.charWidth !== next.charWidth || old.gutter !== next.gutter || old.wrap !== next.wrap);
      const top = layoutChanged
        ? restoreWritingScroll(next.rows, captureWritingScroll(old.rows, scrollTop(), old.lineHeight), next.lineHeight)
        : clampWritingScroll(scrollTop(), next.rows.length, next.lineHeight);
      if (layoutChanged || top !== scrollTop()) {
        cancelAnimationFrame(scrollAnimId);
        scrollAnimId = 0;
        scrollTarget = top;
        setScrollTop(top);
      } else {
        scrollTarget = clampWritingScroll(scrollTarget, next.rows.length, next.lineHeight);
      }
      previousLayout = next;
    });
  });

  createEffect(() => {
    if (props.active === false || !motionEnabled() || !writingStyle()?.typingPulse) pulseStarted = null;
    if (!motionEnabled() && scrollAnimId) {
      cancelAnimationFrame(scrollAnimId);
      scrollAnimId = 0;
      setScrollTop(scrollTarget);
    }
  });

  createEffect(() => {
    palette();
    writingStyle()?.background;
    writingStyle()?.focusDim;
    // Palette previews may introduce many colored glyph variants. Discard old
    // variants instead of allowing the bounded GPU atlas to fill over time.
    gpuCtx?.invalidateColors();
  });

  // Register/unregister as the active scroll target based on props.active.
  // Also focus the hidden input so keyboard events are captured.
  createEffect(() => {
    if (props.active !== false) {
      activeScrollTarget.apply = applyScroll;
      queueMicrotask(() => { if (props.active !== false) focusInput(); });
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
    if (!containerRef || containerRef.clientWidth === 0 || containerRef.clientHeight === 0) return;

    refreshHighlights();
    inlayHints.requestHints();

    const style = writingStyle();
    const currentPalette = style ? writingPalette(palette(), style) : palette();
    // Token caches remain in the shared app theme; writing palettes adapt colors
    // during drawing, without changing another pane's syntax palette.
    setSyntaxPalette(palette());
    const pulse = style ? writingPulse(performance.now(), pulseStarted, style.effectDuration, style.typingPulse,
      motionEnabled() && props.active !== false && isFocused()) : 0;

    const sel = engine.sel();
    const w = canvasWidth();
    const h = canvasHeight();
    const st = scrollTop();
    const sm = props.searchMatches ?? [];
    const diag = props.diagnostics ?? [];
    const dh = props.diffHunks ?? [];
    const bd = blameData();

    if (hiddenInput) {
      // WebKit positions native composition UI from the actual textarea. Keep
      // that input at the canvas caret, relative to the same inset container.
      const rowIndex = engine.cursorDisplayRow(charW(), w, wordWrap(), gutterW());
      const row = getDisplayRows()[rowIndex];
      const x = row ? gutterW() + PADDING_LEFT + colToPixel(row.text, engine.cursor().col - row.startCol, charW()) : 0;
      hiddenInput.style.left = `${Math.max(0, Math.min(w - 1, x))}px`;
      hiddenInput.style.top = `${Math.max(0, Math.min(h - lineHeight(), rowIndex * lineHeight() - st))}px`;
      hiddenInput.style.height = `${lineHeight()}px`;
      hiddenInput.style.fontSize = `${fontSize()}px`;
    }

    renderEditor(canvasRef, {
      width: w,
      height: h,
      scrollTop: st,
      lines: engine.lines(),
      fontSize: fontSize(),
      lineHeight: lineHeight(),
      writingStyle: style ? { focusDim: style.focusDim, contrast: style.background !== "theme", pulse } : undefined,
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
      cursorStyle: "line",
      gpu: gpuCtx,
      tabSize: editorSettings().tab_size,
      showIndentGuides: store.settings.show_indent_guides ?? true,
      showWhitespace: store.settings.show_whitespace ?? false,
      renameState: rename.renameState(),
      errorPeekLine: errorPeekLine(),
    });
    if (pulse > 0) scheduleRender();
    else pulseStarted = null;
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
      batch(() => {
        setCanvasWidth(fw);
        setCanvasHeight(fh);
      });
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
    engine.foldSeq();
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
    rename.renameState();
    errorPeekLine();
    palette();
    writingStyle();
    reducedMotion();
    fontSize();
    lineHeight();
    store.settings.font_family;
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
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const readMotion = () => setReducedMotion(preference.matches);
    readMotion();
    createEffect(() => {
      // The panel cache retains closed WebGL roots on macOS; release this new
      // subscription when its tab closes as well as on normal root disposal.
      if (props.tabId && !store.tabs.some(tab => tab.id === props.tabId)) return;
      preference.addEventListener("change", readMotion);
      onCleanup(() => preference.removeEventListener("change", readMotion));
    });
    const finishSelectionDrag = () => { if (isDragging()) handleMouseUp(); };
    document.addEventListener("mouseup", finishSelectionDrag);
    onCleanup(() => document.removeEventListener("mouseup", finishSelectionDrag));
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
      queueMicrotask(() => { if (props.active !== false) focusInput(); });
    }

    onCleanup(() => {
      cancelAnimationFrame(animFrameId);
      cancelAnimationFrame(scrollAnimId);
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
        onCompositionStart: () => { isComposing = true; setComposing(true); },
        onCompositionEnd: () => { isComposing = false; handleInput(); setComposing(false); },
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: false,
        tabIndex: 0,
        "data-tab-focus-target": "true",
      }}
    >
      <SelectionActions tabId={props.tabId} engine={engine} active={props.active !== false}
        dragging={isDragging()} composing={composing()} width={canvasWidth()} height={canvasHeight()}
        scrollTop={scrollTop()} lineHeight={lineHeight()} charWidth={charW()} gutter={gutterW()} wordWrap={wordWrap()} focusEditor={focusInput} />
      <ContextMenu menu={editorCtxMenu()} onClose={() => setEditorCtxMenu(null)} />
    </CanvasSurface>
  );
};

export default CanvasEditor;
