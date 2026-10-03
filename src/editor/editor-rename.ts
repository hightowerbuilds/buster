/**
 * Inline rename handler for the canvas editor.
 *
 * When F2 is pressed, enters a rename mode where the word under cursor
 * becomes an editable inline text field. Enter applies, Escape cancels.
 */

import { createSignal } from "solid-js";
import { lspRename } from "../lib/ipc";
import { showError } from "../lib/notify";
import type { EditorEngine } from "./engine";

export interface RenameState {
  /** Whether rename mode is active */
  active: boolean;
  /** Line number of the word being renamed */
  line: number;
  /** Start column of the word */
  startCol: number;
  /** End column of the word */
  endCol: number;
  /** Current input text */
  inputText: string;
  /** Original word (to restore on cancel) */
  originalWord: string;
}

export interface RenameDeps {
  filePath: () => string | null;
  engine: EditorEngine;
  clearHighlightCache: () => void;
}

export function createRenameHandler(deps: RenameDeps) {
  const [renameState, setRenameState] = createSignal<RenameState | null>(null);

  function start() {
    const fp = deps.filePath();
    if (!fp) return;
    const engine = deps.engine;
    const c = engine.cursor();
    const line = engine.getLine(c.line);

    // Find word boundaries around cursor
    let start = c.col;
    while (start > 0 && /\w/.test(line[start - 1])) start--;
    let end = c.col;
    while (end < line.length && /\w/.test(line[end])) end++;

    const word = line.slice(start, end);
    if (!word) return;

    setRenameState({
      active: true,
      line: c.line,
      startCol: start,
      endCol: end,
      inputText: word,
      originalWord: word,
    });
  }

  function handleKey(e: KeyboardEvent): boolean {
    const state = renameState();
    if (!state) return false;

    if (e.key === "Escape") {
      cancel();
      return true;
    }

    if (e.key === "Enter") {
      apply();
      return true;
    }

    if (e.key === "Backspace") {
      if (state.inputText.length > 0) {
        setRenameState({ ...state, inputText: state.inputText.slice(0, -1) });
      }
      return true;
    }

    if (e.key === "Delete") {
      return true; // absorb but don't do anything special
    }

    // Printable character
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      setRenameState({ ...state, inputText: state.inputText + e.key });
      return true;
    }

    // Absorb navigation keys while in rename mode
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      return true;
    }

    return false;
  }

  function cancel() {
    setRenameState(null);
  }

  async function apply() {
    const state = renameState();
    if (!state) return;
    const fp = deps.filePath();
    if (!fp) { cancel(); return; }

    const newName = state.inputText.trim();
    if (!newName || newName === state.originalWord) {
      cancel();
      return;
    }

    const engine = deps.engine;
    const line = state.line;
    const col = state.startCol;

    cancel(); // close the inline widget immediately

    try {
      const edits = await lspRename(fp, line, col, newName);
      if (edits.length > 0) {
        const fileEdits = edits
          .filter(e => e.file_path === fp)
          .sort((a, b) => b.start_line !== a.start_line ? b.start_line - a.start_line : b.start_col - a.start_col);
        engine.beginUndoGroup();
        for (const edit of fileEdits) {
          engine.deleteRange(
            { line: edit.start_line, col: edit.start_col },
            { line: edit.end_line, col: edit.end_col },
          );
          engine.setCursor({ line: edit.start_line, col: edit.start_col });
          engine.insert(edit.new_text);
        }
        engine.endUndoGroup();
        deps.clearHighlightCache();
      }
    } catch {
      showError("Rename failed");
    }
  }

  return {
    renameState,
    start,
    handleKey,
    cancel,
    apply,
  };
}
