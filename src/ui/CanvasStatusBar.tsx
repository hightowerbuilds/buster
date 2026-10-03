/**
 * CanvasStatusBar — canvas-rendered status bar.
 *
 * Replaces the DOM StatusBar. Shows: "BusterMark" label, git branch (clickable),
 * sync button, diagnostics (clickable), cursor position, word count, filename.
 */

import { Component, createSignal, createEffect, onCleanup } from "solid-js";
import CanvasChrome, { CHROME_FONT, type HitRegion, type PaintFn } from "./canvas-chrome";

// ── Props ────────────────────────────────────────────────────────────

interface CanvasStatusBarProps {
  line: number;
  col: number;
  totalLines: number;
  fileName: string | null;
  gitBranch?: string | null;
  onBranchClick?: () => void;
  errorCount?: number;
  warningCount?: number;
  onDiagnosticsClick?: () => void;
  fileLoading?: boolean;
  lineEnding?: string | null;
  /** Already formatted, e.g. "340 words" or "12 of 340 words". */
  wordCount?: string | null;
}

// ── Constants ────────────────────────────────────────────────────────

const BAR_H = 24;
const FONT = `12px ${CHROME_FONT}`;
const PAD = 8;
const ITEM_GAP = 12;

// ── Component ────────────────────────────────────────────────────────

const CanvasStatusBar: Component<CanvasStatusBarProps> = (props) => {
  // Animated dots for loading states (ticks every 400ms while loading)
  const [dotPhase, setDotPhase] = createSignal(0);
  let dotTimer: ReturnType<typeof setInterval> | undefined;

  createEffect(() => {
    const needsAnim = props.fileLoading;
    if (needsAnim && !dotTimer) {
      dotTimer = setInterval(() => setDotPhase(p => (p + 1) % 4), 400);
    } else if (!needsAnim && dotTimer) {
      clearInterval(dotTimer);
      dotTimer = undefined;
      setDotPhase(0);
    }
  });
  onCleanup(() => { if (dotTimer) clearInterval(dotTimer); });

  const dots = () => ".".repeat(dotPhase() || 0);

  const paint: PaintFn = (ctx, w, h, hovered) => {
    // We don't use useBuster here — palette comes via CSS variable mapping
    // Actually, we need the accent color for the background. Let's read from DOM.
    // Status bar bg is the accent color. We can get it from the CSS variable.
    // But for canvas, we need the actual value. Let's use getComputedStyle.
    const root = document.documentElement;
    const accent = getComputedStyle(root).getPropertyValue("--accent").trim() || "#89b4fa";
    const textOnAccent = getComputedStyle(root).getPropertyValue("--bg-crust").trim() || "#11111b";
    const errorColor = getComputedStyle(root).getPropertyValue("--red").trim() || "#f38ba8";
    const warningColor = getComputedStyle(root).getPropertyValue("--yellow").trim() || "#f9e2af";

    const regions: HitRegion[] = [];

    // Background
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, h);

    ctx.font = FONT;
    ctx.textBaseline = "middle";
    const cy = h / 2;

    // ── Left side ────────────────────────────────────────────────────
    let x = PAD;

    // "BusterMark" label
    ctx.fillStyle = textOnAccent;
    ctx.textAlign = "left";
    ctx.fillText("BusterMark", x, cy);
    x += ctx.measureText("BusterMark").width + ITEM_GAP;


    // Git branch
    if (props.gitBranch) {
      const branchText = props.gitBranch;
      const branchW = ctx.measureText(branchText).width;
      const branchHovered = hovered === "branch";

      if (branchHovered) {
        ctx.fillStyle = textOnAccent;
        ctx.globalAlpha = 0.15;
        ctx.fillRect(x - 3, 2, branchW + 6, h - 4);
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = textOnAccent;
      ctx.fillText(branchText, x, cy);

      if (props.onBranchClick) {
        regions.push({
          id: "branch",
          x: x - 3, y: 0, w: branchW + 6, h,
          cursor: "pointer",
          onClick: () => props.onBranchClick?.(),
        });
      }

      x += branchW + ITEM_GAP;
    }

    // File loading indicator
    if (props.fileLoading) {
      const loadText = `Loading${dots()}`;
      ctx.fillStyle = textOnAccent;
      ctx.globalAlpha = 0.7;
      ctx.fillText(loadText, x, cy);
      ctx.globalAlpha = 1;
      x += ctx.measureText(loadText).width + ITEM_GAP;
    }

    // ── Right side (draw from right edge) ────────────────────────────
    ctx.textAlign = "right";
    let rx = w - PAD;

    // Filename
    const fileName = props.fileName || "untitled";
    ctx.fillStyle = textOnAccent;
    ctx.fillText(fileName, rx, cy);
    rx -= ctx.measureText(fileName).width + ITEM_GAP;

    // Line ending
    if (props.lineEnding) {
      ctx.fillStyle = textOnAccent;
      ctx.fillText(props.lineEnding, rx, cy);
      rx -= ctx.measureText(props.lineEnding).width + ITEM_GAP;
    }

    // Total lines
    const linesText = `${props.totalLines} lines`;
    ctx.fillText(linesText, rx, cy);
    rx -= ctx.measureText(linesText).width + ITEM_GAP;

    // Word count
    if (props.wordCount) {
      ctx.fillText(props.wordCount, rx, cy);
      rx -= ctx.measureText(props.wordCount).width + ITEM_GAP;
    }

    // Cursor position
    const cursorText = `Ln ${props.line + 1}, Col ${props.col + 1}`;
    ctx.fillText(cursorText, rx, cy);
    rx -= ctx.measureText(cursorText).width + ITEM_GAP;

    // Diagnostics
    const errors = props.errorCount ?? 0;
    const warnings = props.warningCount ?? 0;
    if (errors > 0 || warnings > 0) {
      let diagText = "";
      if (errors > 0) diagText += `${errors} error${errors === 1 ? "" : "s"}`;
      if (errors > 0 && warnings > 0) diagText += "  ";
      if (warnings > 0) diagText += `${warnings} warning${warnings === 1 ? "" : "s"}`;

      const diagW = ctx.measureText(diagText).width;
      const diagHovered = hovered === "diagnostics";

      if (diagHovered) {
        ctx.fillStyle = textOnAccent;
        ctx.globalAlpha = 0.15;
        ctx.fillRect(rx - diagW - 3, 2, diagW + 6, h - 4);
        ctx.globalAlpha = 1;
      }

      // Draw error count in red, warning count in yellow
      let dx = rx;
      if (warnings > 0) {
        const wText = `${warnings} warning${warnings === 1 ? "" : "s"}`;
        ctx.fillStyle = warningColor;
        ctx.fillText(wText, dx, cy);
        dx -= ctx.measureText(wText).width;
        if (errors > 0) dx -= ctx.measureText("  ").width;
      }
      if (errors > 0) {
        const eText = `${errors} error${errors === 1 ? "" : "s"}`;
        ctx.fillStyle = errorColor;
        ctx.fillText(eText, dx, cy);
      }

      if (props.onDiagnosticsClick) {
        regions.push({
          id: "diagnostics",
          x: rx - diagW - 3, y: 0, w: diagW + 6, h,
          cursor: "pointer",
          onClick: () => props.onDiagnosticsClick?.(),
        });
      }
    }

    ctx.textAlign = "left";
    return regions;
  };

  // Canvas text is invisible to assistive technology, so the label carries the document details.
  const label = () => ["Status bar", props.fileName && `Ln ${props.line + 1}, Col ${props.col + 1}`, props.wordCount,
    props.fileName && `${props.totalLines} lines`, props.fileName].filter(Boolean).join(", ");

  return (
    <CanvasChrome
      class="status-bar"
      height={BAR_H}
      paint={paint}
      role="status"
      aria-label={label()}
    />
  );
};

export default CanvasStatusBar;
