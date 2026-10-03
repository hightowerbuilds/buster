import type { EditorEngine, Pos } from "./engine";
import type { LspTextEdit } from "../lib/ipc";

function editStart(edit: LspTextEdit): Pos {
  return { line: edit.start_line, col: edit.start_col };
}

function editEnd(edit: LspTextEdit): Pos {
  return { line: edit.end_line, col: edit.end_col };
}

export function applyTextEdits(engine: EditorEngine, edits: LspTextEdit[]): boolean {
  if (edits.length === 0) return false;

  const cursor = engine.cursor();
  const sorted = [...edits].sort((a, b) =>
    b.start_line !== a.start_line ? b.start_line - a.start_line : b.start_col - a.start_col
  );

  engine.beginUndoGroup();
  for (const edit of sorted) {
    engine.deleteRange(editStart(edit), editEnd(edit));
    if (edit.new_text) {
      engine.setCursor(editStart(edit));
      engine.insert(edit.new_text);
    }
  }
  engine.setCursor({
    line: Math.min(cursor.line, engine.lineCount() - 1),
    col: Math.min(cursor.col, engine.getLine(Math.min(cursor.line, engine.lineCount() - 1)).length),
  });
  engine.endUndoGroup();

  return true;
}
