/**
 * CanvasBreadcrumbs — canvas-rendered file path breadcrumb strip.
 *
 * Replaces the DOM breadcrumb-bar. Shows path segments with "/" separators.
 * Last segment is highlighted, others are dim.
 */

import { Component } from "solid-js";
import CanvasChrome, { CHROME_FONT, type HitRegion, type PaintFn } from "./canvas-chrome";

// ── Props ────────────────────────────────────────────────────────────

interface CanvasBreadcrumbsProps {
  segments: string[];
}

// ── Constants ────────────────────────────────────────────────────────

const BAR_H = 22;
const FONT = `12px ${CHROME_FONT}`;
const PAD = 12;
const SEP_PAD = 4;

// ── Component ────────────────────────────────────────────────────────

const CanvasBreadcrumbs: Component<CanvasBreadcrumbsProps> = (props) => {
  const paint: PaintFn = (ctx, w, h, _hovered): HitRegion[] => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const bg = style.getPropertyValue("--bg-mantle").trim() || "#181825";
    const borderColor = style.getPropertyValue("--bg-surface0").trim() || "#313244";
    const textColor = style.getPropertyValue("--text").trim() || "#cdd6f4";
    const textDim = style.getPropertyValue("--text-dim").trim() || "#a6adc8";
    const textMuted = style.getPropertyValue("--text-muted").trim() || "#7f849c";

    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    // Bottom border
    ctx.fillStyle = borderColor;
    ctx.fillRect(0, h - 1, w, 1);

    ctx.font = FONT;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const cy = h / 2;
    let x = PAD;

    const segs = props.segments;
    for (let i = 0; i < segs.length; i++) {
      if (i > 0) {
        ctx.fillStyle = textMuted;
        ctx.fillText("/", x, cy);
        x += ctx.measureText("/").width + SEP_PAD;
      }
      const isLast = i === segs.length - 1;
      ctx.fillStyle = isLast ? textColor : textDim;
      ctx.fillText(segs[i], x, cy);
      x += ctx.measureText(segs[i]).width + SEP_PAD;
    }

    return [];
  };

  return (
    <CanvasChrome
      class="breadcrumb-bar"
      height={BAR_H}
      paint={paint}
    />
  );
};

export default CanvasBreadcrumbs;
