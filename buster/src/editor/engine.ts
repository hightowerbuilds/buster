/**
 * EditorEngine — the complete text-editing core, built on SolidJS signals.
 *
 * Owns: document, cursors, selection, undo/redo history, display-row
 * computation, pixel↔position mapping, and character-width measurement.
 *
 * All state is reactive. Read `engine.lines()` in a SolidJS tracking
 * context and it automatically re-renders when the document changes.
 * Mutations are synchronous — no IPC round trips.
 *
 * Usage:
 *   const engine = createEditorEngine("hello\nworld", "file.ts");
 *   engine.insert("!");          // mutate
 *   engine.lines();              // reactive read
 *   engine.cursor();             // reactive read
 */

import { createSignal, batch } from "solid-js";
import { getCharWidth, FONT_FAMILY } from "./text-measure";

export { getCharWidth, FONT_FAMILY };

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

/** Standalone display-row computation for the canvas renderer. */
/** Compute the range of lines that a fold at `startLine` covers (indentation-based). */
export function computeFoldRange(lines: string[], startLine: number): { start: number; end: number } | null {
  if (startLine >= lines.length - 1) return null;
  const baseIndent = lines[startLine].search(/\S/);
  if (baseIndent < 0) return null; // blank line
  let end = startLine + 1;
  // Find the last line that has greater indentation than the start line
  while (end < lines.length) {
    const line = lines[end];
    const indent = line.search(/\S/);
    if (indent < 0) { end++; continue; } // skip blank lines
    if (indent <= baseIndent) break;
    end++;
  }
  if (end <= startLine + 1) return null; // nothing to fold
  return { start: startLine + 1, end: end - 1 };
}

/** Check if a line is foldable (next line has greater indentation). */
export function isFoldable(lines: string[], lineIdx: number): boolean {
  if (lineIdx >= lines.length - 1) return false;
  const currentIndent = lines[lineIdx].search(/\S/);
  if (currentIndent < 0) return false;
  const nextIndent = lines[lineIdx + 1].search(/\S/);
  return nextIndent > currentIndent;
}

export function computeDisplayRows(
  lines: string[],
  charW: number,
  editorWidth: number,
  wordWrap: boolean,
  gutterW: number,
  foldedLines?: Set<number>
): DisplayRow[] {
  if (!wordWrap) {
    const rows: DisplayRow[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (foldedLines?.has(i)) continue; // skip folded lines
      rows.push({ bufferLine: i, startCol: 0, text: lines[i] });
    }
    return rows;
  }

  const maxChars = Math.max(10, Math.floor((editorWidth - gutterW - PADDING_LEFT - 10) / charW));
  // Pre-allocate with a reasonable estimate (most lines don't wrap)
  const rows: DisplayRow[] = [];
  if (lines.length > 1000) rows.length = 0; // hint to V8 to use flat array

  for (let i = 0; i < lines.length; i++) {
    if (foldedLines?.has(i)) continue; // skip folded lines
    const line = lines[i];
    // Fast path: line fits without wrapping (majority of lines in real code)
    if (line.length <= maxChars) {
      rows.push({ bufferLine: i, startCol: 0, text: line });
      continue;
    }
    // Slow path: word-wrap split
    let col = 0;
    while (col < line.length) {
      let end = Math.min(col + maxChars, line.length);
      if (end < line.length) {
        let breakAt = end;
        while (breakAt > col + 1 && !/\s/.test(line[breakAt - 1])) breakAt--;
        if (breakAt > col + 1) end = breakAt;
      }
      rows.push({ bufferLine: i, startCol: col, text: line.slice(col, end) });
      col = end;
    }
  }

  return rows;
}

const UNDO_GROUP_MS = 300;
const MAX_UNDO = 500;
/** Maximum total bytes across all undo snapshots (10 MB). */
const MAX_UNDO_BYTES = 10 * 1024 * 1024;

// ─── History entry ──────────────────────────────────────────────────

interface HistoryEntry {
  lines: string[];
  primary: Pos;
  extras: Pos[];
  sel: Selection | null;
  /** Approximate byte size of this snapshot's lines array. */
  byteSize: number;
}

// ─── Helpers ────────────────────────────────────────────────────────

function orderPositions(a: Pos, b: Pos): [Pos, Pos] {
  if (a.line < b.line || (a.line === b.line && a.col <= b.col)) return [a, b];
  return [b, a];
}

function clamp(pos: Pos, lines: string[]): Pos {
  const line = Math.max(0, Math.min(pos.line, lines.length - 1));
  const col = Math.max(0, Math.min(pos.col, lines[line]?.length ?? 0));
  return { line, col };
}

function findWordBoundaryLeft(line: string, col: number): number {
  if (col <= 0) return 0;
  let i = col - 1;
  while (i > 0 && /\s/.test(line[i])) i--;
  while (i > 0 && /\w/.test(line[i - 1])) i--;
  return i;
}

function findWordBoundaryRight(line: string, col: number): number {
  if (col >= line.length) return line.length;
  let i = col;
  while (i < line.length && /\w/.test(line[i])) i++;
  while (i < line.length && /\s/.test(line[i])) i++;
  return i;
}

function adjustPosAfterDelete(pos: Pos, from: Pos, to: Pos): Pos {
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

function deduplicateCursors(primary: Pos, extras: Pos[]): { primary: Pos; extras: Pos[] } {
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

// ─── Engine factory ─────────────────────────────────────────────────

export function createEditorEngine(initialText: string = "", filePath?: string) {
  // ── Reactive state ────────────────────────────────────────────

  const initial = initialText.length > 0 ? initialText.split("\n") : [""];

  const [lines, setLines]       = createSignal<string[]>(initial);
  const [cursor, setCursor]     = createSignal<Pos>({ line: 0, col: 0 });
  const [extras, setExtras]     = createSignal<Pos[]>([]);
  const [sel, setSel]           = createSignal<Selection | null>(null);
  const [editSeq, setEditSeq]   = createSignal(0);
  const [dirty, setDirty]       = createSignal(false);
  const [path, setPath]         = createSignal<string | null>(filePath ?? null);

  // ── Non-reactive internals ────────────────────────────────────

  let undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];
  let undoTotalBytes = 0;
  let lastEditTime = 0;
  let pendingSnapshot: HistoryEntry | null = null;
  let inUndoGroup = false;

  // Sticky column: remembered horizontal target for vertical movement
  let desiredCol: number | null = null;

  // Edit delta accumulator for incremental sync
  let editDeltas: EditDelta[] = [];
  let fullSyncNeeded = false;

  // Code folding state
  const foldStarts = new Set<number>();    // lines that start a fold
  const foldedLineSet = new Set<number>(); // lines that are hidden

  // Display row cache (keyed on editSeq + layout params)
  let rowCache: DisplayRow[] | null = null;
  let rowCacheKey = "";

  // ── Internal helpers ──────────────────────────────────────────

  function captureState(): HistoryEntry {
    const ls = lines().slice();
    // Approximate byte size: sum of string lengths (cheap, avoids encoding overhead)
    let size = 0;
    for (let i = 0; i < ls.length; i++) size += ls[i].length;
    return {
      lines: ls,
      primary: { ...cursor() },
      extras: extras().map(p => ({ ...p })),
      sel: sel() ? { anchor: { ...sel()!.anchor }, head: { ...sel()!.head } } : null,
      byteSize: size,
    };
  }

  function restoreState(entry: HistoryEntry) {
    batch(() => {
      setLines(entry.lines.slice());
      setCursor({ ...entry.primary });
      setExtras(entry.extras.map(p => ({ ...p })));
      setSel(entry.sel ? { anchor: { ...entry.sel.anchor }, head: { ...entry.sel.head } } : null);
      setDirty(true);
      fullSyncNeeded = true;
      setEditSeq(s => s + 1);
    });
    invalidateCache();
  }

  function flushPending() {
    if (pendingSnapshot) {
      undoStack.push(pendingSnapshot);
      undoTotalBytes += pendingSnapshot.byteSize;
      pendingSnapshot = null;
      // Evict oldest entries if over entry count or byte budget
      while (undoStack.length > MAX_UNDO || undoTotalBytes > MAX_UNDO_BYTES) {
        const evicted = undoStack.shift();
        if (evicted) undoTotalBytes -= evicted.byteSize;
        else break;
      }
    }
  }

  function recordUndo() {
    if (inUndoGroup) return;
    const now = Date.now();
    if (now - lastEditTime > UNDO_GROUP_MS) flushPending();
    if (!pendingSnapshot) pendingSnapshot = captureState();
    lastEditTime = now;
  }

  function afterEdit(deltas?: EditDelta[] | null) {
    desiredCol = null;
    setDirty(true);
    if (deltas === null || deltas === undefined) {
      fullSyncNeeded = true;
    } else {
      editDeltas.push(...deltas);
    }
    setEditSeq(s => s + 1);
    redoStack.length = 0;
    invalidateCache();
  }

  function invalidateCache() {
    rowCache = null;
    rowCacheKey = "";
  }

  // ── Core text operations (work on raw arrays, not signals) ────

  function insertAtPos(ls: string[], pos: Pos, text: string): { lines: string[]; newPos: Pos } {
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

  function backspaceAtPos(ls: string[], pos: Pos): { lines: string[]; newPos: Pos } {
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

  function deleteForwardAtPos(ls: string[], pos: Pos): string[] {
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

  function deleteRangeFromLines(ls: string[], from: Pos, to: Pos): string[] {
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

  function deleteCurrentSelection(ls: string[]): { lines: string[]; pos: Pos } {
    const s = sel();
    if (!s) return { lines: ls, pos: cursor() };
    const [from, to] = orderPositions(s.anchor, s.head);
    return { lines: deleteRangeFromLines(ls, from, to), pos: from };
  }

  // ── Public API ────────────────────────────────────────────────

  return {
    // ── Reactive reads ──────────────────────────────────────────
    lines,
    cursor,
    extras,
    sel,
    editSeq,
    dirty,
    filePath: path,

    lineCount: () => lines().length,
    getText: () => lines().join("\n"),
    getLine: (n: number) => lines()[n] ?? "",
    getCursors: () => [cursor(), ...extras()],
    hasMultiCursors: () => extras().length > 0,

    /** Take accumulated edit deltas since last call. Returns null if full-document sync is needed. */
    takeEditDeltas(): EditDelta[] | null {
      if (fullSyncNeeded) {
        editDeltas = [];
        fullSyncNeeded = false;
        return null;
      }
      const result = editDeltas;
      editDeltas = [];
      return result;
    },

    getOrderedSelection(): { from: Pos; to: Pos } | null {
      const s = sel();
      if (!s) return null;
      const [from, to] = orderPositions(s.anchor, s.head);
      return { from, to };
    },

    getTextRange(from: Pos, to: Pos): string {
      const ls = lines();
      const [s, e] = orderPositions(from, to);
      if (s.line === e.line) return (ls[s.line] ?? "").slice(s.col, e.col);
      const parts: string[] = [(ls[s.line] ?? "").slice(s.col)];
      for (let i = s.line + 1; i < e.line; i++) parts.push(ls[i] ?? "");
      parts.push((ls[e.line] ?? "").slice(0, e.col));
      return parts.join("\n");
    },

    // ── Setters ─────────────────────────────────────────────────

    setFilePath: setPath,
    markClean: () => setDirty(false),

    // ── Cursor mutations ────────────────────────────────────────

    setCursor(pos: Pos) {
      desiredCol = null;
      batch(() => { setCursor(clamp(pos, lines())); setSel(null); });
    },

    addCursor(pos: Pos) {
      const clamped = clamp(pos, lines());
      const key = `${clamped.line}:${clamped.col}`;
      const primaryKey = `${cursor().line}:${cursor().col}`;
      if (key === primaryKey) return; // Already at primary cursor
      setExtras(prev => {
        if (prev.some(p => `${p.line}:${p.col}` === key)) return prev; // Already exists
        return [...prev, clamped];
      });
    },

    clearExtras() {
      setExtras([]);
    },

    setSelection(anchor: Pos, head: Pos) {
      const ls = lines();
      batch(() => {
        setSel({ anchor: clamp(anchor, ls), head: clamp(head, ls) });
        setCursor(clamp(head, ls));
      });
    },

    clearSelection() { setSel(null); },

    selectAll() {
      const ls = lines();
      const last = ls.length - 1;
      batch(() => {
        setSel({ anchor: { line: 0, col: 0 }, head: { line: last, col: ls[last].length } });
        setCursor({ line: last, col: ls[last].length });
      });
    },

    moveCursor(dir: "left" | "right" | "up" | "down", extend: boolean = false) {
      const p = cursor();
      const ls = lines();
      let next: Pos;

      switch (dir) {
        case "left":
          if (p.col > 0) next = { line: p.line, col: p.col - 1 };
          else if (p.line > 0) next = { line: p.line - 1, col: ls[p.line - 1].length };
          else next = p;
          desiredCol = null;
          break;
        case "right": {
          const len = ls[p.line]?.length ?? 0;
          if (p.col < len) next = { line: p.line, col: p.col + 1 };
          else if (p.line < ls.length - 1) next = { line: p.line + 1, col: 0 };
          else next = p;
          desiredCol = null;
          break;
        }
        case "up": {
          if (desiredCol === null) desiredCol = p.col;
          next = p.line > 0
            ? { line: p.line - 1, col: Math.min(desiredCol, ls[p.line - 1].length) }
            : p;
          break;
        }
        case "down": {
          if (desiredCol === null) desiredCol = p.col;
          next = p.line < ls.length - 1
            ? { line: p.line + 1, col: Math.min(desiredCol, ls[p.line + 1].length) }
            : p;
          break;
        }
      }

      batch(() => {
        if (extend) {
          const anchor = sel()?.anchor ?? p;
          setSel({ anchor, head: next });
        } else {
          setSel(null);
        }
        setCursor(next);
      });
    },

    moveCursorToLineStart() {
      desiredCol = null;
      batch(() => { setCursor({ line: cursor().line, col: 0 }); setSel(null); });
    },

    moveCursorToLineEnd() {
      desiredCol = null;
      const ln = cursor().line;
      batch(() => { setCursor({ line: ln, col: lines()[ln]?.length ?? 0 }); setSel(null); });
    },

    moveWord(dir: "left" | "right", extend: boolean = false) {
      desiredCol = null;
      const p = cursor();
      const ls = lines();
      let next: Pos;

      if (dir === "left") {
        if (p.col > 0) {
          next = { line: p.line, col: findWordBoundaryLeft(ls[p.line], p.col) };
        } else if (p.line > 0) {
          next = { line: p.line - 1, col: ls[p.line - 1].length };
        } else {
          next = p;
        }
      } else {
        const len = ls[p.line]?.length ?? 0;
        if (p.col < len) {
          next = { line: p.line, col: findWordBoundaryRight(ls[p.line], p.col) };
        } else if (p.line < ls.length - 1) {
          next = { line: p.line + 1, col: 0 };
        } else {
          next = p;
        }
      }

      batch(() => {
        if (extend) {
          const anchor = sel()?.anchor ?? p;
          setSel({ anchor, head: next });
        } else {
          setSel(null);
        }
        setCursor(next);
      });
    },

    deleteWordBackward() {
      const p = cursor();
      const ls = lines();
      if (p.col > 0) {
        const wordStart = findWordBoundaryLeft(ls[p.line], p.col);
        this.deleteRange({ line: p.line, col: wordStart }, p);
      } else if (p.line > 0) {
        // At line start — merge with previous line (same as backspace)
        this.backspace();
      }
    },

    // ── Edit operations ─────────────────────────────────────────

    insert(text: string) {
      recordUndo();
      let ls = lines();
      const deltas: EditDelta[] = [];

      // Delete selection first
      if (sel()) {
        const r = deleteCurrentSelection(ls);
        ls = r.lines;
        const pos = r.pos;
        const s = sel()!;
        const [from, to] = orderPositions(s.anchor, s.head);
        // Now insert at the collapsed position
        if (extras().length > 0) {
          // Multi-cursor: adjust extras for the deleted selection, then insert
          const adjusted = extras().map(p => adjustPosAfterDelete(p, from, to));
          const all = [pos, ...adjusted].sort((a, b) => b.line !== a.line ? b.line - a.line : b.col - a.col);
          const newPositions: Pos[] = [];
          // Back-to-front: first delta replaces selection, rest are pure inserts
          deltas.push({ startLine: from.line, startCol: from.col, endLine: to.line, endCol: to.col, newText: text });
          for (const p of all) {
            if (p !== pos) {
              deltas.push({ startLine: p.line, startCol: p.col, endLine: p.line, endCol: p.col, newText: text });
            }
            const r2 = insertAtPos(ls, p, text);
            ls = r2.lines;
            newPositions.push(r2.newPos);
          }
          newPositions.reverse();
          const deduped = deduplicateCursors(newPositions[0], newPositions.slice(1));
          batch(() => {
            setLines(ls);
            setCursor(deduped.primary);
            setExtras(deduped.extras);
            setSel(null);
          });
        } else {
          deltas.push({ startLine: from.line, startCol: from.col, endLine: to.line, endCol: to.col, newText: text });
          const r2 = insertAtPos(ls, pos, text);
          batch(() => { setLines(r2.lines); setCursor(r2.newPos); setSel(null); });
        }
      } else if (extras().length > 0) {
        // Multi-cursor insert (no selection) — back-to-front order
        const all = [cursor(), ...extras()].sort((a, b) => b.line !== a.line ? b.line - a.line : b.col - a.col);
        const newPositions: Pos[] = [];
        for (const p of all) {
          deltas.push({ startLine: p.line, startCol: p.col, endLine: p.line, endCol: p.col, newText: text });
          const r = insertAtPos(ls, p, text);
          ls = r.lines;
          newPositions.push(r.newPos);
        }
        newPositions.reverse();
        const deduped = deduplicateCursors(newPositions[0], newPositions.slice(1));
        batch(() => { setLines(ls); setCursor(deduped.primary); setExtras(deduped.extras); });
      } else {
        // Single cursor insert
        const pos = cursor();
        deltas.push({ startLine: pos.line, startCol: pos.col, endLine: pos.line, endCol: pos.col, newText: text });
        const r = insertAtPos(ls, pos, text);
        batch(() => { setLines(r.lines); setCursor(r.newPos); });
      }
      afterEdit(deltas);
    },

    backspace() {
      recordUndo();
      let ls = lines();
      const deltas: EditDelta[] = [];

      if (sel()) {
        const s = sel()!;
        const [from, to] = orderPositions(s.anchor, s.head);
        deltas.push({ startLine: from.line, startCol: from.col, endLine: to.line, endCol: to.col, newText: "" });
        const r = deleteCurrentSelection(ls);
        batch(() => { setLines(r.lines); setCursor(r.pos); setSel(null); });
      } else if (extras().length > 0) {
        const all = [cursor(), ...extras()].sort((a, b) => b.line !== a.line ? b.line - a.line : b.col - a.col);
        const newPositions: Pos[] = [];
        for (const p of all) {
          if (p.col > 0) {
            deltas.push({ startLine: p.line, startCol: p.col - 1, endLine: p.line, endCol: p.col, newText: "" });
          } else if (p.line > 0) {
            const prevLen = ls[p.line - 1].length;
            deltas.push({ startLine: p.line - 1, startCol: prevLen, endLine: p.line, endCol: 0, newText: "" });
          }
          const r = backspaceAtPos(ls, p);
          ls = r.lines;
          newPositions.push(r.newPos);
        }
        newPositions.reverse();
        const deduped = deduplicateCursors(newPositions[0], newPositions.slice(1));
        batch(() => { setLines(ls); setCursor(deduped.primary); setExtras(deduped.extras); });
      } else {
        const p = cursor();
        if (p.col > 0) {
          deltas.push({ startLine: p.line, startCol: p.col - 1, endLine: p.line, endCol: p.col, newText: "" });
        } else if (p.line > 0) {
          const prevLen = ls[p.line - 1].length;
          deltas.push({ startLine: p.line - 1, startCol: prevLen, endLine: p.line, endCol: 0, newText: "" });
        }
        const r = backspaceAtPos(ls, p);
        batch(() => { setLines(r.lines); setCursor(r.newPos); });
      }
      afterEdit(deltas);
    },

    deleteForward() {
      recordUndo();
      let ls = lines();
      const deltas: EditDelta[] = [];

      if (sel()) {
        const s = sel()!;
        const [from, to] = orderPositions(s.anchor, s.head);
        deltas.push({ startLine: from.line, startCol: from.col, endLine: to.line, endCol: to.col, newText: "" });
        const r = deleteCurrentSelection(ls);
        batch(() => { setLines(r.lines); setCursor(r.pos); setSel(null); });
      } else if (extras().length > 0) {
        const all = [cursor(), ...extras()].sort((a, b) => b.line !== a.line ? b.line - a.line : b.col - a.col);
        const newPositions: Pos[] = [];
        for (const p of all) {
          const line = ls[p.line] ?? "";
          if (p.col < line.length) {
            deltas.push({ startLine: p.line, startCol: p.col, endLine: p.line, endCol: p.col + 1, newText: "" });
          } else if (p.line < ls.length - 1) {
            deltas.push({ startLine: p.line, startCol: line.length, endLine: p.line + 1, endCol: 0, newText: "" });
          }
          ls = deleteForwardAtPos(ls, p);
          newPositions.push(p);
        }
        newPositions.reverse();
        const deduped = deduplicateCursors(newPositions[0], newPositions.slice(1));
        batch(() => { setLines(ls); setCursor(deduped.primary); setExtras(deduped.extras); });
      } else {
        const p = cursor();
        const line = ls[p.line] ?? "";
        if (p.col < line.length) {
          deltas.push({ startLine: p.line, startCol: p.col, endLine: p.line, endCol: p.col + 1, newText: "" });
        } else if (p.line < ls.length - 1) {
          deltas.push({ startLine: p.line, startCol: line.length, endLine: p.line + 1, endCol: 0, newText: "" });
        }
        ls = deleteForwardAtPos(ls, p);
        setLines(ls);
      }
      afterEdit(deltas);
    },

    deleteRange(from: Pos, to: Pos) {
      recordUndo();
      const [s, e] = orderPositions(from, to);
      const ls = deleteRangeFromLines(lines(), s, e);
      batch(() => { setLines(ls); setCursor(s); setSel(null); });
      afterEdit([{ startLine: s.line, startCol: s.col, endLine: e.line, endCol: e.col, newText: "" }]);
    },

    // ── Undo / Redo ─────────────────────────────────────────────

    undo(): boolean {
      flushPending();
      const entry = undoStack.pop();
      if (!entry) return false;
      redoStack.push(captureState());
      restoreState(entry);
      return true;
    },

    redo(): boolean {
      const entry = redoStack.pop();
      if (!entry) return false;
      undoStack.push(captureState());
      restoreState(entry);
      return true;
    },

    moveCursorByDisplayRow(
      direction: "up" | "down",
      extend: boolean,
      charW: number,
      canvasWidth: number,
      wordWrap: boolean,
      gutterW: number
    ) {
      const rows = this.computeDisplayRows(charW, canvasWidth, wordWrap, gutterW);
      const c = cursor();

      let currentRow = 0;
      for (let r = 0; r < rows.length; r++) {
        const dr = rows[r];
        if (dr.bufferLine === c.line && c.col >= dr.startCol && c.col <= dr.startCol + dr.text.length) {
          currentRow = r;
          break;
        }
        if (dr.bufferLine > c.line) { currentRow = Math.max(0, r - 1); break; }
      }

      const targetRow = direction === "up"
        ? Math.max(0, currentRow - 1)
        : Math.min(rows.length - 1, currentRow + 1);

      const targetDr = rows[targetRow];
      const localCol = c.col - (rows[currentRow]?.startCol ?? 0);
      if (desiredCol === null) desiredCol = localCol;
      const newCol = targetDr.startCol + Math.min(desiredCol, targetDr.text.length);
      const next = { line: targetDr.bufferLine, col: newCol };

      batch(() => {
        if (extend) {
          const anchor = sel()?.anchor ?? c;
          setSel({ anchor, head: next });
        } else {
          setSel(null);
        }
        setCursor(next);
      });
    },

    // ── Line operations ────────────────────────────────────────

    /** Indent: insert tab at start of each line in selection, or at cursor if no selection. */
    indentLines() {
      recordUndo();
      const ls = lines();
      const s = sel();
      if (s) {
        const [from, to] = orderPositions(s.anchor, s.head);
        const newLines = [...ls];
        for (let i = from.line; i <= to.line; i++) {
          newLines[i] = "\t" + newLines[i];
        }
        batch(() => {
          setLines(newLines);
          setSel({ anchor: { line: from.line, col: from.col + 1 }, head: { line: to.line, col: to.col + 1 } });
          setCursor({ line: to.line, col: to.col + 1 });
        });
      } else {
        const c = cursor();
        const newLines = [...ls];
        newLines[c.line] = "\t" + newLines[c.line];
        batch(() => { setLines(newLines); setCursor({ line: c.line, col: c.col + 1 }); });
      }
      afterEdit(null);
    },

    /** Outdent: remove leading tab/spaces from each line in selection or current line. */
    outdentLines() {
      recordUndo();
      const ls = lines();
      const s = sel();
      const startLine = s ? Math.min(s.anchor.line, s.head.line) : cursor().line;
      const endLine = s ? Math.max(s.anchor.line, s.head.line) : cursor().line;
      const newLines = [...ls];
      const shifts: number[] = [];
      for (let i = startLine; i <= endLine; i++) {
        const line = newLines[i];
        if (line.startsWith("\t")) {
          newLines[i] = line.slice(1);
          shifts.push(1);
        } else if (line.startsWith("  ")) {
          // Remove up to 2 spaces (soft tab)
          const spaces = line.match(/^ {1,2}/)![0].length;
          newLines[i] = line.slice(spaces);
          shifts.push(spaces);
        } else {
          shifts.push(0);
        }
      }
      if (shifts.every(s => s === 0)) return; // nothing to outdent
      batch(() => {
        setLines(newLines);
        const c = cursor();
        if (c.line >= startLine && c.line <= endLine) {
          const shift = shifts[c.line - startLine];
          setCursor({ line: c.line, col: Math.max(0, c.col - shift) });
        }
        if (s) {
          const [from, to] = orderPositions(s.anchor, s.head);
          const anchorShift = shifts[from.line - startLine];
          const headShift = shifts[to.line - startLine];
          setSel({
            anchor: { line: from.line, col: Math.max(0, from.col - anchorShift) },
            head: { line: to.line, col: Math.max(0, to.col - headShift) },
          });
        }
      });
      afterEdit(null);
    },

    /** Duplicate the current line (or all lines in selection) below. */
    duplicateLines() {
      recordUndo();
      const ls = lines();
      const s = sel();
      const c = cursor();
      const startLine = s ? Math.min(s.anchor.line, s.head.line) : c.line;
      const endLine = s ? Math.max(s.anchor.line, s.head.line) : c.line;
      const toDuplicate = ls.slice(startLine, endLine + 1);
      const newLines = [...ls];
      newLines.splice(endLine + 1, 0, ...toDuplicate);
      const offset = toDuplicate.length;
      batch(() => {
        setLines(newLines);
        setCursor({ line: c.line + offset, col: c.col });
        if (s) {
          setSel({
            anchor: { line: s.anchor.line + offset, col: s.anchor.col },
            head: { line: s.head.line + offset, col: s.head.col },
          });
        }
      });
      afterEdit(null);
    },

    /** Move line(s) up or down. */
    moveLines(direction: "up" | "down") {
      const ls = lines();
      const s = sel();
      const c = cursor();
      const startLine = s ? Math.min(s.anchor.line, s.head.line) : c.line;
      const endLine = s ? Math.max(s.anchor.line, s.head.line) : c.line;
      if (direction === "up" && startLine === 0) return;
      if (direction === "down" && endLine >= ls.length - 1) return;
      recordUndo();
      const newLines = [...ls];
      if (direction === "up") {
        const removed = newLines.splice(startLine - 1, 1)[0];
        newLines.splice(endLine, 0, removed);
        batch(() => {
          setLines(newLines);
          setCursor({ line: c.line - 1, col: c.col });
          if (s) setSel({ anchor: { line: s.anchor.line - 1, col: s.anchor.col }, head: { line: s.head.line - 1, col: s.head.col } });
        });
      } else {
        const removed = newLines.splice(endLine + 1, 1)[0];
        newLines.splice(startLine, 0, removed);
        batch(() => {
          setLines(newLines);
          setCursor({ line: c.line + 1, col: c.col });
          if (s) setSel({ anchor: { line: s.anchor.line + 1, col: s.anchor.col }, head: { line: s.head.line + 1, col: s.head.col } });
        });
      }
      afterEdit(null);
    },

    /** Join current line with the next line. */
    joinLines() {
      const ls = lines();
      const c = cursor();
      if (c.line >= ls.length - 1) return;
      recordUndo();
      const newLines = [...ls];
      const currentEnd = newLines[c.line].length;
      newLines[c.line] = newLines[c.line] + " " + newLines[c.line + 1].trimStart();
      newLines.splice(c.line + 1, 1);
      batch(() => { setLines(newLines); setCursor({ line: c.line, col: currentEnd }); });
      afterEdit(null);
    },

    /** Toggle line comment for current line or selection. */
    toggleLineComment(commentPrefix: string) {
      recordUndo();
      const ls = lines();
      const s = sel();
      const c = cursor();
      const startLine = s ? Math.min(s.anchor.line, s.head.line) : c.line;
      const endLine = s ? Math.max(s.anchor.line, s.head.line) : c.line;

      // Check if all non-empty lines in range are commented
      const prefix = commentPrefix + " ";
      const allCommented = ls.slice(startLine, endLine + 1)
        .filter(l => l.trim().length > 0)
        .every(l => l.trimStart().startsWith(commentPrefix));

      const newLines = [...ls];
      if (allCommented) {
        // Uncomment: remove first occurrence of prefix
        for (let i = startLine; i <= endLine; i++) {
          const line = newLines[i];
          const idx = line.indexOf(prefix);
          if (idx !== -1) {
            newLines[i] = line.slice(0, idx) + line.slice(idx + prefix.length);
          } else {
            const idx2 = line.indexOf(commentPrefix);
            if (idx2 !== -1) newLines[i] = line.slice(0, idx2) + line.slice(idx2 + commentPrefix.length);
          }
        }
      } else {
        // Comment: find minimum indentation, insert prefix there
        let minIndent = Infinity;
        for (let i = startLine; i <= endLine; i++) {
          const line = newLines[i];
          if (line.trim().length === 0) continue;
          const indent = line.match(/^\s*/)![0].length;
          minIndent = Math.min(minIndent, indent);
        }
        if (minIndent === Infinity) minIndent = 0;
        for (let i = startLine; i <= endLine; i++) {
          if (newLines[i].trim().length === 0) continue;
          newLines[i] = newLines[i].slice(0, minIndent) + prefix + newLines[i].slice(minIndent);
        }
      }
      batch(() => {
        setLines(newLines);
        // Keep cursor roughly in place
        const colDiff = newLines[c.line].length - ls[c.line].length;
        setCursor({ line: c.line, col: Math.max(0, c.col + colDiff) });
        if (s) {
          const anchorDiff = newLines[s.anchor.line].length - ls[s.anchor.line].length;
          const headDiff = newLines[s.head.line].length - ls[s.head.line].length;
          setSel({
            anchor: { line: s.anchor.line, col: Math.max(0, s.anchor.col + anchorDiff) },
            head: { line: s.head.line, col: Math.max(0, s.head.col + headDiff) },
          });
        }
      });
      afterEdit(null);
    },

    // ── Code folding ─────────────────────────────────────────

    /** Toggle fold at a given line. Returns true if fold state changed. */
    toggleFold(line: number): boolean {
      const ls = lines();
      if (foldStarts.has(line)) {
        // Unfold
        const range = computeFoldRange(ls, line);
        if (range) {
          for (let i = range.start; i <= range.end; i++) foldedLineSet.delete(i);
        }
        foldStarts.delete(line);
        invalidateCache();
        return true;
      }
      // Fold
      if (!isFoldable(ls, line)) return false;
      const range = computeFoldRange(ls, line);
      if (!range) return false;
      foldStarts.add(line);
      for (let i = range.start; i <= range.end; i++) foldedLineSet.add(i);
      invalidateCache();
      return true;
    },

    /** Check if a line is the start of a foldable region. */
    isFoldable(line: number): boolean {
      return isFoldable(lines(), line);
    },

    /** Check if a line is currently folded (the fold start line). */
    isFolded(line: number): boolean {
      return foldStarts.has(line);
    },

    /** Get the set of hidden (folded) line indices. */
    foldedLines(): Set<number> {
      return foldedLineSet;
    },

    /** Find the matching bracket for the character at or adjacent to cursor. */
    findMatchingBracket(): { open: Pos; close: Pos } | null {
      const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
      const CLOSE_TO_OPEN: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
      const ls = lines();
      const c = cursor();
      const line = ls[c.line] ?? "";

      // Check char at cursor and char before cursor
      for (const offset of [0, -1]) {
        const col = c.col + offset;
        if (col < 0 || col >= line.length) continue;
        const ch = line[col];
        const pos: Pos = { line: c.line, col };

        if (PAIRS[ch]) {
          // Opening bracket — search forward
          const close = ch;
          const open = PAIRS[ch];
          let depth = 1;
          let sl = c.line;
          let sc = col + 1;
          while (sl < ls.length && depth > 0) {
            const l = ls[sl];
            for (let i = sc; i < l.length && depth > 0; i++) {
              if (l[i] === ch) depth++;
              else if (l[i] === open) { depth--; if (depth === 0) return { open: pos, close: { line: sl, col: i } }; }
            }
            sl++;
            sc = 0;
          }
        } else if (CLOSE_TO_OPEN[ch]) {
          // Closing bracket — search backward
          const open = CLOSE_TO_OPEN[ch];
          let depth = 1;
          let sl = c.line;
          let sc = col - 1;
          while (sl >= 0 && depth > 0) {
            const l = ls[sl];
            for (let i = sc; i >= 0 && depth > 0; i--) {
              if (l[i] === ch) depth++;
              else if (l[i] === open) { depth--; if (depth === 0) return { open: { line: sl, col: i }, close: pos }; }
            }
            sl--;
            if (sl >= 0) sc = ls[sl].length - 1;
          }
        }
      }
      return null;
    },

    beginUndoGroup() {
      flushPending();
      if (!inUndoGroup) {
        pendingSnapshot = captureState();
        inUndoGroup = true;
      }
    },

    endUndoGroup() {
      inUndoGroup = false;
    },

    // ── Display rows (cached) ───────────────────────────────────

    computeDisplayRows(charW: number, editorWidth: number, wordWrap: boolean, gutterW: number): DisplayRow[] {
      const key = `${editSeq()}:${charW}:${editorWidth}:${wordWrap}:${gutterW}`;
      if (rowCache && rowCacheKey === key) return rowCache;

      const ls = lines();
      const rows = computeDisplayRows(ls, charW, editorWidth, wordWrap, gutterW, foldedLineSet.size > 0 ? foldedLineSet : undefined);

      rowCache = rows;
      rowCacheKey = key;
      return rows;
    },

    // ── Pixel ↔ position ────────────────────────────────────────

    posFromPixel(
      clientX: number, clientY: number,
      rect: DOMRect, scrollTop: number,
      fontSize: number, lineNumbers: boolean, wordWrap: boolean,
      canvasWidth: number,
    ): Pos {
      const lineHeight = fontSize + 8;
      const gutterW = lineNumbers ? 50 : 0;
      const charW = getCharWidth(fontSize);
      const x = clientX - rect.left - gutterW - PADDING_LEFT;
      const y = clientY - rect.top + scrollTop;

      const rows = this.computeDisplayRows(charW, canvasWidth, wordWrap, gutterW);
      if (rows.length === 0) return { line: 0, col: 0 };

      const rowIdx = Math.max(0, Math.min(Math.floor(y / lineHeight), rows.length - 1));
      const dr = rows[rowIdx];
      const localCol = Math.max(0, Math.min(Math.round(x / charW), dr.text.length));
      return { line: dr.bufferLine, col: dr.startCol + localCol };
    },

    cursorDisplayRow(charW: number, canvasWidth: number, wordWrap: boolean, gutterW: number): number {
      const rows = this.computeDisplayRows(charW, canvasWidth, wordWrap, gutterW);
      const c = cursor();
      for (let r = 0; r < rows.length; r++) {
        const dr = rows[r];
        if (dr.bufferLine === c.line && c.col >= dr.startCol && c.col <= dr.startCol + dr.text.length) return r;
        if (dr.bufferLine > c.line) return Math.max(0, r - 1);
      }
      return rows.length - 1;
    },

    // ── Bulk operations ─────────────────────────────────────────

    /** Replace entire document (e.g., on file open). */
    loadText(text: string, newFilePath?: string) {
      let ls: string[];
      if (text.length === 0) {
        ls = [""];
      } else if (text.length > 5_000_000) {
        // Large file: use indexed split to avoid creating a huge intermediate array.
        // Scan for newlines and build the array incrementally.
        ls = [];
        let start = 0;
        for (let i = 0; i < text.length; i++) {
          if (text.charCodeAt(i) === 10) { // '\n'
            ls.push(text.substring(start, i));
            start = i + 1;
          }
        }
        ls.push(text.substring(start)); // last line (no trailing newline)
      } else {
        ls = text.split("\n");
      }
      batch(() => {
        setLines(ls);
        setCursor({ line: 0, col: 0 });
        setExtras([]);
        setSel(null);
        setDirty(false);
        setEditSeq(0);
        if (newFilePath !== undefined) setPath(newFilePath);
      });
      undoStack = [];
      redoStack = [];
      undoTotalBytes = 0;
      pendingSnapshot = null;
      desiredCol = null;
      editDeltas = [];
      fullSyncNeeded = false;
      invalidateCache();
    },

    /** Release all memory held by this engine (call on tab close). */
    dispose() {
      batch(() => {
        setLines([""]);
        setCursor({ line: 0, col: 0 });
        setExtras([]);
        setSel(null);
      });
      undoStack.length = 0;
      redoStack.length = 0;
      undoTotalBytes = 0;
      pendingSnapshot = null;
      editDeltas = [];
      fullSyncNeeded = false;
      invalidateCache();
    },
  };
}

export type EditorEngine = ReturnType<typeof createEditorEngine>;
