import { Component, For, createEffect, createSignal, onCleanup } from "solid-js";
import { useBuster } from "../lib/buster-context";
import type { ThemePalette } from "../lib/theme";
import { panelDescription, panelLabel, type PanelCount } from "../lib/panel-count";
import { collectPanelRects, createPanelLayoutTree } from "./panel-layout-tree";

interface LayoutPickerProps {
  current: PanelCount;
  onChange: (count: PanelCount) => void;
}

export const PRIMARY_LAYOUT_OPTIONS: Array<{
  count: PanelCount;
  label: string;
  description: string;
}> = [
  { count: 1, label: panelLabel(1), description: panelDescription(1) },
  { count: 2, label: panelLabel(2), description: panelDescription(2) },
  { count: 3, label: panelLabel(3), description: panelDescription(3) },
  { count: 4, label: panelLabel(4), description: panelDescription(4) },
  { count: 5, label: panelLabel(5), description: panelDescription(5) },
  { count: 6, label: panelLabel(6), description: panelDescription(6) },
];

function drawLayoutPreview(
  canvas: HTMLCanvasElement,
  count: PanelCount,
  active: boolean,
  p: ThemePalette,
  staticIntensity: number = 0,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = 36;
  const h = 24;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  const bg = active ? p.surface0 : p.editorBg;
  const fg = active ? p.accent : p.textMuted;
  const gap = 2;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = fg;
  const tree = createPanelLayoutTree(count);
  const rects = collectPanelRects(tree, {
    x: gap,
    y: gap,
    width: w - gap * 2,
    height: h - gap * 2,
  }, gap);

  for (const rect of rects) {
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }

  if (staticIntensity > 0) {
    const imageData = ctx.getImageData(0, 0, w * dpr, h * dpr);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      if (Math.random() < staticIntensity) {
        const v = Math.random() * 255;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 90 + Math.random() * 38;
      }
    }

    const tearCount = Math.floor(Math.random() * 3);
    for (let t = 0; t < tearCount; t++) {
      const y = Math.floor(Math.random() * h * dpr);
      const shift = Math.floor(Math.random() * 6) - 3;
      if (shift === 0) continue;

      const rowStart = y * w * dpr * 4;
      const rowEnd = rowStart + w * dpr * 4;
      if (rowEnd > data.length) continue;

      const row = data.slice(rowStart, rowEnd);
      const absShift = Math.abs(shift) * 4;
      for (let pIdx = 0; pIdx < row.length; pIdx++) {
        const src = shift > 0 ? (pIdx + absShift) % row.length : (pIdx - absShift + row.length) % row.length;
        data[rowStart + pIdx] = row[src];
      }
    }

    ctx.putImageData(imageData, 0, 0);

    ctx.fillStyle = `rgba(0, 0, 0, ${0.06 * staticIntensity})`;
    for (let sy = 0; sy < h; sy += 2) {
      ctx.fillRect(0, sy, w, 1);
    }
  }
}

const LayoutOptionButton: Component<{
  layout: typeof PRIMARY_LAYOUT_OPTIONS[number];
  active: boolean;
  onSelect: () => void;
}> = (props) => {
  const { store } = useBuster();
  let canvasRef: HTMLCanvasElement | undefined;
  const [hovering, setHovering] = createSignal(false);
  let anim: number | null = null;

  const draw = (intensity: number = 0) => {
    if (!canvasRef) return;
    drawLayoutPreview(canvasRef, props.layout.count, props.active, store.palette, intensity);
  };

  createEffect(() => {
    store.palette;
    props.active;
    if (!hovering()) draw(0);
  });

  createEffect(() => {
    if (!hovering()) {
      if (anim !== null) {
        cancelAnimationFrame(anim);
        anim = null;
      }
      draw(0);
      return;
    }

    const loop = () => {
      if (!hovering()) {
        anim = null;
        draw(0);
        return;
      }
      draw(0.3);
      anim = requestAnimationFrame(loop);
    };

    if (anim === null) {
      anim = requestAnimationFrame(loop);
    }
  });

  onCleanup(() => {
    if (anim !== null) cancelAnimationFrame(anim);
  });

  return (
    <button
      class={`layout-button ${props.active ? "layout-button-active" : ""}`}
      type="button"
      aria-pressed={props.active}
      title={`${props.layout.description} (Ctrl+\` then ${props.layout.label.slice(1)})`}
      onClick={props.onSelect}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <canvas ref={(el) => {
        canvasRef = el;
        requestAnimationFrame(() => draw(0));
      }} />
    </button>
  );
};

const LayoutPicker: Component<LayoutPickerProps> = (props) => {
  return (
    <div class="layout-picker" role="group" aria-label="Panel layouts">
      <For each={PRIMARY_LAYOUT_OPTIONS}>
        {(layout) => (
          <LayoutOptionButton
            layout={layout}
            active={layout.count === props.current}
            onSelect={() => props.onChange(layout.count)}
          />
        )}
      </For>
    </div>
  );
};

export default LayoutPicker;
