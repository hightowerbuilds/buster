/**
 * Mouse event handlers for the canvas editor.
 * Extracted from CanvasEditor.tsx to keep the component lean.
 */

import type { EditorEngine } from "./engine";
import type { createAutocomplete } from "./editor-autocomplete";
import type { createHover } from "./editor-hover";
import { showError } from "../lib/notify";

type AutocompleteHandle = ReturnType<typeof createAutocomplete>;
type HoverHandle = ReturnType<typeof createHover>;

export interface MouseDeps {
  engine: EditorEngine;
  ac: AutocompleteHandle;
  hover: HoverHandle;
  containerRef: () => HTMLDivElement | undefined;
  filePath: () => string | null;
  lineNumbers: () => boolean;
  wordWrap: () => boolean;
  canvasWidth: () => number;
  scrollTop: () => number;
  fontSize: () => number;
  isDragging: () => boolean;
  setIsDragging: (v: boolean) => void;
  diagnostics: () => { line: number; col: number; endLine: number; endCol: number; severity: number; message: string }[];
  setBreakpointSet: (v: Set<number>) => void;
  clearHighlightCache: () => void;
  focusInput: () => void;
  scheduleRender: () => void;
}

function posFromMouse(e: MouseEvent, deps: MouseDeps) {
  const container = deps.containerRef();
  if (!container) return { line: 0, col: 0 };
  const rect = container.getBoundingClientRect();
  return deps.engine.posFromPixel(
    e.clientX, e.clientY, rect, deps.scrollTop(),
    deps.fontSize(), deps.lineNumbers(), deps.wordWrap(), deps.canvasWidth(),
  );
}

export function handleEditorMouseDown(e: MouseEvent, deps: MouseDeps) {
  const { engine, ac, hover } = deps;
  ac.dismiss();
  hover.dismiss();

  // Gutter interactions
  const container = deps.containerRef();
  if (container && deps.lineNumbers()) {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < 50) {
      const pos = posFromMouse(e, deps);
      if (x < 20 && engine.toggleFold(pos.line)) {
        e.preventDefault();
        deps.clearHighlightCache();
        deps.focusInput();
        return;
      }
      if (x >= 20 && deps.filePath()) {
        e.preventDefault();
        import("../lib/ipc").then(({ debugToggleBreakpoint }) => {
          debugToggleBreakpoint(deps.filePath()!, pos.line).then(() => {
            import("../lib/ipc").then(({ debugGetBreakpoints }) => {
              debugGetBreakpoints(deps.filePath()!).then(bps => {
                deps.setBreakpointSet(new Set(bps.map(bp => bp.line)));
                deps.scheduleRender();
              }).catch(() => showError("Failed to refresh breakpoints"));
            });
          }).catch(() => showError("Failed to toggle breakpoint"));
        });
        deps.focusInput();
        return;
      }

      const diag = deps.diagnostics();
      if (diag.length > 0) {
        const hit = diag.find(d => d.line === pos.line);
        if (hit) {
          e.preventDefault();
          engine.setCursor({ line: hit.line, col: hit.col });
          deps.focusInput();
          return;
        }
      }
    }
  }

  const pos = posFromMouse(e, deps);

  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    engine.setCursor(pos);
    hover.goToDefinition();
    deps.focusInput();
    return;
  }

  if (e.altKey) {
    e.preventDefault();
    engine.addCursor(pos);
    deps.focusInput();
    return;
  }

  engine.clearExtras();
  engine.setCursor(pos);
  engine.setSelection(pos, pos);
  deps.setIsDragging(true);
  deps.focusInput();
}

export function handleEditorMouseMove(e: MouseEvent, deps: MouseDeps) {
  const { engine, hover } = deps;

  if (deps.isDragging()) {
    const pos = posFromMouse(e, deps);
    const anchor = engine.sel()?.anchor ?? engine.cursor();
    engine.setSelection(anchor, pos);
    return;
  }

  const pos = posFromMouse(e, deps);

  // Gutter diagnostic hover
  const container = deps.containerRef();
  if (container && deps.lineNumbers()) {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < 50) {
      const diag = deps.diagnostics();
      if (diag.length > 0) {
        const gutterHit = diag.find(d => d.line === pos.line);
        if (gutterHit) {
          const prefix = gutterHit.severity === 1 ? "Error" : gutterHit.severity === 2 ? "Warning" : "Info";
          hover.showImmediate(`${prefix}: ${gutterHit.message}`, pos.line, 0);
          return;
        }
      }
    }
  }

  // Diagnostic underline hover
  const diag = deps.diagnostics();
  if (diag.length > 0) {
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

export function handleEditorMouseUp(deps: MouseDeps) {
  deps.setIsDragging(false);
  const s = deps.engine.sel();
  if (s && s.anchor.line === s.head.line && s.anchor.col === s.head.col) {
    deps.engine.clearSelection();
  }
}
