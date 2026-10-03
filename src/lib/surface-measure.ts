import { listen } from "@tauri-apps/api/event";
import { surfaceMeasureTextResponse } from "./ipc";
import { measureTextWidth } from "../editor/text-measure";

interface TextMeasureRequest {
  request_id: number;
  text: string;
  font: string;
}

// Shared canvas for vertical font metrics (ascent/descent).
// Pretext handles horizontal width; canvas is only needed here for vertical data.
let metricsCanvas: HTMLCanvasElement | null = null;
function getMetricsCtx(): CanvasRenderingContext2D {
  if (!metricsCanvas) {
    metricsCanvas = document.createElement("canvas");
    metricsCanvas.width = 1;
    metricsCanvas.height = 1;
  }
  return metricsCanvas.getContext("2d")!;
}

/**
 * Set up a listener that handles text measurement requests from the Rust backend.
 * When a WASM extension calls host_measure_text, the backend emits a
 * "surface-measure-text" event. Width is measured via Pretext (cached,
 * no DOM reflow). Vertical metrics (ascent/descent) use a shared canvas
 * since Pretext focuses on horizontal layout.
 */
export function setupSurfaceMeasureListener(): Promise<() => void> {
  return listen<TextMeasureRequest>("surface-measure-text", (event) => {
    const { request_id, text, font } = event.payload;

    // Horizontal width via Pretext
    const width = measureTextWidth(text, font);

    // Vertical metrics via shared canvas
    const ctx = getMetricsCtx();
    ctx.font = font;
    const metrics = ctx.measureText(text);
    const ascent = metrics.actualBoundingBoxAscent;
    const descent = metrics.actualBoundingBoxDescent;
    const height = ascent + descent;

    surfaceMeasureTextResponse(request_id, width, height, ascent, descent).catch((err) => {
      console.error("Failed to send text measurement response:", err);
    });
  });
}
