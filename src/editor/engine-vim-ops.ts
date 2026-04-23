/**
 * Vim-specific editing operations extracted from the engine factory.
 *
 * These methods only mutate state through the injected internals —
 * the engine passes its reactive setters and undo helpers so that
 * this module has zero SolidJS or engine-specific imports.
 */

import { batch } from "solid-js";
import type { Pos, Selection, EditDelta } from "./engine-text-ops";
import { deleteRangeFromLines } from "./engine-text-ops";

// ─── Injected dependencies ─────────────────────────────────────────

export interface VimOpsDeps {
  lines: () => string[];
  cursor: () => Pos;
  sel: () => Selection | null;
  setLines: (ls: string[]) => void;
  setCursor: (pos: Pos) => void;
  setSel: (s: Selection | null) => void;
  recordUndo: () => void;
  afterEdit: (deltas?: EditDelta[] | null) => void;
}

// ─── Vim operations ────────────────────────────────────────────────

/** Move cursor to first non-whitespace character on current line (Vim ^). */
export function moveCursorToFirstNonBlank(d: VimOpsDeps, extend: boolean = false) {
  const line = d.lines()[d.cursor().line] ?? "";
  const match = line.match(/^\s*/);
  const col = match ? match[0].length : 0;
  const next = { line: d.cursor().line, col };
  batch(() => {
    if (extend) {
      const anchor = d.sel()?.anchor ?? d.cursor();
      d.setSel({ anchor, head: next });
    } else {
      d.setSel(null);
    }
    d.setCursor(next);
  });
}

/** Move cursor to end of current/next word (Vim e). */
export function moveToWordEnd(d: VimOpsDeps, extend: boolean = false) {
  const p = d.cursor();
  const line = d.lines()[p.line] ?? "";
  let col = p.col;

  // If at end of word or on whitespace, skip to next word first
  if (col < line.length - 1) col++;
  // Skip whitespace
  while (col < line.length && /\s/.test(line[col])) col++;
  // Skip to end of word
  if (/\w/.test(line[col] ?? "")) {
    while (col < line.length - 1 && /\w/.test(line[col + 1])) col++;
  } else {
    while (col < line.length - 1 && !/\w/.test(line[col + 1]) && !/\s/.test(line[col + 1])) col++;
  }

  const next = { line: p.line, col };
  batch(() => {
    if (extend) {
      const anchor = d.sel()?.anchor ?? p;
      d.setSel({ anchor, head: next });
    } else {
      d.setSel(null);
    }
    d.setCursor(next);
  });
}

/** Delete N lines from cursor position (Vim dd with count). Returns deleted text. */
export function deleteLine(d: VimOpsDeps, count: number = 1): string {
  d.recordUndo();
  const ls = d.lines();
  const startLine = d.cursor().line;
  const endLine = Math.min(startLine + count, ls.length);
  const deleted = ls.slice(startLine, endLine).join("\n");

  const from: Pos = { line: startLine, col: 0 };
  let to: Pos;
  if (endLine < ls.length) {
    to = { line: endLine, col: 0 };
  } else if (startLine > 0) {
    to = { line: startLine, col: 0 };
    from.line = startLine - 1;
    from.col = ls[startLine - 1].length;
  } else {
    // Only line — clear it
    to = { line: 0, col: ls[0].length };
  }

  const newLines = deleteRangeFromLines(ls, from, to);
  const newPos = { line: Math.min(from.line, newLines.length - 1), col: 0 };
  batch(() => { d.setLines(newLines); d.setCursor(newPos); d.setSel(null); });
  d.afterEdit([{ startLine: from.line, startCol: from.col, endLine: to.line, endCol: to.col, newText: "" }]);
  return deleted;
}

/** Return N lines as text from cursor position without deleting (Vim yy). */
export function yankLine(d: VimOpsDeps, count: number = 1): string {
  const ls = d.lines();
  const startLine = d.cursor().line;
  const endLine = Math.min(startLine + count, ls.length);
  return ls.slice(startLine, endLine).join("\n");
}

/** Insert a new line below cursor and position cursor there (Vim o). */
export function openLineBelow(d: VimOpsDeps) {
  d.recordUndo();
  const ls = d.lines().slice();
  const p = d.cursor();
  const line = ls[p.line] ?? "";
  const indent = line.match(/^\s*/)![0];
  ls.splice(p.line + 1, 0, indent);
  const newPos = { line: p.line + 1, col: indent.length };
  batch(() => { d.setLines(ls); d.setCursor(newPos); d.setSel(null); });
  d.afterEdit([{ startLine: p.line, startCol: line.length, endLine: p.line, endCol: line.length, newText: "\n" + indent }]);
}

/** Insert a new line above cursor and position cursor there (Vim O). */
export function openLineAbove(d: VimOpsDeps) {
  d.recordUndo();
  const ls = d.lines().slice();
  const p = d.cursor();
  const line = ls[p.line] ?? "";
  const indent = line.match(/^\s*/)![0];
  ls.splice(p.line, 0, indent);
  const newPos = { line: p.line, col: indent.length };
  batch(() => { d.setLines(ls); d.setCursor(newPos); d.setSel(null); });
  d.afterEdit([{ startLine: p.line, startCol: 0, endLine: p.line, endCol: 0, newText: indent + "\n" }]);
}

/** Replace character under cursor without moving (Vim r). */
export function replaceChar(d: VimOpsDeps, char: string) {
  const p = d.cursor();
  const ls = d.lines();
  const line = ls[p.line] ?? "";
  if (p.col >= line.length) return;
  d.recordUndo();
  const result = ls.slice();
  result[p.line] = line.slice(0, p.col) + char + line.slice(p.col + 1);
  batch(() => { d.setLines(result); d.setCursor(p); });
  d.afterEdit([{ startLine: p.line, startCol: p.col, endLine: p.line, endCol: p.col + 1, newText: char }]);
}

/** Get the word under cursor (for Vim * search). */
export function getWordUnderCursor(d: VimOpsDeps): string {
  const p = d.cursor();
  const line = d.lines()[p.line] ?? "";
  let start = p.col;
  let end = p.col;
  while (start > 0 && /\w/.test(line[start - 1])) start--;
  while (end < line.length && /\w/.test(line[end])) end++;
  return line.slice(start, end);
}
