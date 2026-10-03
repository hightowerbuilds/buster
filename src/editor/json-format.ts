import type { EditorEngine } from "./engine";

export function formatJsonText(text: string, indent: string | number = 2): string {
  const trailingNewline = text.endsWith("\n");
  const formatted = JSON.stringify(JSON.parse(text), null, indent);
  return trailingNewline ? `${formatted}\n` : formatted;
}

export function formatJsonEngine(engine: EditorEngine, indent: string | number = 2): boolean {
  const current = engine.getText();
  const formatted = formatJsonText(current, indent);
  if (formatted === current) return false;

  const lastLine = engine.lineCount() - 1;
  engine.beginUndoGroup();
  engine.deleteRange({ line: 0, col: 0 }, { line: lastLine, col: engine.getLine(lastLine).length });
  engine.setCursor({ line: 0, col: 0 });
  engine.insert(formatted);
  engine.endUndoGroup();
  return true;
}
