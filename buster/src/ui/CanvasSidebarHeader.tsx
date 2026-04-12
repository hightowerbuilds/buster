/**
 * CanvasSidebarHeader — canvas-rendered sidebar header and action strip.
 *
 * Replaces the DOM sidebar-header and sidebar-actions-bar.
 * Header row: workspace name + In/Out buttons.
 * Action row: Open, New Folder, New File, (Close Folder).
 */

import { Component } from "solid-js";
import CanvasChrome, { CHROME_FONT, type HitRegion, type PaintFn } from "./canvas-chrome";

// ── Props ────────────────────────────────────────────────────────────

interface CanvasSidebarHeaderProps {
  title: string;
  hasWorkspace: boolean;
  poppedOut?: boolean;
  onHideSidebar?: () => void;
  onPopOut?: () => void;
  onReturn?: () => void;
  onOpen: () => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onCloseDirectory?: () => void;
}

// ── Constants ────────────────────────────────────────────────────────

const HEADER_H = 32;
const ACTION_BTN_H = 28;
const ACTION_GAP = 4;
const PAD = 12;
const FONT = `13px ${CHROME_FONT}`;
const SMALL_FONT = `12px ${CHROME_FONT}`;

// ── Component ────────────────────────────────────────────────────────

const CanvasSidebarHeader: Component<CanvasSidebarHeaderProps> = (props) => {
  // Action strip height varies: 3 buttons normally, 4 when workspace is open
  const actionCount = () => props.hasWorkspace && props.onCloseDirectory ? 4 : 3;
  const totalHeight = () => HEADER_H + actionCount() * ACTION_BTN_H + (actionCount() - 1) * ACTION_GAP + ACTION_GAP * 2;

  const paint: PaintFn = (ctx, w, h, hovered): HitRegion[] => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const bg = style.getPropertyValue("--bg-mantle").trim() || "#181825";
    const textColor = style.getPropertyValue("--text").trim() || "#cdd6f4";
    const textDim = style.getPropertyValue("--text-dim").trim() || "#a6adc8";
    const textMuted = style.getPropertyValue("--text-muted").trim() || "#7f849c";
    const surface0 = style.getPropertyValue("--bg-surface0").trim() || "#313244";
    const borderColor = style.getPropertyValue("--border").trim() || "#313244";
    const accentColor = style.getPropertyValue("--accent").trim() || "#89b4fa";

    const regions: HitRegion[] = [];

    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // ── Header row ───────────────────────────────────────────────────
    ctx.font = FONT;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const headerCy = HEADER_H / 2 + 4; // slight top padding

    // Title (truncated)
    const maxTitleW = w - PAD * 2 - 100; // leave room for buttons
    ctx.fillStyle = textColor;
    let titleText = props.title;
    if (ctx.measureText(titleText).width > maxTitleW) {
      while (titleText.length > 1 && ctx.measureText(titleText + "\u2026").width > maxTitleW) {
        titleText = titleText.slice(0, -1);
      }
      titleText += "\u2026";
    }
    ctx.fillText(titleText, PAD, headerCy);

    // Header buttons (right-aligned)
    ctx.textAlign = "right";
    let bx = w - PAD;

    // Out/Return button
    const outText = props.poppedOut ? "Return" : "Out \u00bb";
    const outW = ctx.measureText(outText).width + 12;
    const outX = bx - outW;
    const outHovered = hovered === "popout";

    ctx.fillStyle = outHovered ? surface0 : "transparent";
    ctx.fillRect(outX, headerCy - 10, outW, 20);
    ctx.fillStyle = outHovered ? textColor : textMuted;
    ctx.textAlign = "center";
    ctx.fillText(outText, outX + outW / 2, headerCy);

    regions.push({
      id: "popout",
      x: outX, y: 0, w: outW, h: HEADER_H,
      cursor: "pointer",
      onClick: () => props.poppedOut ? props.onReturn?.() : props.onPopOut?.(),
    });

    bx = outX - 4;

    // In button (hide sidebar) — only when not popped out
    if (!props.poppedOut && props.onHideSidebar) {
      const inText = "\u00ab In";
      const inW = ctx.measureText(inText).width + 12;
      const inX = bx - inW;
      const inHovered = hovered === "hide";

      ctx.fillStyle = inHovered ? surface0 : "transparent";
      ctx.fillRect(inX, headerCy - 10, inW, 20);
      ctx.fillStyle = inHovered ? textColor : textMuted;
      ctx.textAlign = "center";
      ctx.fillText(inText, inX + inW / 2, headerCy);

      regions.push({
        id: "hide",
        x: inX, y: 0, w: inW, h: HEADER_H,
        cursor: "pointer",
        onClick: () => props.onHideSidebar?.(),
      });
    }

    // ── Action buttons ───────────────────────────────────────────────
    ctx.textAlign = "left";
    ctx.font = SMALL_FONT;
    let ay = HEADER_H + ACTION_GAP;

    const actions: Array<{ id: string; label: string; onClick: () => void }> = [
      { id: "open", label: "Open", onClick: props.onOpen },
      { id: "new-folder", label: "New Folder", onClick: props.onNewFolder },
      { id: "new-file", label: "New File", onClick: props.onNewFile },
    ];

    if (props.hasWorkspace && props.onCloseDirectory) {
      actions.push({ id: "close-dir", label: "Close Folder", onClick: props.onCloseDirectory });
    }

    for (const action of actions) {
      const btnX = PAD;
      const btnW = w - PAD * 2;
      const btnHovered = hovered === action.id;

      // Button background + border
      ctx.fillStyle = btnHovered ? surface0 : "transparent";
      ctx.beginPath();
      ctx.roundRect(btnX, ay, btnW, ACTION_BTN_H, 3);
      ctx.fill();
      ctx.strokeStyle = btnHovered ? accentColor : borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(btnX, ay, btnW, ACTION_BTN_H, 3);
      ctx.stroke();

      // Label
      ctx.fillStyle = btnHovered ? textColor : textDim;
      ctx.textBaseline = "middle";
      ctx.fillText(action.label, btnX + 8, ay + ACTION_BTN_H / 2);

      regions.push({
        id: action.id,
        x: btnX, y: ay, w: btnW, h: ACTION_BTN_H,
        cursor: "pointer",
        onClick: action.onClick,
      });

      ay += ACTION_BTN_H + ACTION_GAP;
    }

    return regions;
  };

  return (
    <CanvasChrome
      class="sidebar-header-canvas"
      height={totalHeight()}
      paint={paint}
      style={{ "flex-shrink": "0" }}
    />
  );
};

export default CanvasSidebarHeader;
