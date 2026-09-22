/**
 * Keyboard event handler for the canvas editor.
 * Extracted from CanvasEditor.tsx to keep the component lean.
 */

import type { EditorEngine } from "./engine";
import type { createGhostText } from "./editor-ghost-text";

type GhostTextHandle = ReturnType<typeof createGhostText>;

export interface KeyboardDeps {
  engine: EditorEngine;
  ghost: GhostTextHandle;
  a11y: { announceUndo: () => void; announceRedo: () => void };
  filePath: () => string | null;
  languagePath: () => string | null;
  wordWrap: () => boolean;
  charW: () => number;
  canvasWidth: () => number;
  canvasHeight: () => number;
  gutterW: () => number;
  lineHeight: () => number;
  tabTrapping: () => boolean;
  indentUnit: () => string;
  settings: () => { tab_size: number; ai_completion_enabled?: boolean };
  ensureCursorVisible: () => void;
  scheduleRender: () => void;
  focusInput: () => void;
  hiddenInput: () => HTMLTextAreaElement | undefined;
  isComposing: () => boolean;
}

export function handleEditorKeyDown(e: KeyboardEvent, deps: KeyboardDeps) {
  const { engine, ghost, a11y } = deps;

  // Some WebKit/IME paths end composition before the final keydown. That key
  // still belongs to native text input and must not be inserted a second time.
  if (deps.isComposing() || e.isComposing || e.keyCode === 229) return;

  const isMod = e.metaKey || e.ctrlKey;

  if (e.ctrlKey && e.key === " ") {
    e.preventDefault();
    if (deps.settings().ai_completion_enabled) ghost.trigger();
    return;
  }

  // Toggle blame
  if (isMod && e.shiftKey && e.key === "B") { e.preventDefault(); return; } // handled by caller

  // Bracket jump (Cmd+Shift+\)
  if (isMod && e.shiftKey && e.key === "\\") {
    e.preventDefault();
    const match = engine.findMatchingBracket();
    if (match) {
      const c = engine.cursor();
      const atOpen = c.col <= match.open.col + 1 && c.line === match.open.line;
      engine.setCursor(atOpen ? match.close : match.open);
      deps.ensureCursorVisible();
    }
    return;
  }

  // Escape cascade
  if (e.key === "Escape") {
    if (ghost.ghostText()) { e.preventDefault(); ghost.dismiss(); return; }
    if (engine.hasMultiCursors()) { e.preventDefault(); engine.clearExtras(); return; }
  }

  // Undo
  if (isMod && e.key === "z" && !e.shiftKey) {
    e.preventDefault();
    engine.undo();
    a11y.announceUndo();
    return;
  }

  // Redo
  if ((isMod && e.key === "z" && e.shiftKey) || (isMod && e.key === "y")) {
    e.preventDefault();
    engine.redo();
    a11y.announceRedo();
    return;
  }

  // Select All
  if (isMod && e.key === "a") { e.preventDefault(); engine.selectAll(); return; }

  // Select next occurrence (Cmd+D)
  if (isMod && e.key === "d") {
    e.preventDefault();
    const sel = engine.getOrderedSelection();
    if (sel) {
      const selectedText = engine.getTextRange(sel.from, sel.to);
      if (selectedText) {
        const ls = engine.lines();
        let found = false;
        for (let line = sel.to.line; line < ls.length && !found; line++) {
          const startCol = line === sel.to.line ? sel.to.col : 0;
          const idx = ls[line].indexOf(selectedText, startCol);
          if (idx !== -1) {
            engine.addCursor({ line, col: idx + selectedText.length });
            engine.setSelection(sel.from, sel.to);
            found = true;
          }
        }
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

  // Toggle line comment (Cmd+/)
  // Duplicate line (Cmd+Shift+D)
  if (isMod && e.shiftKey && e.key === "D") {
    e.preventDefault();
    engine.duplicateLines(); deps.ensureCursorVisible();
    return;
  }

  // Join lines (Cmd+J)
  if (isMod && e.key === "j") {
    e.preventDefault();
    engine.joinLines();
    return;
  }

  // Move line up/down (Alt+Arrow)
  if (e.altKey && !isMod && e.key === "ArrowUp") {
    e.preventDefault(); engine.moveLines("up"); deps.ensureCursorVisible(); return;
  }
  if (e.altKey && !isMod && e.key === "ArrowDown") {
    e.preventDefault(); engine.moveLines("down"); deps.ensureCursorVisible(); return;
  }

  const isModifier = e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta";
  const extend = e.shiftKey && !isModifier;

  // Navigation — word/line/document level
  const isMac = navigator.platform.startsWith("Mac");
  if (e.key === "ArrowLeft" && (e.altKey || (!isMac && e.ctrlKey))) {
    e.preventDefault(); engine.moveWord("left", extend); return;
  } else if (e.key === "ArrowRight" && (e.altKey || (!isMac && e.ctrlKey))) {
    e.preventDefault(); engine.moveWord("right", extend); return;
  } else if (e.key === "ArrowLeft" && e.metaKey) {
    e.preventDefault(); engine.moveCursorToLineStart(); return;
  } else if (e.key === "ArrowRight" && e.metaKey) {
    e.preventDefault(); engine.moveCursorToLineEnd(); return;
  } else if (e.key === "ArrowUp" && e.metaKey) {
    e.preventDefault();
    engine.setCursor({ line: 0, col: 0 }); deps.ensureCursorVisible(); return;
  } else if (e.key === "ArrowDown" && e.metaKey) {
    e.preventDefault();
    const ls = engine.lines(); engine.setCursor({ line: ls.length - 1, col: ls[ls.length - 1].length });
    deps.ensureCursorVisible(); return;
  }

  // Navigation — character level
  if (e.key === "ArrowLeft") {
    e.preventDefault(); engine.moveCursor("left", extend);
  } else if (e.key === "ArrowRight") {
    e.preventDefault(); engine.moveCursor("right", extend);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (deps.wordWrap()) {
      engine.moveCursorByDisplayRow("up", extend, deps.charW(), deps.canvasWidth(), true, deps.gutterW());
    } else {
      engine.moveCursor("up", extend);
    }
    deps.ensureCursorVisible();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (deps.wordWrap()) {
      engine.moveCursorByDisplayRow("down", extend, deps.charW(), deps.canvasWidth(), true, deps.gutterW());
    } else {
      engine.moveCursor("down", extend);
    }
    deps.ensureCursorVisible();
  } else if (e.key === "Home") {
    e.preventDefault(); engine.moveCursorToLineStart();
  } else if (e.key === "End") {
    e.preventDefault(); engine.moveCursorToLineEnd();
  } else if (e.key === "PageDown") {
    e.preventDefault();
    const pageRows = Math.max(1, Math.floor(deps.canvasHeight() / deps.lineHeight()) - 2);
    const c = engine.cursor();
    engine.setCursor({ line: Math.min(c.line + pageRows, engine.lines().length - 1), col: c.col });
    deps.ensureCursorVisible();
  } else if (e.key === "PageUp") {
    e.preventDefault();
    const pageRows = Math.max(1, Math.floor(deps.canvasHeight() / deps.lineHeight()) - 2);
    const c = engine.cursor();
    engine.setCursor({ line: Math.max(c.line - pageRows, 0), col: c.col });
    deps.ensureCursorVisible();
  } else if (e.key === "Backspace" && e.altKey) {
    e.preventDefault();
    const hi = deps.hiddenInput();
    if (hi) hi.value = "";
    engine.deleteWordBackward();
  } else if (e.key === "Backspace") {
    e.preventDefault();
    const hi = deps.hiddenInput();
    if (hi) hi.value = "";
    engine.backspace();
  } else if (e.key === "Delete") {
    e.preventDefault();
    const hi = deps.hiddenInput();
    if (hi) hi.value = "";
    engine.deleteForward();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const cur = engine.cursor();
    const currentLine = engine.getLine(cur.line);
    const indent = currentLine.match(/^\s*/)![0];
    const charBefore = currentLine[cur.col - 1] ?? "";
    const charAfter = currentLine[cur.col] ?? "";
    const unit = deps.indentUnit();

    if (charBefore === "{" && charAfter === "}") {
      engine.insert("\n" + indent + unit + "\n" + indent);
      engine.setCursor({ line: cur.line + 1, col: (indent + unit).length });
    } else if ((charBefore === "(" && charAfter === ")") || (charBefore === "[" && charAfter === "]")) {
      engine.insert("\n" + indent + unit + "\n" + indent);
      engine.setCursor({ line: cur.line + 1, col: (indent + unit).length });
    } else if ("{[(".includes(charBefore)) {
      engine.insert("\n" + indent + unit);
    } else {
      engine.insert("\n" + indent);
    } deps.ensureCursorVisible();
  } else if (e.key === "Tab") {
    if (!deps.tabTrapping()) return;
    e.preventDefault();
    const accepted = ghost.accept();
    if (accepted) {
      engine.insert(accepted);
      return;
    }
    if (e.shiftKey) {
      engine.outdentLines(deps.settings().tab_size || 4);
    } else if (engine.sel()) {
      engine.indentLines(deps.indentUnit());
    } else {
      engine.insert(deps.indentUnit());
    }
  } else if (!isModifier && !isMod && !extend && !e.altKey && e.key.length === 1) {
    // Let the textarea's native input event own printable text, just as it owns
    // shifted/Alt input and composition. A keydown character is not necessarily
    // the text the input method commits (for example macOS dead-key accents).
    return;
  } else if (!isModifier && !isMod && !extend) {
    engine.clearSelection();
  }
}
