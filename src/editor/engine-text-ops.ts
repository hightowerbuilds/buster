/**
 * Pure text operations and shared types for the editor engine.
 *
 * These functions operate on plain arrays and positions — no SolidJS
 * signals or engine state. They are extracted here so the engine
 * factory stays focused on reactive wiring and public API.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface Pos {
  line: number;
  col: number;
}

export interface Selection {
  anchor: Pos;
  head: Pos;
}

export interface DisplayRow {
  bufferLine: number;
  startCol: number;
  text: string;
}

/** A single edit range describing what text was replaced and with what. */
export interface EditDelta {
  /** Start line of the replaced range (zero-based, before the edit). */
  startLine: number;
  /** Start column of the replaced range (zero-based, before the edit). */
  startCol: number;
  /** End line of the replaced range (zero-based, before the edit). */
  endLine: number;
  /** End column of the replaced range (zero-based, before the edit). */
  endCol: number;
  /** The new text that replaced the range. Empty string means deletion. */
  newText: string;
}

// ─── Constants ──────────────────────────────────────────────────────

export const PADDING_LEFT = 8;
export const UNDO_GROUP_MS = 300;
export const MAX_UNDO = 500;
/** Maximum total bytes across all undo snapshots (10 MB). */
export const MAX_UNDO_BYTES = 10 * 1024 * 1024;

// ─── History entry ──────────────────────────────────────────────────

export interface HistoryEntry {
  lines: string[];
  primary: Pos;
  extras: Pos[];
  sel: Selection | null;
  /** Approximate byte size of this snapshot's lines array. */
  byteSize: number;
}

// ─── Position helpers ───────────────────────────────────────────────

export function orderPositions(a: Pos, b: Pos): [Pos, Pos] {
  if (a.line < b.line || (a.line === b.line && a.col <= b.col)) return [a, b];
  return [b, a];
}

export function clamp(pos: Pos, lines: string[]): Pos {
  const line = Math.max(0, Math.min(pos.line, lines.length - 1));
  const col = Math.max(0, Math.min(pos.col, lines[line]?.length ?? 0));
  return { line, col };
}

export function findWordBoundaryLeft(line: string, col: number): number {
  if (col <= 0) return 0;
  let i = col - 1;
  while (i > 0 && /\s/.test(line[i])) i--;
  while (i > 0 && /\w/.test(line[i - 1])) i--;
  return i;
}

export function findWordBoundaryRight(line: string, col: number): number {
  if (col >= line.length) return line.length;
  let i = col;
  while (i < line.length && /\w/.test(line[i])) i++;
  while (i < line.length && /\s/.test(line[i])) i++;
  return i;
}

export function adjustPosAfterDelete(pos: Pos, from: Pos, to: Pos): Pos {
  // Before the deleted range — unchanged
  if (pos.line < from.line || (pos.line === from.line && pos.col <= from.col)) return pos;
  // Within the deleted range — collapse to `from`
  if (pos.line < to.line || (pos.line === to.line && pos.col <= to.col)) return { ...from };
  // After the deleted range on the same end-line
  if (pos.line === to.line) {
    return { line: from.line, col: from.col + (pos.col - to.col) };
  }
  // On a later line — shift line number
  return { line: pos.line - (to.line - from.line), col: pos.col };
}

export function deduplicateCursors(primary: Pos, extras: Pos[]): { primary: Pos; extras: Pos[] } {
  const seen = new Set<string>();
  seen.add(`${primary.line}:${primary.col}`);
  const unique = extras.filter(p => {
    const key = `${p.line}:${p.col}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { primary, extras: unique };
}

// ─── Core text operations (work on raw arrays, not signals) ────────

export function insertAtPos(ls: string[], pos: Pos, text: string): { lines: string[]; newPos: Pos } {
  const result = ls.slice();
  const textLines = text.split("\n");
  const before = result[pos.line].slice(0, pos.col);
  const after = result[pos.line].slice(pos.col);

  if (textLines.length === 1) {
    result[pos.line] = before + textLines[0] + after;
    return { lines: result, newPos: { line: pos.line, col: pos.col + textLines[0].length } };
  }

  const newLines: string[] = [];
  newLines.push(before + textLines[0]);
  for (let i = 1; i < textLines.length - 1; i++) newLines.push(textLines[i]);
  newLines.push(textLines[textLines.length - 1] + after);
  result.splice(pos.line, 1, ...newLines);

  return {
    lines: result,
    newPos: { line: pos.line + textLines.length - 1, col: textLines[textLines.length - 1].length },
  };
}

export function backspaceAtPos(ls: string[], pos: Pos): { lines: string[]; newPos: Pos } {
  const result = ls.slice();
  if (pos.col > 0) {
    const line = result[pos.line];
    result[pos.line] = line.slice(0, pos.col - 1) + line.slice(pos.col);
    return { lines: result, newPos: { line: pos.line, col: pos.col - 1 } };
  }
  if (pos.line > 0) {
    const prevLen = result[pos.line - 1].length;
    result[pos.line - 1] += result[pos.line];
    result.splice(pos.line, 1);
    return { lines: result, newPos: { line: pos.line - 1, col: prevLen } };
  }
  return { lines: result, newPos: pos };
}

export function deleteForwardAtPos(ls: string[], pos: Pos): string[] {
  const result = ls.slice();
  const line = result[pos.line];
  if (pos.col < line.length) {
    result[pos.line] = line.slice(0, pos.col) + line.slice(pos.col + 1);
  } else if (pos.line < result.length - 1) {
    result[pos.line] = line + result[pos.line + 1];
    result.splice(pos.line + 1, 1);
  }
  return result;
}

export function deleteRangeFromLines(ls: string[], from: Pos, to: Pos): string[] {
  const result = ls.slice();
  if (from.line === to.line) {
    result[from.line] = result[from.line].slice(0, from.col) + result[from.line].slice(to.col);
  } else {
    const before = result[from.line].slice(0, from.col);
    const after = result[to.line].slice(to.col);
    result.splice(from.line, to.line - from.line + 1, before + after);
  }
  return result;
}
