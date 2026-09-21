import { orderPositions, PADDING_LEFT, type Selection, type DisplayRow } from "./engine-text-ops";
import { colToPixel } from "./text-measure";

/** Use the same wrapped rows and column measurements as the canvas selection. */
export function selectionMenuPosition(selection: Selection, rows: DisplayRow[], scrollTop: number,
  width: number, height: number, lineHeight: number, charWidth: number, gutter: number,
  menuWidth: number, menuHeight: number) {
  const [from, to] = orderPositions(selection.anchor, selection.head);
  let anchor: { x: number; top: number; bottom: number } | null = null;
  rows.forEach((row, i) => {
    const top = i * lineHeight - scrollTop;
    if (top < 0 || top + lineHeight > height || row.bufferLine < from.line || row.bufferLine > to.line) return;
    const start = Math.max(0, row.bufferLine === from.line ? from.col - row.startCol : 0);
    const end = Math.min(row.text.length, row.bufferLine === to.line ? to.col - row.startCol : row.text.length);
    const newline = row.bufferLine < to.line && start <= row.text.length;
    if (end <= start && !newline) return;
    const x = gutter + PADDING_LEFT + colToPixel(row.text, Math.max(0, end), charWidth);
    if (gutter + PADDING_LEFT + colToPixel(row.text, start, charWidth) >= width) return;
    anchor = { x, top, bottom: top + lineHeight };
  });
  if (!anchor || width < menuWidth + 8 || height < menuHeight + lineHeight + 12) return null;
  const a = anchor as { x: number; top: number; bottom: number };
  const below = a.bottom + 6;
  const y = below + menuHeight <= height - 4 ? below : a.top - menuHeight - 6;
  if (y < 4) return null;
  return { x: Math.max(4, Math.min(a.x - menuWidth / 2, width - menuWidth - 4)), y };
}
