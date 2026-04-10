import { createSignal, createEffect, createMemo, Index, type JSX } from "solid-js";
import type { Pos } from "./engine";
import { announce, createDebouncedAnnounce } from "../lib/a11y";
import { basename } from "buster-path";

// ─── Types ──────────────────────────────────────────────────────────

export interface EditorA11yDeps {
  lines: () => string[];
  cursor: () => Pos;
  editSeq: () => number;
  scrollTop: () => number;
  canvasHeight: () => number;
  fontSize: () => number;
  filePath: () => string | null;
}

// ─── Factory ────────────────────────────────────────────────────────

export function createEditorA11y(deps: EditorA11yDeps) {
  const lineHeight = () => deps.fontSize() + 8;

  // ── Windowed lines (viewport ± 50 lines) ────────────────────────

  const windowedLines = createMemo(() => {
    const ls = deps.lines();
    const lh = lineHeight();
    if (lh === 0 || ls.length === 0) return { start: 0, lines: ls };

    const firstVis = Math.floor(deps.scrollTop() / lh);
    const visCount = Math.ceil(deps.canvasHeight() / lh);
    const start = Math.max(0, firstVis - 50);
    const end = Math.min(ls.length, firstVis + visCount + 50);
    return { start, lines: ls.slice(start, end) };
  });

  // ── Cursor position announcements (debounced 300ms) ─────────────

  const debouncedCursorAnnounce = createDebouncedAnnounce(300, "polite");
  const [cursorAnnouncement, setCursorAnnouncement] = createSignal("");
  let prevCursorLine = -1;

  createEffect(() => {
    const c = deps.cursor();
    if (c.line !== prevCursorLine) {
      prevCursorLine = c.line;
      const lineText = deps.lines()[c.line] ?? "";
      const msg = `Line ${c.line + 1}, Column ${c.col + 1}`;
      setCursorAnnouncement(msg);
      debouncedCursorAnnounce(`${msg}: ${lineText || "(empty)"}`);
    }
  });

  // ── Edit operation announcements ────────────────────────────────

  let prevEditSeq = 0;
  let prevLines: string[] = [];
  let prevCursor: Pos = { line: 0, col: 0 };

  createEffect(() => {
    const seq = deps.editSeq();
    if (seq === 0) {
      // Initial state — snapshot without announcing
      prevEditSeq = seq;
      prevLines = deps.lines().slice();
      prevCursor = { ...deps.cursor() };
      return;
    }
    if (seq === prevEditSeq) return;

    const curLines = deps.lines();
    const curCursor = deps.cursor();
    const lineDelta = curLines.length - prevLines.length;

    let msg = "";
    if (lineDelta > 0) {
      msg = lineDelta === 1 ? "New line" : `Inserted ${lineDelta} lines`;
    } else if (lineDelta < 0) {
      msg = lineDelta === -1 ? "Deleted line" : `Deleted ${-lineDelta} lines`;
    } else if (curCursor.line === prevCursor.line) {
      const colDelta = curCursor.col - prevCursor.col;
      if (colDelta === 1) {
        const ch = curLines[curCursor.line]?.[curCursor.col - 1] ?? "";
        msg = `${ch}`;
      } else if (colDelta === -1) {
        msg = "Deleted";
      } else if (colDelta > 1) {
        msg = `Inserted ${colDelta} characters`;
      } else if (colDelta < -1) {
        msg = `Deleted ${-colDelta} characters`;
      }
    }

    if (msg) announce(msg, "assertive");

    prevEditSeq = seq;
    prevLines = curLines.slice();
    prevCursor = { ...curCursor };
  });

  // ── Explicit undo/redo announcements ────────────────────────────

  function announceUndo() { announce("Undo", "assertive"); }
  function announceRedo() { announce("Redo", "assertive"); }

  // ── Cleanup ─────────────────────────────────────────────────────

  function cleanup() {
    // reserved for future timer cleanup
  }

  // ── Parallel DOM component ──────────────────────────────────────

  function ParallelDOM(): JSX.Element {
    const fileName = () => {
      const fp = deps.filePath();
      return fp ? (basename(fp) || "untitled") : "untitled";
    };

    return (
      <div
        class="visually-hidden"
        role="document"
        aria-label={`Code content: ${fileName()}`}
        aria-roledescription="editor"
      >
        <Index each={windowedLines().lines}>
          {(line) => (
            <div role="presentation" aria-roledescription="line">
              {line() || "\u00A0"}
            </div>
          )}
        </Index>
        <div aria-live="polite" aria-atomic="true">
          {cursorAnnouncement()}
        </div>
      </div>
    ) as unknown as JSX.Element;
  }

  return { ParallelDOM, announceUndo, announceRedo, cleanup };
}
