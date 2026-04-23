/**
 * Gutter renderers: diff indicators, diagnostic dots, fold markers,
 * and inline diagnostic underlines.
 *
 * These functions use only the Canvas 2D context (no monoText/WebGL).
 */

import type { DisplayRow } from "./engine-text-ops";
import { PADDING_LEFT } from "./engine-text-ops";
import { colToPixel } from "./text-measure";
import type { EditorRenderParams } from "./canvas-renderer";

// ─── Diff Gutter Indicators ────────────────────────────────────────

const DIFF_GREEN = "#a6e3a1";
const DIFF_BLUE = "#89b4fa";
const DIFF_RED = "#f38ba8";

export function drawDiffGutter(
  ctx: CanvasRenderingContext2D,
  diffHunks: EditorRenderParams["diffHunks"],
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
) {
  const lineKind = new Map<number, string>();
  const deleteLines = new Set<number>();
  for (const hunk of diffHunks) {
    if (hunk.kind === "delete") {
      deleteLines.add(hunk.start_line - 1);
    } else {
      for (let i = 0; i < hunk.line_count; i++) {
        lineKind.set(hunk.start_line - 1 + i, hunk.kind);
      }
    }
  }

  const stripX = 0;
  const stripW = 4;

  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    const y = (r - firstVisRow) * lineHeight + offsetY;

    if (r > firstVisRow && displayRows[r - 1]?.bufferLine === dr.bufferLine) continue;

    const kind = lineKind.get(dr.bufferLine);
    if (kind) {
      ctx.fillStyle = kind === "add" ? DIFF_GREEN : DIFF_BLUE;
      ctx.fillRect(stripX, y, stripW, lineHeight);
    }

    if (deleteLines.has(dr.bufferLine) && dr.startCol === 0) {
      const triY = y + lineHeight;
      ctx.fillStyle = DIFF_RED;
      ctx.beginPath();
      ctx.moveTo(stripX, triY - 4);
      ctx.lineTo(stripX + stripW, triY);
      ctx.lineTo(stripX, triY + 4);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// ─── Diagnostic Gutter Indicators ──────────────────────────────────

export function drawDiagnosticGutter(
  ctx: CanvasRenderingContext2D,
  diagnostics: EditorRenderParams["diagnostics"],
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  gutterW: number
) {
  if (!diagnostics || diagnostics.length === 0) return;

  const lineSeverity = new Map<number, number>();
  for (const diag of diagnostics) {
    const existing = lineSeverity.get(diag.line);
    if (existing === undefined || diag.severity < existing) {
      lineSeverity.set(diag.line, diag.severity);
    }
  }

  const radius = 3;
  const dotX = gutterW - 14;

  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    const sev = lineSeverity.get(dr.bufferLine);
    if (sev === undefined) continue;
    if (r > firstVisRow && displayRows[r - 1]?.bufferLine === dr.bufferLine) continue;

    const y = (r - firstVisRow) * lineHeight + offsetY + lineHeight / 2;
    ctx.fillStyle = sev === 1 ? "#f38ba8" : sev === 2 ? "#fab387" : "#89b4fa";
    ctx.beginPath();
    ctx.arc(dotX, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Inline Diagnostic Underlines ──────────────────────────────────

export function drawDiagnostics(
  ctx: CanvasRenderingContext2D,
  diagnostics: EditorRenderParams["diagnostics"],
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  gutterW: number,
  charW: number
) {
  if (!diagnostics || diagnostics.length === 0) return;

  for (const diag of diagnostics) {
    for (let r = firstVisRow; r < lastVisRow; r++) {
      const dr = displayRows[r];
      if (dr.bufferLine >= diag.line && dr.bufferLine <= diag.endLine) {
        const startC = dr.bufferLine === diag.line ? Math.max(0, diag.col - dr.startCol) : 0;
        const endC = dr.bufferLine === diag.endLine ? Math.min(dr.text.length, diag.endCol - dr.startCol) : dr.text.length;
        if (endC > startC) {
          const x1 = gutterW + PADDING_LEFT + colToPixel(dr.text, startC, charW);
          const x2 = gutterW + PADDING_LEFT + colToPixel(dr.text, endC, charW);
          const y = (r - firstVisRow + 1) * lineHeight + offsetY - 2;
          ctx.strokeStyle = diag.severity === 1 ? "#f38ba8" : diag.severity === 2 ? "#fab387" : "#89b4fa";
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let wx = x1; wx < x2; wx += 4) {
            const wy = y + (Math.floor((wx - x1) / 4) % 2 === 0 ? 0 : 2);
            if (wx === x1) ctx.moveTo(wx, wy);
            else ctx.lineTo(wx, wy);
          }
          ctx.stroke();
        }
      }
    }
  }
}

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
