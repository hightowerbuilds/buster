import { Component, onMount, onCleanup } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { paintDisplayList, clearImageCache, type DrawCommand } from "./DisplayListPainter";
import { surfaceResizeNotify, surfaceGetLastPaint, extCall, hideAllBrowserViews, showAllBrowserViews } from "../lib/ipc";

interface SurfaceEvent {
  surface_id: number;
  extension_id: string;
  kind: string;
  content: string;
}

interface DisplayListSurfaceProps {
  surfaceId: number;
  extensionId: string;
  initialWidth: number;
  initialHeight: number;
  label: string;
  isActive?: boolean;
}

const DisplayListSurface: Component<DisplayListSurfaceProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let currentWidth = props.initialWidth;
  let currentHeight = props.initialHeight;
  let wasVisible = false;

  function paint(commands: DrawCommand[]) {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    paintDisplayList(ctx, commands, currentWidth, currentHeight, dpr);
  }

  function reportSizeToExtension() {
    if (!containerRef) return;
    const rect = containerRef.getBoundingClientRect();
    extCall(
      props.extensionId,
      "on_resize",
      JSON.stringify({
        width: currentWidth,
        height: currentHeight,
        abs_x: Math.round(rect.left),
        abs_y: Math.round(rect.top),
      }),
    ).catch(() => {});
  }

  onMount(() => {
    if (!canvasRef || !containerRef) return;

    const dpr = window.devicePixelRatio || 1;
    canvasRef.width = currentWidth * dpr;
    canvasRef.height = currentHeight * dpr;
    canvasRef.style.width = `${currentWidth}px`;
    canvasRef.style.height = `${currentHeight}px`;

    // Listen for surface paint events
    const unlistenPromise = listen<SurfaceEvent>("surface-event", (event) => {
      const payload = event.payload;
      if (payload.surface_id !== props.surfaceId) return;

      if (payload.kind === "paint") {
        try {
          const commands: DrawCommand[] = JSON.parse(payload.content);
          paint(commands);
        } catch {
          console.error("Failed to parse display list:", payload.content.slice(0, 200));
        }
      } else if (payload.kind === "resize") {
        try {
          const meta = JSON.parse(payload.content);
          currentWidth = meta.width;
          currentHeight = meta.height;
          const dpr = window.devicePixelRatio || 1;
          if (canvasRef) {
            canvasRef.width = currentWidth * dpr;
            canvasRef.height = currentHeight * dpr;
            canvasRef.style.width = `${currentWidth}px`;
            canvasRef.style.height = `${currentHeight}px`;
          }
        } catch {}
      }
    });

    // Fetch any buffered paint from before this component mounted
    surfaceGetLastPaint(props.surfaceId).then((content) => {
      if (content) {
        try {
          const commands: DrawCommand[] = JSON.parse(content);
          paint(commands);
        } catch {}
      }
    }).catch(() => {});

    // ── Input event forwarding to extensions ──────────────────────
    function canvasCoords(e: MouseEvent): { x: number; y: number } {
      const rect = canvasRef!.getBoundingClientRect();
      return {
        x: Math.round(e.clientX - rect.left),
        y: Math.round(e.clientY - rect.top),
      };
    }

    const handleMouseDown = (e: MouseEvent) => {
      const { x, y } = canvasCoords(e);
      extCall(props.extensionId, "on_click", JSON.stringify({ x, y, button: e.button })).catch(() => {});
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (e.buttons === 0) return;
      const { x, y } = canvasCoords(e);
      extCall(props.extensionId, "on_mouse_move", JSON.stringify({ x, y, buttons: e.buttons })).catch(() => {});
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      const payload = JSON.stringify({
        key: e.key,
        code: e.code,
        shift: e.shiftKey,
        ctrl: e.ctrlKey || e.metaKey,
        alt: e.altKey,
      });
      extCall(props.extensionId, "on_key", payload).catch(() => {});
      if (e.key === "Enter" || e.key === "Backspace" || e.key === "Tab" || e.key.length === 1) {
        e.preventDefault();
      }
    };

    canvasRef.addEventListener("mousedown", handleMouseDown);
    canvasRef.addEventListener("mousemove", handleMouseMove);
    canvasRef.addEventListener("keydown", handleKeyDown);
    canvasRef.tabIndex = 0;

    // ── Visibility detection via IntersectionObserver ─────────────
    // Detects when the surface is shown/hidden (tab switching, display:none, etc.)
    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const isVisible = entry.isIntersecting;
          if (isVisible && !wasVisible) {
            wasVisible = true;
            showAllBrowserViews().catch(() => {});
            reportSizeToExtension();
          } else if (!isVisible && wasVisible) {
            wasVisible = false;
            hideAllBrowserViews().catch(() => {});
          }
        }
      },
      { threshold: 0.01 },
    );
    visibilityObserver.observe(containerRef);

    // Watch container size changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && (Math.abs(width - currentWidth) > 1 || Math.abs(height - currentHeight) > 1)) {
          currentWidth = Math.floor(width);
          currentHeight = Math.floor(height);
          const dpr = window.devicePixelRatio || 1;
          if (canvasRef) {
            canvasRef.width = currentWidth * dpr;
            canvasRef.height = currentHeight * dpr;
            canvasRef.style.width = `${currentWidth}px`;
            canvasRef.style.height = `${currentHeight}px`;
          }
          surfaceResizeNotify(props.surfaceId, currentWidth, currentHeight).catch(() => {});
          reportSizeToExtension();
        }
      }
    });
    resizeObserver.observe(containerRef);

    // Report initial size
    reportSizeToExtension();

    onCleanup(() => {
      unlistenPromise.then((unlisten) => unlisten());
      visibilityObserver.disconnect();
      resizeObserver.disconnect();
      clearImageCache();
      if (canvasRef) {
        canvasRef.removeEventListener("mousedown", handleMouseDown);
        canvasRef.removeEventListener("mousemove", handleMouseMove);
        canvasRef.removeEventListener("keydown", handleKeyDown);
      }
    });
  });

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#1e1e2e",
      }}
    >
      <canvas ref={canvasRef} data-tab-focus-target="true" />
    </div>
  );
};

export default DisplayListSurface;
