/**
 * Overlay renderers: autocomplete, code actions, hover tooltips,
 * cursors.
 *
 * These use monoText for text rendering (GPU or CPU path).
 */

import type { DisplayRow } from "./engine-text-ops";
import { PADDING_LEFT } from "./engine-text-ops";
import { FONT_FAMILY, colToPixel } from "./text-measure";
import type { ThemePalette } from "../lib/theme";
import { applyCursorGlow, clearCursorGlow } from "../lib/theme";
import type { EditorRenderParams } from "./canvas-renderer";

// ─── Cursors ───────────────────────────────────────────────────────

export function drawCursors(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  gutterW: number,
  charW: number,
  p: ThemePalette
) {
  if (!params.cursorVisible || !params.hasBuffer) return;

  applyCursorGlow(ctx, p);
  const isBlock = params.cursorStyle === "block";
  for (let ci = 0; ci < params.cursors.length; ci++) {
    const cLine = params.cursors[ci].line;
    const cCol = params.cursors[ci].col;
    for (let r = firstVisRow; r < lastVisRow; r++) {
      const dr = displayRows[r];
      if (dr.bufferLine === cLine && cCol >= dr.startCol && cCol <= dr.startCol + dr.text.length) {
        const x = gutterW + PADDING_LEFT + colToPixel(dr.text, cCol - dr.startCol, charW);
        const y = (r - firstVisRow) * lineHeight + offsetY;
        ctx.fillStyle = ci === 0 ? p.cursor : p.cursorAlt;
        if (isBlock) {
          ctx.globalAlpha = 0.7;
          ctx.fillRect(x, y + 1, charW, lineHeight - 2);
          ctx.globalAlpha = 1;
          const localCol = cCol - dr.startCol;
          if (localCol < dr.text.length) {
            const ch = dr.text[localCol];
            ctx.fillStyle = p.editorBg;
            ctx.font = `${params.fontSize}px ${FONT_FAMILY}`;
            ctx.textBaseline = "top";
            ctx.fillText(ch, x, y);
          }
        } else {
          ctx.fillRect(x, y + 2, 2, lineHeight - 4);
        }
        break;
      }
    }
  }
  clearCursorGlow(ctx);
}


// ─── Autocomplete Dropdown ─────────────────────────────────────────

// ─── Hover Tooltip ─────────────────────────────────────────────────

// ─── Signature Help ────────────────────────────────────────────────

// ─── Code Action Light Bulb ────────────────────────────────────────

// ─── Code Action Menu ──────────────────────────────────────────────

