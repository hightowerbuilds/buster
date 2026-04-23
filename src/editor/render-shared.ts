/**
 * Shared text rendering utilities for the canvas renderer modules.
 *
 * Owns the per-frame GPU context and routes text to WebGL or Canvas 2D.
 * The main renderer sets the GPU context at frame boundaries.
 */

import type { WebGLTextContext } from "./webgl-text";

let currentGpu: WebGLTextContext | null = null;

export function setCurrentGpu(gpu: WebGLTextContext | null) {
  currentGpu = gpu;
}

/** Draw text — routes to WebGL (GPU) or Canvas 2D (CPU). */
export function monoText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  font: string,
  cellW: number,
  _cellH: number,
  baselineY: number,
) {
  if (!text) return;
  if (currentGpu?.isActive()) {
    currentGpu.queueText(text, x, y, color, cellW);
    return;
  }
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y + baselineY);
}
