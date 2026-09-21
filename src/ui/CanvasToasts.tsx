import { UI_FONT_FAMILY } from "../lib/fonts";
import { Component, onMount, onCleanup, createEffect } from "solid-js";
import { createSignal } from "solid-js";

interface Toast {
  text: string;
  kind: "info" | "success" | "error";
  createdAt: number;
}

const TOAST_DURATION = 3000;
const FADE_DURATION = 500;
const TOAST_HEIGHT = 32;
const TOAST_GAP = 6;
const TOAST_MARGIN = 12;

const KIND_COLORS = {
  info: "#89b4fa",
  success: "#a6e3a1",
  error: "#f38ba8",
};

const [toastQueue, setToastQueue] = createSignal<Toast[]>([]);

export function showToast(text: string, kind: Toast["kind"] = "info") {
  setToastQueue((q) => [...q, { text, kind, createdAt: Date.now() }]);
}

const CanvasToasts: Component = () => {
  let canvasRef: HTMLCanvasElement | undefined;
  let animId: number;
  const [liveText, setLiveText] = createSignal("");

  // Mirror toast text to aria-live region for screen readers
  createEffect(() => {
    const q = toastQueue();
    if (q.length > 0) {
      setLiveText(q[q.length - 1].text);
    }
  });

  let running = false;

  function ensureRunning() {
    if (!running) {
      running = true;
      animId = requestAnimationFrame(render);
    }
  }

  // Kick the render loop whenever a new toast arrives
  createEffect(() => {
    if (toastQueue().length > 0) ensureRunning();
  });

  function render() {
    if (!canvasRef) { animId = requestAnimationFrame(render); return; }

    const now = Date.now();
    const toasts = toastQueue().filter((t) => now - t.createdAt < TOAST_DURATION + FADE_DURATION);

    // Prune expired toasts
    if (toasts.length !== toastQueue().length) {
      setToastQueue(toasts);
    }

    if (toasts.length === 0) {
      canvasRef.width = 0;
      canvasRef.height = 0;
      running = false;
      return; // Stop the loop — ensureRunning will restart it when needed
    }

    const dpr = window.devicePixelRatio || 1;
    const w = 300;
    const h = toasts.length * (TOAST_HEIGHT + TOAST_GAP);
    canvasRef.width = w * dpr;
    canvasRef.height = h * dpr;
    canvasRef.style.width = `${w}px`;
    canvasRef.style.height = `${h}px`;
    const ctx = canvasRef.getContext("2d")!;
    ctx.scale(dpr, dpr);

    for (let i = 0; i < toasts.length; i++) {
      const t = toasts[i];
      const age = now - t.createdAt;
      let alpha = 1;
      if (age > TOAST_DURATION) {
        alpha = 1 - (age - TOAST_DURATION) / FADE_DURATION;
      } else if (age < 200) {
        alpha = age / 200;
      }

      const y = i * (TOAST_HEIGHT + TOAST_GAP);

      // Background
      ctx.fillStyle = `rgba(24, 24, 37, ${alpha * 0.95})`;
      ctx.fillRect(0, y, w, TOAST_HEIGHT);

      // Left accent bar
      const color = KIND_COLORS[t.kind];
      ctx.fillStyle = color.replace(")", `, ${alpha})`).replace("rgb", "rgba");
      ctx.fillRect(0, y, 3, TOAST_HEIGHT);

      // Text
      ctx.font = `13px ${UI_FONT_FAMILY}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = `rgba(205, 214, 244, ${alpha})`;
      ctx.fillText(t.text, 10, y + TOAST_HEIGHT / 2);
    }

    animId = requestAnimationFrame(render);
  }

  onMount(() => {
    // Don't start render loop immediately — ensureRunning kicks it on first toast
    onCleanup(() => { cancelAnimationFrame(animId); running = false; });
  });

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: "fixed",
          bottom: `${TOAST_MARGIN + 24}px`,
          right: `${TOAST_MARGIN}px`,
          "pointer-events": "none",
          "z-index": "500",
        }}
      />
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        class="visually-hidden"
      >
        {liveText()}
      </div>
    </>
  );
};

export default CanvasToasts;
