/**
 * Keyboard event handler for the canvas editor.
 * Extracted from CanvasEditor.tsx to keep the component lean.
 */

import { basename } from "buster-path";
import type { EditorEngine } from "./engine";
import type { VimHandler } from "./vim-mode";
import type { createAutocomplete } from "./editor-autocomplete";
import type { createHover } from "./editor-hover";
import type { createSignatureHelp } from "./editor-signature";
import type { createCodeActions } from "./editor-code-actions";
import type { createGhostText } from "./editor-ghost-text";
import { insertEditorText } from "./editor-input";
import { expandLanguageSnippetBeforeCursor } from "./language-snippets";
import { expandEmmetBeforeCursor } from "./editor-emmet";
import { getAutoClosePairMap, getLanguageDefinitionForPath } from "./language-registry";
import { showError } from "../lib/notify";

type AutocompleteHandle = ReturnType<typeof createAutocomplete>;
type HoverHandle = ReturnType<typeof createHover>;
type SignatureHelpHandle = ReturnType<typeof createSignatureHelp>;
type CodeActionsHandle = ReturnType<typeof createCodeActions>;
type GhostTextHandle = ReturnType<typeof createGhostText>;

export interface KeyboardDeps {
  engine: EditorEngine;
  vim: VimHandler;
  vimDeps: Parameters<VimHandler["handleVimKey"]>[2];
  ac: AutocompleteHandle;
  hover: HoverHandle;
  sigHelp: SignatureHelpHandle;
  codeActions: CodeActionsHandle;
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
  settings: () => { tab_size: number };
  clearHighlightCache: () => void;
  ensureCursorVisible: () => void;
  scheduleRender: () => void;
  focusInput: () => void;
  hiddenInput: () => HTMLTextAreaElement | undefined;
  isComposing: () => boolean;
}

export function handleEditorKeyDown(e: KeyboardEvent, deps: KeyboardDeps) {
  const { engine, vim, vimDeps, ac, hover, sigHelp, codeActions, ghost, a11y } = deps;

  if (deps.isComposing()) return;

  // Vim mode intercept
  if (vim.enabled() && vim.handleVimKey(e, engine, vimDeps)) {
    e.preventDefault();
    deps.scheduleRender();
    return;
  }

  const isMod = e.metaKey || e.ctrlKey;

  // Autocomplete interception
  if (ac.completionVisible() && ac.completions().length > 0) {
    if (e.key === "ArrowDown") { e.preventDefault(); ac.navigateDown(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); ac.navigateUp(); return; }
    if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
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
        const sorted = [...action.edits].sort((a, b) =>
          b.start_line !== a.start_line ? b.start_line - a.start_line : b.start_col - a.start_col
        );
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
        const newTextLines = (firstEdit.new_text || "").split("\n");
        const endLine = firstEdit.start_line + newTextLines.length - 1;
        const endCol = newTextLines.length === 1
          ? firstEdit.start_col + newTextLines[0].length
          : newTextLines[newTextLines.length - 1].length;
        engine.setCursor({ line: endLine, col: endCol });
        engine.endUndoGroup();
        deps.clearHighlightCache();
      }
      codeActions.dismiss();
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); codeActions.dismiss(); return; }
  }
  if (isMod && e.key === ".") { e.preventDefault(); codeActions.fetchActions().then(() => codeActions.showMenu()); return; }

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
    deps.clearHighlightCache();
    return;
  }

  // Redo
  if ((isMod && e.key === "z" && e.shiftKey) || (isMod && e.key === "y")) {
    e.preventDefault();
    engine.redo();
    a11y.announceRedo();
    deps.clearHighlightCache();
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
  if (isMod && e.key === "/") {
    e.preventDefault();
    const language = getLanguageDefinitionForPath(deps.languagePath());
    const prefix = language?.comments?.line ?? "//";
    engine.toggleLineComment(prefix);
    deps.clearHighlightCache();
    return;
  }

  // Duplicate line (Cmd+Shift+D)
  if (isMod && e.shiftKey && e.key === "D") {
    e.preventDefault();
    engine.duplicateLines();
    deps.clearHighlightCache(); deps.ensureCursorVisible();
    return;
  }

  // Join lines (Cmd+J)
  if (isMod && e.key === "j") {
    e.preventDefault();
    engine.joinLines();
    deps.clearHighlightCache();
    return;
  }

  // Rename symbol (F2)
  if (e.key === "F2" && deps.filePath()) {
    e.preventDefault();
    const fp = deps.filePath()!;
    const c = engine.cursor();
    const word = engine.getLine(c.line).slice(
      engine.getLine(c.line).slice(0, c.col).search(/\w+$/) ?? c.col,
      c.col + (engine.getLine(c.line).slice(c.col).match(/^\w+/)?.[0]?.length ?? 0)
    );
    const newName = prompt("Rename symbol:", word);
    if (newName && newName !== word) {
      import("../lib/ipc").then(({ lspRename }) => {
        lspRename(fp, c.line, c.col, newName).then(edits => {
          if (edits.length > 0) {
            const fileEdits = edits
              .filter(e => e.file_path === fp)
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
            deps.clearHighlightCache();
          }
        }).catch(() => showError("Rename failed"));
      });
    }
    return;
  }

  // Find references (Shift+F12)
  if (e.key === "F12" && e.shiftKey && deps.filePath()) {
    e.preventDefault();
    const fp = deps.filePath()!;
    const c = engine.cursor();
    import("../lib/ipc").then(({ lspReferences }) => {
      lspReferences(fp, c.line, c.col).then(locations => {
        if (locations.length > 0) {
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

  // Move line up/down (Alt+Arrow)
  if (e.altKey && !isMod && e.key === "ArrowUp") {
    e.preventDefault(); engine.moveLines("up");
    deps.clearHighlightCache(); deps.ensureCursorVisible(); return;
  }
  if (e.altKey && !isMod && e.key === "ArrowDown") {
    e.preventDefault(); engine.moveLines("down");
    deps.clearHighlightCache(); deps.ensureCursorVisible(); return;
  }

  const isModifier = e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta";
  const extend = e.shiftKey && !isModifier;

  // Navigation — word/line/document level
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
    engine.setCursor({ line: 0, col: 0 }); deps.ensureCursorVisible(); return;
  } else if (e.key === "ArrowDown" && e.metaKey) {
    e.preventDefault(); ac.dismiss();
    const ls = engine.lines(); engine.setCursor({ line: ls.length - 1, col: ls[ls.length - 1].length });
    deps.ensureCursorVisible(); return;
  }

  // Navigation — character level
  if (e.key === "ArrowLeft") {
    e.preventDefault(); ac.dismiss(); engine.moveCursor("left", extend);
  } else if (e.key === "ArrowRight") {
    e.preventDefault(); ac.dismiss(); engine.moveCursor("right", extend);
  } else if (e.key === "ArrowUp") {
    e.preventDefault(); ac.dismiss();
    if (deps.wordWrap()) {
      engine.moveCursorByDisplayRow("up", extend, deps.charW(), deps.canvasWidth(), true, deps.gutterW());
    } else {
      engine.moveCursor("up", extend);
    }
    deps.ensureCursorVisible();
  } else if (e.key === "ArrowDown") {
    e.preventDefault(); ac.dismiss();
    if (deps.wordWrap()) {
      engine.moveCursorByDisplayRow("down", extend, deps.charW(), deps.canvasWidth(), true, deps.gutterW());
    } else {
      engine.moveCursor("down", extend);
    }
    deps.ensureCursorVisible();
  } else if (e.key === "Home") {
    e.preventDefault(); ac.dismiss(); engine.moveCursorToLineStart();
  } else if (e.key === "End") {
    e.preventDefault(); ac.dismiss(); engine.moveCursorToLineEnd();
  } else if (e.key === "PageDown") {
    e.preventDefault(); ac.dismiss();
    const pageRows = Math.max(1, Math.floor(deps.canvasHeight() / deps.lineHeight()) - 2);
    const c = engine.cursor();
    engine.setCursor({ line: Math.min(c.line + pageRows, engine.lines().length - 1), col: c.col });
    deps.ensureCursorVisible();
  } else if (e.key === "PageUp") {
    e.preventDefault(); ac.dismiss();
    const pageRows = Math.max(1, Math.floor(deps.canvasHeight() / deps.lineHeight()) - 2);
    const c = engine.cursor();
    engine.setCursor({ line: Math.max(c.line - pageRows, 0), col: c.col });
    deps.ensureCursorVisible();
  } else if (e.key === "Backspace" && e.altKey) {
    e.preventDefault();
    const hi = deps.hiddenInput();
    if (hi) hi.value = "";
    engine.deleteWordBackward();
    deps.clearHighlightCache(); ac.trigger();
  } else if (e.key === "Backspace") {
    e.preventDefault();
    const hi = deps.hiddenInput();
    if (hi) hi.value = "";
    const bCur = engine.cursor();
    if (!engine.sel() && bCur.col > 0) {
      const bLine = engine.getLine(bCur.line);
      const charBefore = bLine[bCur.col - 1];
      const charAfter = bLine[bCur.col];
      const bracketPairs = getAutoClosePairMap(deps.languagePath());
      if (charBefore && charAfter && bracketPairs[charBefore] === charAfter) {
        engine.deleteRange({ line: bCur.line, col: bCur.col - 1 }, { line: bCur.line, col: bCur.col + 1 });
        deps.clearHighlightCache(); ac.trigger();
        return;
      }
    }
    engine.backspace();
    deps.clearHighlightCache(); ac.trigger();
  } else if (e.key === "Delete") {
    e.preventDefault(); ac.dismiss();
    const hi = deps.hiddenInput();
    if (hi) hi.value = "";
    engine.deleteForward();
    deps.clearHighlightCache();
  } else if (e.key === "Enter") {
    e.preventDefault(); ac.dismiss();
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
    }
    deps.clearHighlightCache(); deps.ensureCursorVisible();
  } else if (e.key === "Tab") {
    if (!deps.tabTrapping()) return;
    e.preventDefault();
    if (!e.shiftKey && ac.isInSnippet()) { ac.advanceSnippet(); return; }
    const accepted = ghost.accept();
    if (accepted) {
      engine.insert(accepted);
      deps.clearHighlightCache();
      return;
    }
    if (!e.shiftKey && !engine.sel()) {
      // Try Emmet abbreviation expansion first (HTML/CSS)
      const emmetResult = expandEmmetBeforeCursor({
        languagePath: deps.languagePath(),
        lines: engine.lines(),
        cursor: engine.cursor(),
        indentUnit: deps.indentUnit(),
      });
      if (emmetResult) {
        engine.beginUndoGroup();
        engine.deleteRange(emmetResult.from, emmetResult.to);
        engine.insert(emmetResult.text);
        engine.setCursor(emmetResult.cursor);
        engine.endUndoGroup();
        deps.clearHighlightCache();
        deps.ensureCursorVisible();
        return;
      }
      // Then try language-specific snippets
      const snippet = expandLanguageSnippetBeforeCursor({
        languagePath: deps.languagePath(),
        lines: engine.lines(),
        cursor: engine.cursor(),
        indentUnit: deps.indentUnit(),
      });
      if (snippet) {
        engine.beginUndoGroup();
        engine.deleteRange(snippet.from, snippet.to);
        engine.insert(snippet.text);
        engine.setCursor(snippet.cursor);
        engine.endUndoGroup();
        deps.clearHighlightCache();
        deps.ensureCursorVisible();
        return;
      }
    }
    if (e.shiftKey) {
      engine.outdentLines(deps.settings().tab_size || 4);
    } else if (engine.sel()) {
      engine.indentLines(deps.indentUnit());
    } else {
      engine.insert(deps.indentUnit());
    }
    deps.clearHighlightCache();
  } else if (!isModifier && !isMod && !extend && !e.altKey && e.key.length === 1) {
    e.preventDefault();
    const hi = deps.hiddenInput();
    if (hi) hi.value = "";
    insertEditorText(e.key, {
      engine,
      ac,
      sigHelp,
      ghost,
      languagePath: deps.languagePath,
      indentUnit: deps.indentUnit,
      clearHighlightCache: deps.clearHighlightCache,
    });
    requestAnimationFrame(() => deps.focusInput());
  } else if (!isModifier && !isMod && !extend) {
    engine.clearSelection();
  }
}
