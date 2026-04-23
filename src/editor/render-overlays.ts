/**
 * Overlay renderers: autocomplete, code actions, hover tooltips,
 * signature help, and blame gutter.
 *
 * These use monoText for text rendering (GPU or CPU path).
 */

import type { DisplayRow } from "./engine-text-ops";
import { PADDING_LEFT } from "./engine-text-ops";
import { getCharWidth, FONT_FAMILY, measureTextWidth, colToPixel, stringDisplayWidth } from "./text-measure";
import type { ThemePalette } from "../lib/theme";
import { applyCursorGlow, clearCursorGlow } from "../lib/theme";
import type { GitBlameLine } from "../lib/ipc";
import { monoText } from "./render-shared";
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

// ─── Blame Gutter ──────────────────────────────────────────────────

function formatRelativeDate(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;
  return `${Math.floor(diff / 31536000)}y ago`;
}

export function drawBlameGutter(
  ctx: CanvasRenderingContext2D,
  blameData: GitBlameLine[],
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  fontSize: number,
  lineNumW: number,
  p: ThemePalette
) {
  const blameByLine = new Map<number, GitBlameLine>();
  for (const bl of blameData) {
    blameByLine.set(bl.line, bl);
  }

  let lastShownHash: string | null = null;
  let lastShownBufferLine = -1;

  const blameX = lineNumW + 6;
  const blameFont = `${fontSize - 2}px ${FONT_FAMILY}`;
  const blameCharW = getCharWidth(fontSize - 2);
  const blameBaselineY = lineHeight - Math.floor((fontSize - 2) * 0.35);

  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.startCol !== 0) continue;

    const blameLine = blameByLine.get(dr.bufferLine + 1);
    if (!blameLine) continue;

    const y = (r - firstVisRow) * lineHeight + offsetY;

    const sameGroup = blameLine.hash === lastShownHash && dr.bufferLine === lastShownBufferLine + 1;
    lastShownHash = blameLine.hash;
    lastShownBufferLine = dr.bufferLine;

    if (sameGroup) continue;

    const shortHash = blameLine.hash.slice(0, 7);
    const truncAuthor = blameLine.author.length > 12
      ? blameLine.author.slice(0, 12)
      : blameLine.author;
    const relDate = formatRelativeDate(blameLine.timestamp);
    const blameText = `${shortHash} ${truncAuthor} ${relDate}`;

    monoText(ctx, blameText, blameX, y, p.textMuted, blameFont, blameCharW, lineHeight, blameBaselineY);
  }
}

// ─── Autocomplete Dropdown ─────────────────────────────────────────

export function drawAutocomplete(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  fontSize: number,
  gutterW: number,
  charW: number,
  font: string,
  w: number,
  h: number
) {
  if (!params.completionVisible || params.completionItems.length === 0) return;

  const items = params.completionItems;
  const cLine = params.cursors[0]?.line ?? 0;
  const cCol = params.cursors[0]?.col ?? 0;
  const itemH = lineHeight;
  const maxVisible = Math.min(items.length, 8);
  const dropW = Math.min(320, w - gutterW - 40);
  const dropH = maxVisible * itemH + 4;

  let dropX = gutterW + PADDING_LEFT;
  let dropY = 0;
  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.bufferLine === cLine && cCol >= dr.startCol && cCol <= dr.startCol + dr.text.length) {
      dropX = gutterW + PADDING_LEFT + colToPixel(dr.text, cCol - dr.startCol, charW);
      dropY = (r - firstVisRow + 1) * lineHeight + offsetY;
      break;
    }
  }

  if (dropX + dropW > w) dropX = w - dropW - 8;
  if (dropX < gutterW + 4) dropX = gutterW + 4;
  if (dropY + dropH > h) dropY = dropY - dropH - lineHeight;

  ctx.fillStyle = "#181825";
  ctx.fillRect(dropX, dropY, dropW, dropH);
  ctx.strokeStyle = "#45475a";
  ctx.lineWidth = 1;
  ctx.strokeRect(dropX, dropY, dropW, dropH);

  const selIdx = params.completionIdx;
  const acBaselineY = itemH - Math.floor(fontSize * 0.35);
  for (let i = 0; i < maxVisible; i++) {
    const item = items[i];
    const iy = dropY + 2 + i * itemH;

    if (i === selIdx) {
      ctx.fillStyle = "#313244";
      ctx.fillRect(dropX + 1, iy, dropW - 2, itemH);
    }

    const labelColor = i === selIdx ? "#cdd6f4" : "#a6adc8";
    monoText(ctx, item.label, dropX + 8, iy, labelColor, font, charW, itemH, acBaselineY);

    const detailX = dropX + dropW - 8 - stringDisplayWidth(item.detail) * charW;
    monoText(ctx, item.detail, detailX, iy, "#585b70", font, charW, itemH, acBaselineY);
  }

  if (items.length > maxVisible) {
    const moreFont = `${fontSize - 2}px JetBrains Mono, monospace`;
    const moreText = `+${items.length - maxVisible} more`;
    const moreCharW = getCharWidth(fontSize - 2);
    const moreX = dropX + dropW - 8 - stringDisplayWidth(moreText) * moreCharW;
    monoText(ctx, moreText, moreX, dropY + dropH - itemH, "#585b70", moreFont, moreCharW, itemH, acBaselineY);
  }
}

// ─── Hover Tooltip ─────────────────────────────────────────────────

export function drawHoverTooltip(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  fontSize: number,
  gutterW: number,
  charW: number,
  w: number
) {
  if (!params.hoverText || !params.hoverPos) return;

  const hp = params.hoverPos;
  const text = params.hoverText;
  const tooltipLines = text.split("\n").slice(0, 8);
  const maxDisplayW = Math.max(...tooltipLines.map(l => stringDisplayWidth(l)));
  const tipW = Math.min(Math.max(maxDisplayW * charW * 0.65 + 24, 120), w - 40);
  const tipH = tooltipLines.length * (fontSize + 4) + 12;

  let tipX = gutterW + PADDING_LEFT;
  let tipY = 0;
  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.bufferLine === hp.line) {
      tipX = gutterW + PADDING_LEFT + colToPixel(dr.text, hp.col - dr.startCol, charW);
      tipY = (r - firstVisRow) * lineHeight + offsetY - tipH - 4;
      break;
    }
  }
  if (tipY < 0) tipY += tipH + lineHeight + 8;
  if (tipX + tipW > w) tipX = w - tipW - 8;

  ctx.fillStyle = "#181825";
  ctx.fillRect(tipX, tipY, tipW, tipH);
  ctx.strokeStyle = "#45475a";
  ctx.lineWidth = 1;
  ctx.strokeRect(tipX, tipY, tipW, tipH);

  const tipFont = `${fontSize - 1}px JetBrains Mono, monospace`;
  const tipCharW = getCharWidth(fontSize - 1);
  const tipLineH = fontSize + 4;
  const tipBaselineY = Math.round(tipLineH * 0.7);
  for (let i = 0; i < tooltipLines.length; i++) {
    monoText(ctx, tooltipLines[i], tipX + 8, tipY + 10 + i * tipLineH, "#cdd6f4", tipFont, tipCharW, tipLineH, tipBaselineY);
  }
}

// ─── Signature Help ────────────────────────────────────────────────

export function drawSignatureHelp(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  fontSize: number,
  gutterW: number,
  charW: number,
  font: string,
  w: number
) {
  const sig = params.signatureHelp;
  if (!sig) return;

  const cLine = params.cursors[0]?.line ?? 0;
  const cCol = params.cursors[0]?.col ?? 0;

  let tipX = gutterW + PADDING_LEFT;
  let tipY = 0;
  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.bufferLine === cLine) {
      tipX = gutterW + PADDING_LEFT + colToPixel(dr.text, cCol - dr.startCol, charW);
      tipY = (r - firstVisRow) * lineHeight + offsetY - lineHeight - 8;
      break;
    }
  }

  const sigW = Math.min(Math.max(measureTextWidth(sig.label, font) + 24, 200), w - 40);
  const sigH = lineHeight + 8;

  if (tipX + sigW > w) tipX = w - sigW - 8;
  if (tipX < gutterW + 4) tipX = gutterW + 4;
  if (tipY < 0) tipY += sigH + lineHeight + 16;

  ctx.fillStyle = "#181825";
  ctx.fillRect(tipX, tipY, sigW, sigH);
  ctx.strokeStyle = "#45475a";
  ctx.lineWidth = 1;
  ctx.strokeRect(tipX, tipY, sigW, sigH);

  const sigBaselineY = sigH - Math.floor(fontSize * 0.35) - 4;

  if (sig.parameters.length > 0 && sig.active_parameter < sig.parameters.length) {
    const activeParam = sig.parameters[sig.active_parameter].label;
    const idx = sig.label.indexOf(activeParam);
    if (idx >= 0) {
      const before = sig.label.slice(0, idx);
      const after = sig.label.slice(idx + activeParam.length);

      monoText(ctx, before, tipX + 8, tipY, "#a6adc8", font, charW, sigH, sigBaselineY);
      const beforeW = stringDisplayWidth(before) * charW;

      const boldFont = `bold ${fontSize}px JetBrains Mono, monospace`;
      monoText(ctx, activeParam, tipX + 8 + beforeW, tipY, "#f9e2af", boldFont, charW, sigH, sigBaselineY);
      const paramW = stringDisplayWidth(activeParam) * charW;

      monoText(ctx, after, tipX + 8 + beforeW + paramW, tipY, "#a6adc8", font, charW, sigH, sigBaselineY);
      return;
    }
  }

  monoText(ctx, sig.label, tipX + 8, tipY, "#cdd6f4", font, charW, sigH, sigBaselineY);
}

// ─── Code Action Light Bulb ────────────────────────────────────────

export function drawCodeActionLightBulb(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  gutterW: number
) {
  if (params.codeActionLine === null || params.codeActionItems.length === 0) return;

  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.bufferLine === params.codeActionLine && dr.startCol === 0) {
      const y = (r - firstVisRow) * lineHeight + offsetY + lineHeight / 2;
      const x = gutterW - 24;
      ctx.fillStyle = "#f9e2af";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      monoText(ctx, "!", x - 3, y - 5, "#1e1e2e", "bold 8px JetBrains Mono, monospace", 6, 10, 8);
      break;
    }
  }
}

// ─── Code Action Menu ──────────────────────────────────────────────

export function drawCodeActionMenu(
  ctx: CanvasRenderingContext2D,
  params: EditorRenderParams,
  displayRows: DisplayRow[],
  firstVisRow: number,
  lastVisRow: number,
  offsetY: number,
  lineHeight: number,
  fontSize: number,
  gutterW: number,
  charW: number,
  font: string,
  w: number,
  h: number
) {
  if (!params.codeActionMenuVisible || params.codeActionItems.length === 0) return;

  const cLine = params.cursors[0]?.line ?? 0;
  const cCol = params.cursors[0]?.col ?? 0;
  const items = params.codeActionItems;
  const itemH = lineHeight;
  const maxVisible = Math.min(items.length, 10);
  const dropW = Math.min(400, w - gutterW - 40);
  const dropH = maxVisible * itemH + 4;

  let dropX = gutterW + PADDING_LEFT;
  let dropY = 0;
  for (let r = firstVisRow; r < lastVisRow; r++) {
    const dr = displayRows[r];
    if (dr.bufferLine === cLine) {
      dropX = gutterW + PADDING_LEFT + colToPixel(dr.text, cCol - dr.startCol, charW);
      dropY = (r - firstVisRow + 1) * lineHeight + offsetY;
      break;
    }
  }

  if (dropX + dropW > w) dropX = w - dropW - 8;
  if (dropX < gutterW + 4) dropX = gutterW + 4;
  if (dropY + dropH > h) dropY = dropY - dropH - lineHeight;

  ctx.fillStyle = "#181825";
  ctx.fillRect(dropX, dropY, dropW, dropH);
  ctx.strokeStyle = "#45475a";
  ctx.lineWidth = 1;
  ctx.strokeRect(dropX, dropY, dropW, dropH);

  const selIdx = params.codeActionIdx;
  const caBaselineY = itemH - Math.floor(fontSize * 0.35);
  for (let i = 0; i < maxVisible; i++) {
    const item = items[i];
    const iy = dropY + 2 + i * itemH;

    if (i === selIdx) {
      ctx.fillStyle = "#313244";
      ctx.fillRect(dropX + 1, iy, dropW - 2, itemH);
    }

    const titleColor = i === selIdx ? "#cdd6f4" : "#a6adc8";
    monoText(ctx, item.title, dropX + 8, iy, titleColor, font, charW, itemH, caBaselineY);

    if (item.kind) {
      const kindX = dropX + dropW - 8 - stringDisplayWidth(item.kind) * charW;
      monoText(ctx, item.kind, kindX, iy, "#585b70", font, charW, itemH, caBaselineY);
    }
  }
}
