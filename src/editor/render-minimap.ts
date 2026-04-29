/**
 * Minimap and scrollbar indicator rendering.
 *
 * Pure Canvas 2D — no monoText/WebGL dependency.
 */

import type { DisplayRow } from "./engine-text-ops";
import type { EditorRenderParams } from "./canvas-renderer";

export const MINIMAP_W = 64;
export const MINIMAP_LINE_H = 2;
export const MINIMAP_PAD = 4;
export const SCROLLBAR_W = 8;

export function minimapLeft(canvasWidth: number): number {
  return canvasWidth - MINIMAP_W - SCROLLBAR_W - MINIMAP_PAD;
}

export function minimapScrollTarget(
  y: number,
  totalRows: number,
  viewportHeight: number,
  lineHeight: number,
): number {
  if (totalRows <= 0 || viewportHeight <= 0 || lineHeight <= 0) return 0;
  const scaledH = totalRows * MINIMAP_LINE_H;
  const scale = scaledH <= viewportHeight ? 1 : viewportHeight / scaledH;
  const rowH = MINIMAP_LINE_H * scale;
  const clickedRow = y / rowH;
  const visibleRows = Math.ceil(viewportHeight / lineHeight);
  const maxScroll = Math.max(0, totalRows * lineHeight - viewportHeight);
  return Math.max(0, Math.min(maxScroll, (clickedRow - visibleRows / 2) * lineHeight));
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  lineHeight: number,
  w: number,
  h: number,
  _gutterW: number,
  _charW: number,
) {
  const totalRows = displayRows.length;
  if (totalRows === 0) return;

  const p = params.palette;
  const mapX = minimapLeft(w);
  const mapW = MINIMAP_W;
  const mapH = h;
  const scrollBarX = w - SCROLLBAR_W;

  const scaledH = totalRows * MINIMAP_LINE_H;
  const scale = scaledH <= mapH ? 1 : mapH / scaledH;
  const rowH = MINIMAP_LINE_H * scale;

  // Minimap background
  ctx.fillStyle = p.gutterBg;
  ctx.globalAlpha = 0.6;
  ctx.fillRect(mapX, 0, mapW + SCROLLBAR_W + MINIMAP_PAD, h);
  ctx.globalAlpha = 1;

  // Viewport indicator
  const visRows = Math.ceil(h / lineHeight);
  const firstVisRow = Math.floor(params.scrollTop / lineHeight);
  const vpY = firstVisRow * rowH;
  const vpH = Math.max(8, visRows * rowH);
  ctx.fillStyle = p.selection || "rgba(205, 214, 244, 0.1)";
  ctx.fillRect(mapX, vpY, mapW, vpH);

  // Draw minimap lines
  const lineTokens = params.lineTokens;
  const miniCharW = mapW / 80;

  for (let r = 0; r < totalRows; r++) {
    const y = r * rowH;
    if (y > mapH) break;
    const dr = displayRows[r];
    const text = dr.text;
    if (text.length === 0) continue;

    const tokens = lineTokens[dr.bufferLine];
    if (tokens && tokens.length > 0) {
      for (const token of tokens) {
        const startCol = Math.max(0, (token as any).startCol - dr.startCol);
        const endCol = Math.min(text.length, (token as any).endCol - dr.startCol);
        if (endCol <= startCol) continue;
        const tx = mapX + startCol * miniCharW;
        const tw = (endCol - startCol) * miniCharW;
        ctx.fillStyle = (p as any).syntax[(token as any).type] || p.text;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(tx, y, Math.max(1, tw), Math.max(1, rowH));
      }
    } else {
      const tw = Math.min(text.length, 80) * miniCharW;
      ctx.fillStyle = p.textMuted;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(mapX, y, Math.max(1, tw), Math.max(1, rowH));
    }
    ctx.globalAlpha = 1;
  }

  // Scrollbar track
  ctx.fillStyle = (p as any).surface0 || "#313244";
  ctx.globalAlpha = 0.3;
  ctx.fillRect(scrollBarX, 0, SCROLLBAR_W, h);
  ctx.globalAlpha = 1;

  // Scrollbar thumb
  const totalH = totalRows * lineHeight;
  const thumbRatio = h / totalH;
  const thumbH = Math.max(20, h * thumbRatio);
  const thumbY = (params.scrollTop / totalH) * (h - thumbH);
  ctx.fillStyle = p.textMuted;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(scrollBarX + 1, thumbY, SCROLLBAR_W - 2, thumbH);
  ctx.globalAlpha = 1;

  // Diagnostic markers on scrollbar
  if (params.diagnostics.length > 0) {
    for (const d of params.diagnostics) {
      const diagRow = d.line / Math.max(1, params.lines.length);
      const markerY = diagRow * h;
      ctx.fillStyle = d.severity === 1 ? "#f38ba8" : d.severity === 2 ? "#fab387" : "#89b4fa";
      ctx.fillRect(scrollBarX, markerY, SCROLLBAR_W, 2);
    }
  }

  // Search match markers on scrollbar
  if (params.searchMatches.length > 0) {
    ctx.fillStyle = (p as any).searchHighlight || "#f9e2af";
    for (const m of params.searchMatches) {
      const matchRow = m.line / Math.max(1, params.lines.length);
      const markerY = matchRow * h;
      ctx.fillRect(scrollBarX, markerY, SCROLLBAR_W, 2);
    }
  }

  // Cursor position marker on scrollbar
  if (params.cursors.length > 0) {
    const cursorRow = params.cursors[0].line / Math.max(1, params.lines.length);
    const cursorY = cursorRow * h;
    ctx.fillStyle = p.text;
    ctx.fillRect(scrollBarX, cursorY, SCROLLBAR_W, 2);
  }
}
