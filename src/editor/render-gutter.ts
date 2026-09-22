/**
 * Gutter renderers: fold markers.
 *
 * These functions use only the Canvas 2D context (no monoText/WebGL).
 */

import type { DisplayRow } from "./engine-text-ops";
import type { EditorRenderParams } from "./canvas-renderer";

// ─── Diff Gutter Indicators ────────────────────────────────────────


// ─── Fold Markers ──────────────────────────────────────────────────

export function drawFoldMarkers(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  _charW: number,
) {
  let lastLine = -1;
  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.bufferLine === lastLine) continue;
    lastLine = dr.bufferLine;
    const y = (r - firstVisRow) * lineHeight + offsetY;
    const isFolded = params.foldStartLines.has(dr.bufferLine);
    const canFold = isFolded || params.isFoldable(dr.bufferLine);

    if (canFold) {
      const cx = 10;
      const cy = y + lineHeight / 2;
      const sz = 4;

      ctx.fillStyle = params.palette.textMuted;
      ctx.beginPath();
      if (isFolded) {
        ctx.moveTo(cx, cy - sz);
        ctx.lineTo(cx + sz, cy);
        ctx.lineTo(cx, cy + sz);
      } else {
        ctx.moveTo(cx - sz, cy - sz / 2);
        ctx.lineTo(cx + sz, cy - sz / 2);
        ctx.lineTo(cx, cy + sz);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}
