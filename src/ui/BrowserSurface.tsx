import { Component, onMount, onCleanup } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { paintDisplayList, clearImageCache, type DrawCommand } from "./DisplayListPainter";
import {
  surfaceResizeNotify,
  surfaceGetLastPaint,
  hideAllBrowserViews,
  showAllBrowserViews,
} from "../lib/ipc";
import {
  browserModuleOnClick,
  browserModuleOnKey,
  browserModuleOnResize,
  browserModuleOnVisibility,
  browserModuleOnMouseMove,
  browserModulePoll,
  browserModuleClose,
} from "../lib/ipc";

interface SurfaceEvent {
  surface_id: number;
  extension_id: string;
  kind: string;
  content: string;
}

interface BrowserSurfaceProps {
  surfaceId: number;
  initialWidth: number;
  initialHeight: number;
  label: string;
  isActive?: boolean;
}

const BrowserSurface: Component<BrowserSurfaceProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let currentWidth = props.initialWidth;
  let currentHeight = props.initialHeight;
  let wasVisible = false;
  let pollInterval: ReturnType<typeof setInterval> | undefined;

  function paint(commands: DrawCommand[]) {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    paintDisplayList(ctx, commands, currentWidth, currentHeight, dpr);
  }

  function reportSize() {
    if (!containerRef) return;
    const rect = containerRef.getBoundingClientRect();
    browserModuleOnResize(
      currentWidth,
      currentHeight,
      Math.round(rect.left),
      Math.round(rect.top),
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
        } catch {
          console.error("Failed to parse browser resize:", payload.content.slice(0, 200));
        }
      }
    });

    // Fetch any buffered paint from before this component mounted
    surfaceGetLastPaint(props.surfaceId)
      .then((content) => {
        if (content) {
          try {
            const commands: DrawCommand[] = JSON.parse(content);
            paint(commands);
          } catch {
            console.error("Failed to parse buffered browser display list");
          }
        }
      })
      .catch(() => {});

    // ── Input → browser module IPC ────────────────────────────────
    function canvasCoords(e: MouseEvent): { x: number; y: number } {
      const rect = canvasRef!.getBoundingClientRect();
      return {
        x: Math.round(e.clientX - rect.left),
        y: Math.round(e.clientY - rect.top),
      };
    }

    const handleMouseDown = (e: MouseEvent) => {
      const { x, y } = canvasCoords(e);
      browserModuleOnClick(x, y, e.button).catch(() => {});
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (e.buttons === 0) return;
      const { x, y } = canvasCoords(e);
      browserModuleOnMouseMove(x, y, e.buttons).catch(() => {});
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      browserModuleOnKey(
        e.key,
        e.code,
        e.shiftKey,
        e.ctrlKey || e.metaKey,
        e.altKey,
      ).catch(() => {});
      if (e.key === "Enter" || e.key === "Backspace" || e.key === "Tab" || e.key.length === 1) {
        e.preventDefault();
      }
    };

    canvasRef.addEventListener("mousedown", handleMouseDown);
    canvasRef.addEventListener("mousemove", handleMouseMove);
    canvasRef.addEventListener("keydown", handleKeyDown);
    canvasRef.tabIndex = 0;

    // Auto-focus the canvas so keyboard events work immediately
    requestAnimationFrame(() => canvasRef?.focus());

    // ── Devtools polling ──────────────────────────────────────────
    pollInterval = setInterval(() => {
      browserModulePoll().catch(() => {});
    }, 500);

    // ── Visibility detection ──────────────────────────────────────
    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const isVisible = entry.isIntersecting;
          if (isVisible && !wasVisible) {
            wasVisible = true;
            showAllBrowserViews().catch(() => {});
            browserModuleOnVisibility(true).catch(() => {});
            reportSize();
          } else if (!isVisible && wasVisible) {
            wasVisible = false;
            hideAllBrowserViews().catch(() => {});
            browserModuleOnVisibility(false).catch(() => {});
          }
        }
      },
      { threshold: 0.01 },
    );
    visibilityObserver.observe(containerRef);

    // ── Resize observation ────────────────────────────────────────
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (
          width > 0 &&
          height > 0 &&
          (Math.abs(width - currentWidth) > 1 || Math.abs(height - currentHeight) > 1)
        ) {
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
          reportSize();
        }
      }
    });
    resizeObserver.observe(containerRef);

    // Report initial size
    reportSize();

    onCleanup(() => {
      if (pollInterval) clearInterval(pollInterval);
      unlistenPromise.then((unlisten) => unlisten());
      visibilityObserver.disconnect();
      resizeObserver.disconnect();
      clearImageCache();
      browserModuleClose().catch(() => {});
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

export default BrowserSurface;
