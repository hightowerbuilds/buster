import type { DisplayRow } from "./engine-text-ops";
import type { WritingLayout } from "../lib/writing-appearance";

export function isMarkdownPath(path: string | null | undefined): boolean {
  return /\.(md|markdown)$/i.test(path ?? "");
}

/** Column width includes the editor gutter. Insets yield before the usable editor does. */
export function writingViewportBox(width: number, height: number, layout: WritingLayout, markdown = true) {
  width = Math.max(0, width);
  height = Math.max(0, height);
  if (!markdown) return { left: 0, top: 0, width, height };
  const horizontal = layout.paddingLeft + layout.paddingRight;
  const vertical = layout.paddingTop + layout.paddingBottom;
  const xScale = horizontal ? Math.min(1, Math.max(0, width - 160) / horizontal) : 1;
  const yScale = vertical ? Math.min(1, Math.max(0, height - 44) / vertical) : 1;
  const availableWidth = width - horizontal * xScale;
  const columnWidth = layout.columnWidth > 0 ? Math.min(availableWidth, Math.max(160, layout.columnWidth)) : availableWidth;
  return {
    left: layout.paddingLeft * xScale + (layout.alignment === "center" ? (availableWidth - columnWidth) / 2 : 0),
    top: layout.paddingTop * yScale,
    width: columnWidth,
    height: height - vertical * yScale,
  };
}

export interface WritingScrollAnchor { line: number; col: number; fraction: number }

export function captureWritingScroll(rows: DisplayRow[], scrollTop: number, lineHeight: number): WritingScrollAnchor | null {
  if (!rows.length || lineHeight <= 0) return null;
  const top = Math.max(0, scrollTop);
  const index = Math.min(rows.length - 1, Math.floor(top / lineHeight));
  return { line: rows[index].bufferLine, col: rows[index].startCol, fraction: Math.min(0.999999, (top - index * lineHeight) / lineHeight) };
}

export function restoreWritingScroll(rows: DisplayRow[], anchor: WritingScrollAnchor | null, lineHeight: number): number {
  if (!anchor || !rows.length) return 0;
  // Prefer the last wrap segment starting before the anchor. At a wrap boundary
  // this deliberately selects the following segment, unlike caret affinity.
  let index = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.bufferLine > anchor.line || (row.bufferLine === anchor.line && row.startCol > anchor.col)) break;
    index = i;
  }
  return clampWritingScroll((index + anchor.fraction) * lineHeight, rows.length, lineHeight);
}

/** Retain the editor's existing last-line-at-top scroll convention. */
export function clampWritingScroll(top: number, rowCount: number, lineHeight: number): number {
  return Math.max(0, Math.min(top, Math.max(0, rowCount - 1) * lineHeight));
}
