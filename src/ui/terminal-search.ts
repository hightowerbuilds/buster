/**
 * Terminal search logic.
 *
 * Pure functions for searching terminal content — takes cell rows and
 * a query, returns match positions. No component state or side effects.
 */

export interface TermSearchMatch {
  row: number;
  col: number;
  len: number;
}

export interface TermSearchOpts {
  useRegex: boolean;
  caseSensitive: boolean;
}

/** Minimal cell interface for search — only needs the character. */
interface CellLike {
  ch: string;
}

/**
 * Search all rows for matches against a query string or regex.
 * Returns an array of match positions (row/col/len).
 */
export function searchTerminalRows(
  rows: (CellLike[] | undefined)[],
  query: string,
  opts: TermSearchOpts,
): TermSearchMatch[] {
  const matches: TermSearchMatch[] = [];
  if (!query) return matches;

  let regex: RegExp | null = null;
  if (opts.useRegex) {
    try {
      regex = new RegExp(query, opts.caseSensitive ? "g" : "gi");
    } catch {
      return matches; // Invalid regex
    }
  }

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const rawText = row.map(c => c.ch).join("");

    if (regex) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(rawText)) !== null) {
        if (m[0].length === 0) { regex.lastIndex++; continue; }
        matches.push({ row: r, col: m.index, len: m[0].length });
      }
    } else {
      const text = opts.caseSensitive ? rawText : rawText.toLowerCase();
      const q = opts.caseSensitive ? query : query.toLowerCase();
      let idx = 0;
      while ((idx = text.indexOf(q, idx)) !== -1) {
        matches.push({ row: r, col: idx, len: q.length });
        idx += q.length;
      }
    }
  }

  return matches;
}

/**
 * Compute the scroll offset needed to bring a match into view.
 * Returns null if no adjustment needed.
 */
export function scrollToMatch(
  matchRow: number,
  scrollbackLength: number,
  visibleCount: number,
  currentScrollOffset: number,
): number | null {
  const totalRows = scrollbackLength + visibleCount;
  const liveStart = totalRows - visibleCount;

  if (matchRow < liveStart - currentScrollOffset ||
      matchRow >= liveStart - currentScrollOffset + visibleCount) {
    return Math.max(0, liveStart - matchRow);
  }
  return null;
}
