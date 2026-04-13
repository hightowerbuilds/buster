/**
 * CanvasTabBar — canvas-rendered tab bar.
 *
 * Replaces the DOM-based TabBar with a single canvas element.
 * Supports: tab selection, close, drag-and-drop reorder, horizontal scroll,
 * keyboard navigation, and per-tab type styling.
 */

import { Component, createSignal, Show } from "solid-js";
import CanvasChrome, { CHROME_FONT, CHROME_MONO, type HitRegion, type PaintFn } from "./canvas-chrome";
import { useBuster } from "../lib/buster-context";
import type { Tab } from "../lib/tab-types";
import type { ThemePalette } from "../lib/theme";

// ── Props ──────────────────────────────────��─────────────────────────

interface CanvasTabBarProps {
  tabs: Tab[];
  activeTab: string | null;
  groupedTabIds?: Set<string>;
  onSelect: (id: string) => void;
  onActivate?: (id: string) => void;
  onClose: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onNewTerminal: () => void;
  onReorder?: (fromIdx: number, toIdx: number) => void;
}

// ── Constants ──────────────────────────���─────────────────────────────

const BAR_H = 36;
const PAD = 12;
const ICON_GAP = 6;
const CLOSE_W = 16;
const PLUS_W = 36;
const DRAG_THRESHOLD = 5;

const ICON_FONT = `11px ${CHROME_MONO}`;
const NAME_FONT = `13px ${CHROME_FONT}`;

function tabIcon(type: string): string {
  switch (type) {
    case "terminal": return ">";
    case "settings": return "~";
    case "git":      return "&";
    case "explorer": return "/";
    case "surface":  return "^";
    default:         return "#";
  }
}

// ── Component ────────────────────────────────────────────────────────

const CanvasTabBar: Component<CanvasTabBarProps> = (props) => {
  const { store } = useBuster();

  const [scrollX, setScrollX] = createSignal(0);
  const [dragFromIdx, setDragFromIdx] = createSignal<number | null>(null);
  const [dropIdx, setDropIdx] = createSignal<number | null>(null);
  const [ghostStyle, setGhostStyle] = createSignal<{ left: number; top: number; name: string } | null>(null);
  const [editingTab, setEditingTab] = createSignal<{ id: string; x: number; w: number } | null>(null);

  // Cached tab x-positions for drag drop-target detection
  let tabRects: Array<{ x: number; w: number }> = [];
  let totalTabsWidth = 0;
  let canvasWidth = 0;

  // ── Paint ──────────────────────────────────────────────────────────

  const paint: PaintFn = (ctx, w, h, hovered) => {
    const palette = store.palette;
    const tabs = props.tabs;
    const activeTab = props.activeTab;
    const grouped = props.groupedTabIds;
    const scroll = scrollX();
    const dragFrom = dragFromIdx();

    canvasWidth = w;
    const regions: HitRegion[] = [];
    tabRects = [];

    // Background
    ctx.fillStyle = palette.cssCrust;
    ctx.fillRect(0, 0, w, h);

    // Clip scrollable area (leave room for + button)
    const scrollAreaW = w - PLUS_W;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, scrollAreaW, h);
    ctx.clip();

    let x = -scroll;

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const isActive = tab.id === activeTab;
      const isGrouped = grouped?.has(tab.id) ?? false;
      const isTerminal = tab.type === "terminal";
      const tabHovered = hovered === `tab-${i}` || hovered === `close-${i}`;
      const isDrag = dragFrom === i;
      const isDrop = dropIdx() === i && dragFrom !== null && dragFrom !== i;

      // Measure tab content
      ctx.font = ICON_FONT;
      const icon = tabIcon(tab.type);
      const iconW = ctx.measureText(icon).width;

      ctx.font = NAME_FONT;
      const dirtyPrefix = tab.dirty ? "\u2022 " : "";
      const nameText = dirtyPrefix + tab.name;
      const nameW = ctx.measureText(nameText).width;

      // Always allocate close button space (like DOM opacity:0)
      const tabW = PAD + iconW + ICON_GAP + nameW + ICON_GAP + CLOSE_W + PAD;

      // Store rect for drag targeting
      tabRects.push({ x: x + scroll, w: tabW }); // in content-space (unscrolled)

      // Skip drawing if fully off-screen
      if (x + tabW < 0 || x > scrollAreaW) {
        x += tabW;
        continue;
      }

      if (isDrag) ctx.globalAlpha = 0.4;

      // Tab background
      if (isActive) {
        ctx.fillStyle = palette.editorBg;
        ctx.fillRect(x, 0, tabW, h);
      } else if (tabHovered && !isDrag) {
        ctx.fillStyle = palette.surface0;
        ctx.fillRect(x, 0, tabW, h);
      }

      // Drop target indicator (left border)
      if (isDrop) {
        ctx.fillStyle = palette.accent;
        ctx.fillRect(x, 0, 2, h);
      }

      // Grouped indicator (top border)
      if (isGrouped) {
        ctx.fillStyle = palette.accent;
        ctx.fillRect(x, 0, tabW, 2);
      }

      // Active underline
      if (isActive) {
        ctx.fillStyle = isTerminal ? terminalGreen(palette) : palette.accent;
        ctx.fillRect(x, h - 2, tabW, 2);
      }

      // Right border
      ctx.fillStyle = palette.surface0;
      ctx.fillRect(x + tabW - 1, 4, 1, h - 8);

      // Icon
      ctx.font = ICON_FONT;
      ctx.fillStyle = isTerminal ? terminalGreen(palette) : palette.textMuted;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(icon, x + PAD, h / 2);

      // Name
      ctx.font = NAME_FONT;
      ctx.fillStyle = isActive ? palette.text : (tabHovered ? palette.text : palette.textDim);
      ctx.fillText(nameText, x + PAD + iconW + ICON_GAP, h / 2);

      // Close button (only visible on hover or active)
      const showClose = isActive || tabHovered;
      const closeX = x + tabW - PAD - CLOSE_W;
      if (showClose) {
        const closeHovered = hovered === `close-${i}`;
        if (closeHovered) {
          ctx.fillStyle = palette.surface0;
          roundRect(ctx, closeX - 2, h / 2 - 8, CLOSE_W + 4, 16, 3);
          ctx.fill();
        }
        ctx.font = `12px ${CHROME_MONO}`;
        ctx.fillStyle = closeHovered ? palette.text : palette.textMuted;
        ctx.textAlign = "center";
        ctx.fillText("\u00d7", closeX + CLOSE_W / 2, h / 2);
        ctx.textAlign = "left";
      }

      if (isDrag) ctx.globalAlpha = 1;

      // Tab hit region (pushed first — lower priority in reverse hit test)
      regions.push({
        id: `tab-${i}`,
        x: Math.max(0, x), y: 0,
        w: Math.min(tabW, scrollAreaW - Math.max(0, x)),
        h,
        cursor: "pointer",
        onClick: () => (props.onActivate ?? props.onSelect)(tab.id),
        onPointerDown: (e) => startDrag(i, e),
        onDblClick: () => startInlineRename(tab),
      });

      // Close hit region (pushed after tab — wins in reverse hit test)
      regions.push({
        id: `close-${i}`,
        x: closeX - 2, y: 0, w: CLOSE_W + 4, h,
        cursor: "pointer",
        onClick: (e) => { e.stopPropagation(); props.onClose(tab.id); },
      });

      x += tabW;
    }

    totalTabsWidth = x + scroll;
    ctx.restore(); // Remove clip

    // ── "+" button ───────────���───────────────────────────────────────
    const plusX = w - PLUS_W;
    ctx.fillStyle = palette.cssCrust;
    ctx.fillRect(plusX, 0, PLUS_W, h);
    // Left edge separator
    ctx.fillStyle = palette.surface0;
    ctx.fillRect(plusX, 4, 1, h - 8);

    ctx.font = `16px ${CHROME_MONO}`;
    ctx.fillStyle = hovered === "new-terminal" ? palette.text : palette.textMuted;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText("+", plusX + PLUS_W / 2, h / 2);
    ctx.textAlign = "left";

    regions.push({
      id: "new-terminal",
      x: plusX, y: 0, w: PLUS_W, h,
      cursor: "pointer",
      onClick: () => props.onNewTerminal(),
    });

    return regions;
  };

  // ── Inline rename ──────────────────────────────────────────────────

  function startInlineRename(tab: Tab) {
    if (!props.onRename) return;
    const idx = props.tabs.findIndex(t => t.id === tab.id);
    if (idx < 0) return;
    const rect = tabRects[idx];
    if (!rect) return;
    // Position the input over the tab name area (skip icon)
    const nameX = rect.x - scrollX() + PAD + 20; // rough icon+gap offset
    const nameW = rect.w - PAD * 2 - 20 - CLOSE_W;
    setEditingTab({ id: tab.id, x: nameX, w: Math.max(60, nameW) });
  }

  function commitRename(newName: string) {
    const editing = editingTab();
    if (!editing) return;
    const trimmed = newName.trim();
    if (trimmed) {
      props.onRename?.(editing.id, trimmed);
    }
    setEditingTab(null);
  }

  function cancelRename() {
    setEditingTab(null);
  }

  // ── Scroll ─────────────────────────────────────────────────────────

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const scrollAreaW = canvasWidth - PLUS_W;
    const maxScroll = Math.max(0, totalTabsWidth - scrollAreaW);
    setScrollX((x) => Math.max(0, Math.min(maxScroll, x + (e.deltaX || e.deltaY))));
  }

  // ── Drag and drop ──────────────────────────────────────────────────

  function startDrag(idx: number, e: PointerEvent) {
    const startX = e.clientX;
    let dragging = false;

    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - startX) > DRAG_THRESHOLD) {
        dragging = true;
        setDragFromIdx(idx);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }
      if (dragging) {
        setGhostStyle({ left: ev.clientX, top: ev.clientY - 10, name: props.tabs[idx]?.name ?? "" });

        // Find drop target from cached tab rects
        const scroll = scrollX();
        for (let i = 0; i < tabRects.length; i++) {
          const r = tabRects[i];
          const screenX = r.x - scroll;
          if (ev.clientX >= screenX && ev.clientX <= screenX + r.w) {
            setDropIdx(i);
            break;
          }
        }
      }
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";

      if (dragging && dragFromIdx() !== null && dropIdx() !== null && dragFromIdx() !== dropIdx()) {
        props.onReorder?.(dragFromIdx()!, dropIdx()!);
      }

      setDragFromIdx(null);
      setDropIdx(null);
      setGhostStyle(null);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  // ── Keyboard ───────────────────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent) {
    const tabs = props.tabs;
    const count = tabs.length;
    if (count === 0) return;

    const activeIdx = tabs.findIndex((t) => t.id === props.activeTab);

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = (activeIdx + 1) % count;
      props.onSelect(tabs[next].id);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = (activeIdx - 1 + count) % count;
      props.onSelect(tabs[prev].id);
    } else if (e.key === "Home") {
      e.preventDefault();
      props.onSelect(tabs[0].id);
    } else if (e.key === "End") {
      e.preventDefault();
      props.onSelect(tabs[count - 1].id);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <>
      <CanvasChrome
        class="tab-bar"
        height={BAR_H}
        paint={paint}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <Show when={editingTab()}>
          {(editing) => {
            const tab = props.tabs.find(t => t.id === editing().id);
            return (
              <input
                ref={(el) => {
                  requestAnimationFrame(() => { el.focus(); el.select(); });
                }}
                type="text"
                value={tab?.name ?? ""}
                style={{
                  position: "absolute",
                  left: `${editing().x}px`,
                  top: "6px",
                  width: `${editing().w}px`,
                  height: `${BAR_H - 12}px`,
                  background: "var(--editor-bg, #1e1e2e)",
                  color: "var(--text, #cdd6f4)",
                  border: "1px solid var(--accent, #89b4fa)",
                  "border-radius": "2px",
                  "font-size": "13px",
                  "font-family": "'Courier New', Courier, monospace",
                  padding: "0 4px",
                  outline: "none",
                  "z-index": "10",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitRename(e.currentTarget.value); }
                  else if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                  e.stopPropagation();
                }}
                onBlur={(e) => commitRename(e.currentTarget.value)}
              />
            );
          }}
        </Show>
      </CanvasChrome>
      <Show when={ghostStyle()}>
        {(gs) => (
          <div
            class="tab-ghost"
            style={{
              left: `${gs().left}px`,
              top: `${gs().top}px`,
            }}
          >
            {gs().name}
          </div>
        )}
      </Show>
    </>
  );
};

export default CanvasTabBar;

// ── Helpers ──────────────────────────────────────────────────────────

function terminalGreen(p: ThemePalette): string {
  return p.syntax?.string || "#a6e3a1";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
