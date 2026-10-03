/**
 * CanvasBrowserPanel — HTML chrome toolbar + native Tauri webview.
 *
 * Top 32px: HTML nav buttons (back, forward, refresh) + URL bar.
 * Below: native Tauri child webview positioned via absolute window coordinates.
 */

import { Component, createSignal, onMount, onCleanup, Show } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { CHROME_FONT } from "./canvas-chrome";
import { showToast } from "./CanvasToasts";
import { useBuster } from "../lib/buster-context";
import {
  createBrowserView,
  navigateBrowserView,
  resizeBrowserView,
  showBrowserView,
  hideBrowserView,
  closeBrowserView,
  browserGoBack,
  browserGoForward,
  browserReload,
} from "../lib/ipc";

const CHROME_H = 32;

interface CanvasBrowserPanelProps {
  tabId: string;
  active: boolean;
  initialUrl?: string;
}

const CanvasBrowserPanel: Component<CanvasBrowserPanelProps> = (props) => {
  const { store } = useBuster();
  const palette = () => store.palette;

  let containerRef!: HTMLDivElement;
  let webviewAreaRef!: HTMLDivElement;
  let browserId: string | null = null;

  const [currentUrl, setCurrentUrl] = createSignal(props.initialUrl || "");
  const [editing, setEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal("");

  // ── URL helpers ────────────────────────────────────────────────────

  function normalizeUrl(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return "about:blank";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^localhost/i.test(trimmed) || /^127\.0\.0\.1/i.test(trimmed)) return `http://${trimmed}`;
    if (trimmed.includes(".") && !trimmed.includes(" ")) return `https://${trimmed}`;
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  }

  async function navigateToUrl(input: string) {
    const url = normalizeUrl(input);
    setCurrentUrl(url);
    if (browserId) {
      try {
        await navigateBrowserView(browserId, url);
      } catch (e) {
        showToast(`Navigate failed: ${e}`, "error");
      }
    } else {
      // Webview doesn't exist yet — create it now with this URL
      await createWebviewNow(url);
    }
  }

  async function createWebviewNow(url: string) {
    if (browserId || !webviewAreaRef) return;
    const r = getWebviewRect();
    if (r.w <= 0 || r.h <= 0) return;
    try {
      browserId = await createBrowserView(url, r.x, r.y, r.w, r.h);
    } catch (e) {
      showToast(`Browser failed: ${e}`, "error");
    }
  }

  function startEditing() {
    setEditValue(currentUrl());
    setEditing(true);
  }

  // ── Webview positioning ────────────────────────────────────────────

  /** Tauri v2 child webview coordinates are relative to the window frame,
   *  but getBoundingClientRect() is relative to the viewport below the title bar.
   *  Add the title bar height so the webview doesn't overlap the toolbar. */
  const TITLE_BAR_H = 28; // macOS standard title bar

  function getWebviewRect() {
    const rect = webviewAreaRef.getBoundingClientRect();
    return { x: rect.left, y: rect.top + TITLE_BAR_H, w: rect.width, h: rect.height };
  }

  function updateWebviewPosition() {
    if (!browserId || !webviewAreaRef) return;
    const r = getWebviewRect();
    if (r.w <= 0 || r.h <= 0) return;
    resizeBrowserView(browserId, r.x, r.y, r.w, r.h).catch((e) =>
      console.warn("Browser resize failed:", e),
    );
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  // Component-level cleanup — always runs on dispose, even if onMount hasn't finished
  onCleanup(() => {
    if (browserId) {
      hideBrowserView(browserId).catch(() => {});
      closeBrowserView(browserId).catch(() => {});
      browserId = null;
    }
  });

  onMount(async () => {
    let webviewVisible = false;

    // ResizeObserver drives create / show / hide / reposition.
    // When the tab is hidden (display:none) → size goes to 0 → hide.
    // When the tab is shown → size returns → show or create.
    const ro = new ResizeObserver((entries) => {
      const rw = entries[0]?.contentRect.width ?? 0;
      const rh = entries[0]?.contentRect.height ?? 0;

      if (rw <= 0 || rh <= 0) {
        if (browserId && webviewVisible) {
          hideBrowserView(browserId).catch(() => {});
          webviewVisible = false;
        }
        return;
      }

      if (!browserId) {
        // Wait for user to type a URL — don't auto-create
      } else if (!webviewVisible) {
        showBrowserView(browserId).catch(() => {});
        webviewVisible = true;
        updateWebviewPosition();
      } else {
        updateWebviewPosition();
      }
    });
    ro.observe(containerRef);

    const unlistenMove = await listen("tauri://move", () => updateWebviewPosition());

    onCleanup(() => {
      ro.disconnect();
      unlistenMove();
      if (browserId) {
        hideBrowserView(browserId).catch(() => {});
        closeBrowserView(browserId).catch(() => {});
      }
    });

  });

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div
      ref={(el) => { containerRef = el; }}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        "flex-direction": "column",
        background: palette().editorBg,
      }}
    >
      {/* ── Toolbar ───────────────────────────────────────────── */}
      <div style={{
        height: `${CHROME_H}px`,
        "flex-shrink": "0",
        display: "flex",
        "align-items": "center",
        gap: "4px",
        padding: "0 8px",
        background: palette().surface0,
        "border-bottom": `1px solid ${palette().border}`,
        "font-family": CHROME_FONT,
        "font-size": "13px",
        color: palette().text,
      }}>
        <button onClick={() => browserId && browserGoBack(browserId).catch(() => {})}
          style={{ background: "none", border: "none", color: palette().textDim, cursor: "pointer", "font-size": "16px", padding: "2px 6px" }}>{"\u2190"}</button>
        <button onClick={() => browserId && browserGoForward(browserId).catch(() => {})}
          style={{ background: "none", border: "none", color: palette().textDim, cursor: "pointer", "font-size": "16px", padding: "2px 6px" }}>{"\u2192"}</button>
        <button onClick={() => browserId && browserReload(browserId).catch(() => {})}
          style={{ background: "none", border: "none", color: palette().textDim, cursor: "pointer", "font-size": "16px", padding: "2px 6px" }}>{"\u21BB"}</button>

        <Show when={!editing()} fallback={
          <input
            ref={(el) => requestAnimationFrame(() => { el.focus(); el.select(); })}
            type="text"
            value={editValue()}
            onInput={(e) => setEditValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); navigateToUrl(editValue()); setEditing(false); }
              else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
              e.stopPropagation();
            }}
            onBlur={() => setEditing(false)}
            style={{
              flex: "1", height: "22px", background: palette().surface1, color: palette().text,
              border: `1px solid ${palette().accent}`, "border-radius": "4px", "font-size": "12px",
              "font-family": CHROME_FONT, padding: "0 6px", outline: "none", "box-sizing": "border-box",
            }}
          />
        }>
          <div onClick={() => startEditing()} style={{
            flex: "1", height: "22px", background: palette().surface1, "border-radius": "4px",
            padding: "0 6px", display: "flex", "align-items": "center", cursor: "text",
            color: palette().textDim, "font-size": "12px", overflow: "hidden",
          }}>
            {currentUrl() || "Enter URL or search..."}
          </div>
        </Show>
      </div>

      {/* ── Webview area (measured for native overlay positioning) ── */}
      <div ref={(el) => { webviewAreaRef = el; }} style={{ flex: "1", "min-height": "0" }} />
    </div>
  );
};

export default CanvasBrowserPanel;
