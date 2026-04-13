import { Component, createEffect, on, onMount, onCleanup } from "solid-js";
import { useBuster } from "../lib/buster-context";
import { logEntries, logRevision, clearLog, type LogEntry } from "../lib/notify";
import { measureTextWidth } from "../editor/text-measure";

const ROW_H = 22;
const PAD = 10;
const TIME_W = 70;
const LEVEL_W = 56;

const LEVEL_COLORS: Record<string, string> = {
  error: "#f38ba8",
  warn: "#f9e2af",
  info: "#89b4fa",
  success: "#a6e3a1",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

const ConsolePanel: Component<{ active: boolean }> = (props) => {
  const { store } = useBuster();
  const palette = () => store.palette;
  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let animId: number;
  let needsRedraw = true;
  let scrollTop = 0;
  let autoScroll = true;

  function scheduleRedraw() {
    needsRedraw = true;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(render);
  }

  // Re-render when new log entries arrive
  createEffect(on(logRevision, () => {
    if (props.active) scheduleRedraw();
  }));

  // Re-render when panel becomes active
  createEffect(on(() => props.active, (active) => {
    if (active) scheduleRedraw();
  }));

  function render() {
    if (!props.active || !canvasRef || !containerRef || !needsRedraw) return;
    needsRedraw = false;

    const entries = logEntries();
    const p = palette();
    const dpr = window.devicePixelRatio || 1;
    const w = containerRef.clientWidth;
    const h = containerRef.clientHeight;
    canvasRef.width = w * dpr;
    canvasRef.height = h * dpr;
    const ctx = canvasRef.getContext("2d", { alpha: false })!;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = p.editorBg;
    ctx.fillRect(0, 0, w, h);

    if (entries.length === 0) {
      ctx.font = '14px "Courier New", Courier, monospace';
      ctx.fillStyle = p.textMuted;
      ctx.textAlign = "center";
      ctx.fillText("No log entries", w / 2, h / 2);
      return;
    }

    // Auto-scroll to bottom
    const totalH = entries.length * ROW_H;
    if (autoScroll) {
      scrollTop = Math.max(0, totalH - h);
    }

    const firstRow = Math.floor(scrollTop / ROW_H);
    const visRows = Math.ceil(h / ROW_H) + 1;
    const lastRow = Math.min(firstRow + visRows, entries.length);
    const offsetY = -(scrollTop % ROW_H);

    ctx.textBaseline = "middle";
    const font = '12px "Courier New", Courier, monospace';
    ctx.font = font;

    for (let i = firstRow; i < lastRow; i++) {
      const entry = entries[i];
      const y = (i - firstRow) * ROW_H + offsetY;
      const cy = y + ROW_H / 2;

      // Alternating row background
      if (i % 2 === 0) {
        ctx.fillStyle = p.surface0;
        ctx.globalAlpha = 0.3;
        ctx.fillRect(0, y, w, ROW_H);
        ctx.globalAlpha = 1;
      }

      // Error rows get a subtle tint
      if (entry.level === "error") {
        ctx.fillStyle = LEVEL_COLORS.error;
        ctx.globalAlpha = 0.06;
        ctx.fillRect(0, y, w, ROW_H);
        ctx.globalAlpha = 1;
      }

      let x = PAD;

      // Timestamp
      ctx.fillStyle = p.textMuted;
      ctx.textAlign = "left";
      ctx.fillText(formatTime(entry.timestamp), x, cy);
      x += TIME_W;

      // Level badge
      const levelColor = LEVEL_COLORS[entry.level] || p.textDim;
      ctx.fillStyle = levelColor;
      const levelText = entry.level.toUpperCase().padEnd(7);
      ctx.fillText(levelText, x, cy);
      x += LEVEL_W;

      // Title
      ctx.fillStyle = p.text;
      const maxTitleW = w - x - PAD - (entry.detail ? 200 : 0);
      let title = entry.title;
      while (measureTextWidth(title, font) > maxTitleW && title.length > 10) {
        title = title.slice(0, -4) + "...";
      }
      ctx.fillText(title, x, cy);

      // Detail (dimmed, right-aligned)
      if (entry.detail) {
        ctx.fillStyle = p.textMuted;
        ctx.textAlign = "right";
        let detail = entry.detail;
        if (detail.length > 60) detail = detail.slice(0, 57) + "...";
        ctx.fillText(detail, w - PAD, cy);
        ctx.textAlign = "left";
      }
    }

    // Scrollbar
    if (totalH > h) {
      const barH = Math.max(20, (h / totalH) * h);
      const barY = (scrollTop / totalH) * h;
      ctx.fillStyle = p.surface2;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(w - 6, barY, 4, barH);
      ctx.globalAlpha = 1;
    }
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const entries = logEntries();
    const h = containerRef?.clientHeight || 600;
    const totalH = entries.length * ROW_H;
    const max = Math.max(0, totalH - h);
    scrollTop = Math.max(0, Math.min(scrollTop + e.deltaY, max));
    autoScroll = scrollTop >= max - ROW_H;
    scheduleRedraw();
  }

  function handleClear() {
    clearLog();
    scrollTop = 0;
    autoScroll = true;
    scheduleRedraw();
  }

  onMount(() => {
    const obs = new ResizeObserver(() => scheduleRedraw());
    if (containerRef) obs.observe(containerRef);
    onCleanup(() => {
      cancelAnimationFrame(animId);
      obs.disconnect();
    });
  });

  return (
    <div
      class="console-panel"
      style={{
        display: props.active ? "flex" : "none",
        "flex-direction": "column",
        width: "100%",
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: "4px 10px",
          "font-family": '"Courier New", Courier, monospace',
          "font-size": "12px",
          color: "var(--text-dim)",
          "border-bottom": "1px solid var(--border)",
          "flex-shrink": "0",
        }}
      >
        <span>Buster Console</span>
        <button
          onClick={handleClear}
          style={{
            background: "none",
            border: "1px solid var(--border)",
            color: "var(--text-dim)",
            "font-family": '"Courier New", Courier, monospace',
            "font-size": "11px",
            padding: "2px 8px",
            cursor: "pointer",
            "border-radius": "2px",
          }}
        >
          Clear
        </button>
      </div>
      <div
        ref={containerRef}
        style={{ flex: "1", overflow: "hidden" }}
        onWheel={handleWheel}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      </div>
    </div>
  );
};

export default ConsolePanel;
