/**
 * Code folding and display-row computation.
 *
 * Pure functions that operate on line arrays — no signal dependencies.
 * Used by both the engine (for cached display rows) and the canvas
 * renderer (for standalone computation).
 */

import { isWideChar, stringDisplayWidth } from "./text-measure";
import { PADDING_LEFT, type DisplayRow } from "./engine-text-ops";

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

/** Standalone display-row computation for the canvas renderer. */
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

  const maxWidth = Math.max(charW * 10, editorWidth - gutterW - PADDING_LEFT - 10);
  const rows: DisplayRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (foldedLines?.has(i)) continue;
    const line = lines[i];
    // Fast path: line fits without wrapping
    if (stringDisplayWidth(line) * charW <= maxWidth) {
      rows.push({ bufferLine: i, startCol: 0, text: line });
      continue;
    }
    // Slow path: word-wrap by accumulating pixel width
    let col = 0;
    while (col < line.length) {
      let px = 0;
      let end = col;
      while (end < line.length) {
        const cw = isWideChar(line.charCodeAt(end)) ? charW * 2 : charW;
        if (px + cw > maxWidth && end > col) break;
        px += cw;
        end++;
      }
      // Try to break at a word boundary
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
