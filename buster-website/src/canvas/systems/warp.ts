import { ctx, dpr, W, H } from '../state/canvas-state';
import { scrollY } from '../state/scroll-state';
import {
  warpSources,
  dragActive, dragGrabX, dragGrabY, dragPullX, dragPullY, dragVelX, dragVelY,
  setDragPhysics,
} from '../state/interaction-state';

const WARP_DECAY = 0.92;

export const WARP_RADIUS = 85;
export const WARP_FORCE = 25;

export function applyWarpPost() {
  if (warpSources.length === 0) return;

  for (const w of warpSources) {
    const sx = w.x * dpr;
    const sy = (w.y - scrollY) * dpr;
    const sr = w.radius * dpr;

    const bx = Math.max(0, Math.floor(sx - sr));
    const by = Math.max(0, Math.floor(sy - sr));
    const bx2 = Math.min(Math.floor(W * dpr), Math.ceil(sx + sr));
    const by2 = Math.min(Math.floor(H * dpr), Math.ceil(sy + sr));
    const bw = bx2 - bx;
    const bh = by2 - by;
    if (bw <= 0 || bh <= 0) continue;

    const imageData = ctx.getImageData(bx, by, bw, bh);
    const src = new Uint8ClampedArray(imageData.data);
    const dst = imageData.data;

    for (let py = 0; py < bh; py++) {
      for (let px = 0; px < bw; px++) {
        const worldX = (bx + px) / dpr;
        const worldY = (by + py) / dpr;
        const dx = worldX - w.x;
        const dy = worldY - (w.y - scrollY);
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < w.radius && dist > 0) {
          const t = 1 - dist / w.radius;
          const strength = t * t * w.force;
          const srcPx = Math.round(px - (dx / dist) * strength * dpr);
          const srcPy = Math.round(py - (dy / dist) * strength * dpr);
          const di = (py * bw + px) * 4;

          if (srcPx >= 0 && srcPx < bw && srcPy >= 0 && srcPy < bh) {
            const si = (srcPy * bw + srcPx) * 4;
            dst[di]     = src[si];
            dst[di + 1] = src[si + 1];
            dst[di + 2] = src[si + 2];
            dst[di + 3] = src[si + 3];
          } else {
            dst[di + 3] = 0;
          }
        }
      }
    }
    ctx.putImageData(imageData, bx, by);
  }
}

export function updateWarps() {
  for (let i = warpSources.length - 1; i >= 0; i--) {
    warpSources[i].force *= WARP_DECAY;
    if (warpSources[i].force < 0.3) {
      warpSources.splice(i, 1);
    }
  }
}

// ─── Drag (rubber-sheet pull) ──────────────────────────────────────────────

const DRAG_RADIUS = 300;
const DRAG_SPRING = 0.12;
const DRAG_DAMPING = 0.78;

export function updateDrag() {
  // Spring physics only when not actively dragging
  if (dragActive) return;
  if (Math.abs(dragPullX) < 0.1 && Math.abs(dragPullY) < 0.1 &&
      Math.abs(dragVelX) < 0.05 && Math.abs(dragVelY) < 0.05) {
    if (dragPullX !== 0 || dragPullY !== 0) {
      setDragPhysics(0, 0, 0, 0);
    }
    return;
  }

  const nvx = (dragVelX + -dragPullX * DRAG_SPRING) * DRAG_DAMPING;
  const nvy = (dragVelY + -dragPullY * DRAG_SPRING) * DRAG_DAMPING;
  setDragPhysics(dragPullX + nvx, dragPullY + nvy, nvx, nvy);
}

export function applyDragPost() {
  if (dragPullX === 0 && dragPullY === 0) return;

  const gx = dragGrabX;
  const gy = dragGrabY - scrollY; // screen space

  const bx = Math.max(0, Math.floor((gx - DRAG_RADIUS) * dpr));
  const by = Math.max(0, Math.floor((gy - DRAG_RADIUS) * dpr));
  const bx2 = Math.min(Math.floor(W * dpr), Math.ceil((gx + DRAG_RADIUS) * dpr));
  const by2 = Math.min(Math.floor(H * dpr), Math.ceil((gy + DRAG_RADIUS) * dpr));
  const bw = bx2 - bx;
  const bh = by2 - by;
  if (bw <= 0 || bh <= 0) return;

  const imageData = ctx.getImageData(bx, by, bw, bh);
  const src = new Uint8ClampedArray(imageData.data);
  const dst = imageData.data;

  const pullXpx = dragPullX * dpr;
  const pullYpx = dragPullY * dpr;

  for (let py = 0; py < bh; py++) {
    for (let px = 0; px < bw; px++) {
      const worldX = (bx + px) / dpr;
      const worldY = (by + py) / dpr;
      const dx = worldX - gx;
      const dy = worldY - gy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < DRAG_RADIUS) {
        const t = 1 - dist / DRAG_RADIUS;
        const falloff = t * t * t; // cubic — tight pull at center, gentle at edges
        const srcPx = Math.round(px - pullXpx * falloff);
        const srcPy = Math.round(py - pullYpx * falloff);
        const di = (py * bw + px) * 4;

        if (srcPx >= 0 && srcPx < bw && srcPy >= 0 && srcPy < bh) {
          const si = (srcPy * bw + srcPx) * 4;
          dst[di]     = src[si];
          dst[di + 1] = src[si + 1];
          dst[di + 2] = src[si + 2];
          dst[di + 3] = src[si + 3];
        } else {
          dst[di + 3] = 0;
        }
      }
    }
  }
  ctx.putImageData(imageData, bx, by);
}
