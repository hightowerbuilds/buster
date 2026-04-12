/**
 * CanvasStatusBar — canvas-rendered status bar.
 *
 * Replaces the DOM StatusBar. Shows: "Buster" label, git branch (clickable),
 * sync button, diagnostics (clickable), LSP status, cursor position, filename.
 */

import { Component } from "solid-js";
import CanvasChrome, { CHROME_FONT, type HitRegion, type PaintFn } from "./canvas-chrome";
import type { LspState } from "../lib/store-types";

// ── Props ────────────────────────────────────────────────────────────

interface CanvasStatusBarProps {
  line: number;
  col: number;
  totalLines: number;
  fileName: string | null;
  gitBranch?: string | null;
  onBranchClick?: () => void;
  onSync?: () => void;
  syncing?: boolean;
  lspState?: LspState;
  lspLanguages?: string[];
  errorCount?: number;
  warningCount?: number;
  onDiagnosticsClick?: () => void;
}

// ── Constants ────────────────────────────────────────────────────────

const BAR_H = 24;
const FONT = `12px ${CHROME_FONT}`;
const PAD = 8;
const ITEM_GAP = 12;

const LSP_LABELS: Record<LspState, string> = {
  inactive: "",
  starting: "LSP Starting...",
  active: "LSP",
  error: "LSP Error",
};

// ── Component ────────────────────────────────────────────────────────

const CanvasStatusBar: Component<CanvasStatusBarProps> = (props) => {
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

    // "Buster" label
    ctx.fillStyle = textOnAccent;
    ctx.textAlign = "left";
    ctx.fillText("Buster", x, cy);
    x += ctx.measureText("Buster").width + ITEM_GAP;

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

    // Sync button
    if (props.onSync) {
      const syncText = props.syncing ? "Syncing..." : "Sync";
      const syncW = ctx.measureText(syncText).width;
      const syncHovered = hovered === "sync";
      const syncBtnW = syncW + 8;
      const syncBtnH = 18;
      const syncY = (h - syncBtnH) / 2;

      // Button outline
      ctx.strokeStyle = textOnAccent;
      ctx.lineWidth = 1;
      ctx.globalAlpha = props.syncing ? 0.5 : (syncHovered ? 1 : 0.7);
      ctx.beginPath();
      ctx.roundRect(x, syncY, syncBtnW, syncBtnH, 2);
      ctx.stroke();

      ctx.fillStyle = textOnAccent;
      ctx.fillText(syncText, x + 4, cy);
      ctx.globalAlpha = 1;

      if (!props.syncing) {
        regions.push({
          id: "sync",
          x, y: 0, w: syncBtnW, h,
          cursor: "pointer",
          onClick: () => props.onSync?.(),
        });
      }

      x += syncBtnW + ITEM_GAP;
    }

    // ── Right side (draw from right edge) ────────────────────────────
    ctx.textAlign = "right";
    let rx = w - PAD;

    // Filename
    const fileName = props.fileName || "untitled";
    ctx.fillStyle = textOnAccent;
    ctx.fillText(fileName, rx, cy);
    rx -= ctx.measureText(fileName).width + ITEM_GAP;

    // Total lines
    const linesText = `${props.totalLines} lines`;
    ctx.fillText(linesText, rx, cy);
    rx -= ctx.measureText(linesText).width + ITEM_GAP;

    // Cursor position
    const cursorText = `Ln ${props.line + 1}, Col ${props.col + 1}`;
    ctx.fillText(cursorText, rx, cy);
    rx -= ctx.measureText(cursorText).width + ITEM_GAP;

    // LSP status
    const lspLabel = getLspLabel(props.lspState, props.lspLanguages);
    if (lspLabel) {
      const lspColor = props.lspState === "error" ? errorColor
        : props.lspState === "starting" ? warningColor
        : textOnAccent;
      ctx.fillStyle = lspColor;
      ctx.fillText(lspLabel, rx, cy);
      rx -= ctx.measureText(lspLabel).width + ITEM_GAP;
    }

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

  return (
    <CanvasChrome
      class="status-bar"
      height={BAR_H}
      paint={paint}
    />
  );
};

export default CanvasStatusBar;

// ── Helpers ──────────────────────────────────────────────────────────

function getLspLabel(state?: LspState, languages?: string[]): string {
  const s = state ?? "inactive";
  if (s === "active" && languages?.length) {
    return `LSP: ${languages.join(", ")}`;
  }
  return LSP_LABELS[s];
}
