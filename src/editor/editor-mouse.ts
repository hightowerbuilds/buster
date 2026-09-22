/**
 * Mouse event handlers for the canvas editor.
 * Extracted from CanvasEditor.tsx to keep the component lean.
 */

import type { EditorEngine } from "./engine";
import { minimapLeft, minimapScrollTarget } from "./render-minimap";
import { wordSelectionBounds } from "./word-selection";


export interface MouseDeps {
  engine: EditorEngine;
  containerRef: () => HTMLDivElement | undefined;
  filePath: () => string | null;
  lineNumbers: () => boolean;
  wordWrap: () => boolean;
  minimap: () => boolean;
  canvasWidth: () => number;
  canvasHeight: () => number;
  scrollTop: () => number;
  fontSize: () => number;
  lineHeight: () => number;
  charW: () => number;
  gutterW: () => number;
  isDragging: () => boolean;
  setIsDragging: (v: boolean) => void;
  focusInput: () => void;
  scheduleRender: () => void;
  scrollTo: (target: number) => void;
}

function posFromMouse(e: MouseEvent, deps: MouseDeps) {
  const container = deps.containerRef();
  if (!container) return { line: 0, col: 0 };
  const rect = container.getBoundingClientRect();
  return deps.engine.posFromPixel(
    e.clientX, e.clientY, rect, deps.scrollTop(),
    deps.fontSize(), deps.lineNumbers(), deps.wordWrap(), deps.canvasWidth(),
    { lineHeight: deps.lineHeight(), charWidth: deps.charW(), gutterWidth: deps.gutterW() },
  );
}

export function handleEditorMouseDown(e: MouseEvent, deps: MouseDeps) {
  if (e.button !== 0) return;
  const { engine } = deps;

  // Gutter interactions
  const container = deps.containerRef();

  if (container && deps.minimap()) {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const displayRows = engine.computeDisplayRows(
      deps.charW(),
      deps.canvasWidth(),
      deps.wordWrap(),
      deps.gutterW(),
    );
    if (displayRows.length > Math.ceil(deps.canvasHeight() / deps.lineHeight()) && x >= minimapLeft(deps.canvasWidth())) {
      e.preventDefault();
      deps.scrollTo(minimapScrollTarget(y, displayRows.length, deps.canvasHeight(), deps.lineHeight()));
      deps.focusInput();
      return;
    }
  }

  if (container && deps.lineNumbers()) {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < 50) {
      const pos = posFromMouse(e, deps);
      if (x < 20 && engine.toggleFold(pos.line)) {
        e.preventDefault();
        deps.focusInput();
        return;
      }
    }
  }

  const pos = posFromMouse(e, deps);

  if (e.altKey) {
    e.preventDefault();
    engine.addCursor(pos);
    deps.focusInput();
    return;
  }

  engine.clearExtras();
  e.preventDefault();
  if (e.detail >= 2) {
    const line = engine.getLine(pos.line);
    const bounds = e.detail >= 3 ? { start: 0, end: line.length } : wordSelectionBounds(line, pos.col);
    engine.setSelection({ line: pos.line, col: bounds.start }, { line: pos.line, col: bounds.end });
    deps.setIsDragging(false);
    deps.focusInput();
    return;
  }
  if (e.shiftKey) {
    engine.setSelection(engine.sel()?.anchor ?? engine.cursor(), pos);
    deps.setIsDragging(true);
    deps.focusInput();
    return;
  }
  engine.setCursor(pos);
  engine.setSelection(pos, pos);
  deps.setIsDragging(true);
  deps.focusInput();
}

export function handleEditorMouseMove(e: MouseEvent, deps: MouseDeps) {
  if (!deps.isDragging()) return;
  const { engine } = deps;
  const pos = posFromMouse(e, deps);
  const anchor = engine.sel()?.anchor ?? engine.cursor();
  engine.setSelection(anchor, pos);
}

export function handleEditorMouseUp(deps: MouseDeps) {
  deps.setIsDragging(false);
  const s = deps.engine.sel();
  if (s && s.anchor.line === s.head.line && s.anchor.col === s.head.col) {
    deps.engine.clearSelection();
  }
}
