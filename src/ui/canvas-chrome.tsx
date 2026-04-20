/**
 * CanvasChrome — shared foundation for canvas-rendered UI chrome strips.
 *
 * Each chrome element (tab bar, dock bar, status bar, breadcrumbs, sidebar header)
 * wraps this component and provides a paint function. CanvasChrome handles:
 *   - Canvas lifecycle and DPR scaling
 *   - Container resize observation
 *   - Hit-region-based pointer interaction (hover, click, pointerdown)
 *   - Automatic repaint via SolidJS createEffect
 */

import { Component, createSignal, createEffect, onMount, onCleanup, type JSX } from "solid-js";

// ── Types ────────────────────────────────────────────────────────────

/** A rectangular region on the canvas that responds to pointer events. */
export interface HitRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cursor?: string;
  onClick?: (e: MouseEvent) => void;
  onDblClick?: (e: MouseEvent) => void;
  onPointerDown?: (e: PointerEvent) => void;
}

/**
 * Paint function signature.
 * Called inside a createEffect — any reactive state accessed here triggers repaint.
 * Must return the list of hit regions valid for this frame.
 */
export type PaintFn = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  hovered: string | null,
) => HitRegion[];

export interface CanvasChromeProps {
  class?: string;
  style?: JSX.CSSProperties;
  height: number;
  paint: PaintFn;
  onWheel?: (e: WheelEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  tabIndex?: number;
  children?: JSX.Element;
  role?: string;
  "aria-label"?: string;
}

// ── Chrome font constant ─────────────────────────────────────────────

export const CHROME_FONT = '"Courier New", Courier, monospace';
export const CHROME_MONO = '"JetBrains Mono", Menlo, Monaco, Consolas, monospace';

// ── Component ────────────────────────────────────────────────────────

const CanvasChrome: Component<CanvasChromeProps> = (props) => {
  let containerRef!: HTMLDivElement;
  let canvasRef!: HTMLCanvasElement;

  const [width, setWidth] = createSignal(0);
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [fontReady, setFontReady] = createSignal(false);

  let regions: HitRegion[] = [];

  // ── Resize observation ───────────────────────────────────────────

  onMount(() => {
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(containerRef);
    onCleanup(() => ro.disconnect());

    // Trigger repaint once fonts are loaded (text metrics change)
    document.fonts.ready.then(() => setFontReady(true));
  });

  // ── Paint effect ─────────────────────────────────────────────────

  createEffect(() => {
    // Track font readiness so we repaint once web fonts load
    fontReady();

    const w = width();
    const h = props.height;
    if (w <= 0 || h <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvasRef.width = w * dpr;
    canvasRef.height = h * dpr;
    canvasRef.style.width = `${w}px`;
    canvasRef.style.height = `${h}px`;

    const ctx = canvasRef.getContext("2d", { alpha: false })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, w, h);

    regions = props.paint(ctx, w, h, hovered());
  });

  // ── Hit testing ──────────────────────────────────────────────────

  function hitTest(clientX: number, clientY: number): HitRegion | null {
    const rect = canvasRef.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    // Walk in reverse so later (top-most) regions win
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
        return r;
      }
    }
    return null;
  }

  function handleMouseMove(e: MouseEvent) {
    const region = hitTest(e.clientX, e.clientY);
    const id = region?.id ?? null;
    if (id !== hovered()) {
      setHovered(id);
      containerRef.style.cursor = region?.cursor ?? "default";
    }
  }

  function handleClick(e: MouseEvent) {
    const region = hitTest(e.clientX, e.clientY);
    region?.onClick?.(e);
  }

  function handleDblClick(e: MouseEvent) {
    const region = hitTest(e.clientX, e.clientY);
    region?.onDblClick?.(e);
  }

  function handlePointerDown(e: PointerEvent) {
    const region = hitTest(e.clientX, e.clientY);
    region?.onPointerDown?.(e);
  }

  function handleMouseLeave() {
    if (hovered() !== null) {
      setHovered(null);
      containerRef.style.cursor = "default";
    }
  }

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div
      ref={(el) => { containerRef = el; }}
      class={props.class}
      style={{ height: `${props.height}px`, overflow: "hidden", position: "relative", ...props.style }}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      onDblClick={handleDblClick}
      onPointerDown={handlePointerDown}
      onMouseLeave={handleMouseLeave}
      onWheel={props.onWheel}
      onContextMenu={props.onContextMenu}
      onKeyDown={props.onKeyDown}
      tabIndex={props.tabIndex}
      role={props.role}
      aria-label={props["aria-label"]}
    >
      <canvas ref={(el) => { canvasRef = el; }} style={{ display: "block" }} />
      {props.children}
    </div>
  );
};

export default CanvasChrome;
