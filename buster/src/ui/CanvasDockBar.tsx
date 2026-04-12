/**
 * CanvasDockBar — canvas-rendered dock bar.
 *
 * Replaces the DOM dock bar + LayoutPicker with a single canvas.
 * Contains: Git button (left), layout preview thumbnails (right).
 * Layout thumbnails show a static-noise hover effect via requestAnimationFrame.
 */

import { Component, createSignal, createEffect, onCleanup } from "solid-js";
import CanvasChrome, { CHROME_FONT, type HitRegion, type PaintFn } from "./canvas-chrome";
import { useBuster } from "../lib/buster-context";
import type { PanelCount } from "../lib/panel-count";
import { createPanelLayoutTree, collectPanelRects } from "./panel-layout-tree";
import type { ThemePalette } from "../lib/theme";

// ── Props ────────────────────────────────────────────────────────────

interface CanvasDockBarProps {
  currentLayout: PanelCount;
  onLayoutChange: (count: PanelCount) => void;
  onGit: () => void;
}

// ── Constants ────────────────────────────────────────────────────────

const BAR_H = 38;
const BTN_PAD = 8;
const LAYOUT_BTN_W = 46;
const LAYOUT_BTN_H = 30;
const LAYOUT_GAP = 4;
const LAYOUT_CANVAS_W = 36;
const LAYOUT_CANVAS_H = 24;
const LAYOUTS: PanelCount[] = [1, 2, 3, 4, 5, 6];

// ── Component ────────────────────────────────────────────────────────

const CanvasDockBar: Component<CanvasDockBarProps> = (props) => {
  const { store } = useBuster();

  // Animation state for layout button hover static effect
  const [animatingId, setAnimatingId] = createSignal<string | null>(null);
  let animFrame: number | null = null;
  const [repaintTick, setRepaintTick] = createSignal(0);

  // Start/stop static animation when hoveredLayout changes
  createEffect(() => {
    const id = animatingId();
    if (id) {
      const loop = () => {
        setRepaintTick((t) => t + 1);
        animFrame = requestAnimationFrame(loop);
      };
      animFrame = requestAnimationFrame(loop);
    } else {
      if (animFrame !== null) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
      }
    }
  });

  onCleanup(() => {
    if (animFrame !== null) cancelAnimationFrame(animFrame);
  });

  // ── Paint ──────────────────────────────────────────────────────────

  const paint: PaintFn = (ctx, w, h, hovered) => {
    repaintTick(); // Track animation frames for static noise effect
    const palette = store.palette;
    const current = props.currentLayout;
    const regions: HitRegion[] = [];

    // Update animation state based on what CanvasChrome tells us is hovered
    const isLayoutHover = hovered?.startsWith("layout-") ?? false;
    if (isLayoutHover && animatingId() !== hovered) {
      queueMicrotask(() => setAnimatingId(hovered));
    } else if (!isLayoutHover && animatingId() !== null) {
      queueMicrotask(() => setAnimatingId(null));
    }

    // Background
    ctx.fillStyle = palette.cssCrust;
    ctx.fillRect(0, 0, w, h);
    // Top border
    ctx.fillStyle = palette.surface0;
    ctx.fillRect(0, 0, w, 1);

    // ── Git button (left) ────────────────────────────────────────────
    ctx.font = `13px ${CHROME_FONT}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    const gitText = "Git";
    const gitW = ctx.measureText(gitText).width + BTN_PAD * 2;
    const gitH = 26;
    const gitX = 4;
    const gitY = (h - gitH) / 2;
    const gitHovered = hovered === "git";

    // Button background
    ctx.fillStyle = gitHovered ? palette.surface0 : "transparent";
    ctx.beginPath();
    ctx.roundRect(gitX, gitY, gitW, gitH, 3);
    ctx.fill();
    // Button border
    ctx.strokeStyle = gitHovered ? palette.border : palette.surface0;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(gitX, gitY, gitW, gitH, 3);
    ctx.stroke();
    // Button text
    ctx.fillStyle = gitHovered ? palette.text : palette.textDim;
    ctx.fillText(gitText, gitX + BTN_PAD, h / 2);

    regions.push({
      id: "git",
      x: gitX, y: gitY, w: gitW, h: gitH,
      cursor: "pointer",
      onClick: () => props.onGit(),
    });

    // ── Layout buttons (right) ───────────────────────────────────────
    const totalLayoutW = LAYOUTS.length * LAYOUT_BTN_W + (LAYOUTS.length - 1) * LAYOUT_GAP;
    let lx = w - totalLayoutW - 4;

    for (const count of LAYOUTS) {
      const isActive = count === current;
      const regionId = `layout-${count}`;
      const isHovered = hovered === regionId;
      const ly = (h - LAYOUT_BTN_H) / 2;

      // Button bg + border
      if (isActive) {
        ctx.fillStyle = palette.surface0;
        ctx.beginPath();
        ctx.roundRect(lx, ly, LAYOUT_BTN_W, LAYOUT_BTN_H, 3);
        ctx.fill();
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(lx, ly, LAYOUT_BTN_W, LAYOUT_BTN_H, 3);
        ctx.stroke();
      } else if (isHovered) {
        ctx.fillStyle = palette.surface0;
        ctx.beginPath();
        ctx.roundRect(lx, ly, LAYOUT_BTN_W, LAYOUT_BTN_H, 3);
        ctx.fill();
      }

      // Layout preview (centered in button)
      const cx = lx + (LAYOUT_BTN_W - LAYOUT_CANVAS_W) / 2;
      const cy = ly + (LAYOUT_BTN_H - LAYOUT_CANVAS_H) / 2;
      drawLayoutPreviewInline(ctx, cx, cy, count, isActive, palette,
        isHovered && animatingId() === regionId ? 0.3 : 0);

      regions.push({
        id: regionId,
        x: lx, y: ly, w: LAYOUT_BTN_W, h: LAYOUT_BTN_H,
        cursor: "pointer",
        onClick: () => props.onLayoutChange(count),
      });

      lx += LAYOUT_BTN_W + LAYOUT_GAP;
    }

    return regions;
  };

  return (
    <CanvasChrome
      class="dock-bar"
      height={BAR_H}
      paint={paint}
      style={{ "flex-shrink": "0" }}
    />
  );
};

export default CanvasDockBar;

// ── Inline layout preview drawing ────────────────────────────────────

function drawLayoutPreviewInline(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  count: PanelCount,
  active: boolean,
  p: ThemePalette,
  staticIntensity: number,
) {
  const w = LAYOUT_CANVAS_W;
  const h = LAYOUT_CANVAS_H;
  const gap = 2;

  const bg = active ? p.surface0 : p.editorBg;
  const fg = active ? p.accent : p.textMuted;

  ctx.fillStyle = bg;
  ctx.fillRect(ox, oy, w, h);

  ctx.fillStyle = fg;
  const tree = createPanelLayoutTree(count);
  const rects = collectPanelRects(tree, { x: gap, y: gap, width: w - gap * 2, height: h - gap * 2 }, gap);
  for (const rect of rects) {
    ctx.fillRect(ox + rect.x, oy + rect.y, rect.width, rect.height);
  }

  // Static noise effect (simplified — no pixel manipulation for inline drawing)
  if (staticIntensity > 0) {
    // Draw noise dots
    for (let sy = oy; sy < oy + h; sy += 2) {
      for (let sx = ox; sx < ox + w; sx += 2) {
        if (Math.random() < staticIntensity * 0.5) {
          const v = Math.floor(Math.random() * 200 + 55);
          ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
          ctx.fillRect(sx, sy, 2, 2);
        }
      }
    }
    // Scanlines
    ctx.fillStyle = `rgba(0, 0, 0, ${0.06 * staticIntensity})`;
    for (let sy = oy; sy < oy + h; sy += 2) {
      ctx.fillRect(ox, sy, w, 1);
    }
  }
}
