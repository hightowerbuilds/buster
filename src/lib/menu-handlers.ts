/**
 * Native menu event handlers (Cmd+Z, Cmd+C, Cmd+V, etc.)
 * Extracted from App.tsx to keep the main component lean.
 */

import { listen } from "@tauri-apps/api/event";
import { clipboardWrite, clipboardRead } from "./clipboard";
import type { EditorEngine } from "../editor/engine";

/** Brief shake animation to confirm clipboard copy. */
export function quakeElement(el: HTMLElement | null) {
  const target = el ?? document.querySelector(".canvas-editor") as HTMLElement | null;
  if (!target) return;
  target.classList.add("copy-quake");
  target.addEventListener("animationend", () => target.classList.remove("copy-quake"), { once: true });
}

interface MenuHandlerDeps {
  activeEngine: () => EditorEngine | null;
  changeDirectory: () => void;
  closeDirectory: () => void;
  openExtensions: () => void;
  openDebug: () => void;
  openSettings: () => void;
  closeTabOrWindow: () => void;
}

/**
 * Registers all native menu event listeners.
 * Returns an array of unlisten handles for cleanup.
 */
export function setupMenuHandlers(deps: MenuHandlerDeps): Promise<Array<() => void>> {
  const handles: Array<Promise<() => void>> = [];

  handles.push(
    listen("menu-change-directory", () => deps.changeDirectory()) as unknown as Promise<() => void>,
    listen("menu-close-directory", () => deps.closeDirectory()) as unknown as Promise<() => void>,
    listen("menu-open-extensions", () => deps.openExtensions()) as unknown as Promise<() => void>,
    listen("menu-open-debug", () => deps.openDebug()) as unknown as Promise<() => void>,
    listen("menu-open-settings", () => deps.openSettings()) as unknown as Promise<() => void>,
    listen("menu-close-tab", () => deps.closeTabOrWindow()) as unknown as Promise<() => void>,
  );

  // Undo / Redo
  handles.push(
    listen("menu-undo", () => { deps.activeEngine()?.undo(); }) as unknown as Promise<() => void>,
    listen("menu-redo", () => { deps.activeEngine()?.redo(); }) as unknown as Promise<() => void>,
  );

  // Cut
  handles.push(
    listen("menu-cut", () => {
      const engine = deps.activeEngine();
      if (engine) {
        const sel = engine.getOrderedSelection();
        if (sel) {
          clipboardWrite(engine.getTextRange(sel.from, sel.to)).then(ok => { if (ok) quakeElement(null); });
          engine.deleteRange(sel.from, sel.to);
        }
        return;
      }
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        if (start !== end) {
          const text = el.value.slice(start, end);
          clipboardWrite(text).then(ok => { if (ok) quakeElement(el); });
          el.value = el.value.slice(0, start) + el.value.slice(end);
          el.selectionStart = el.selectionEnd = start;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
      const domSel = window.getSelection();
      const text = domSel?.toString() ?? "";
      if (text) {
        const anchor = domSel?.anchorNode?.parentElement ?? null;
        clipboardWrite(text).then(ok => { if (ok) quakeElement(anchor); });
      }
    }) as unknown as Promise<() => void>,
  );

  // Copy
  handles.push(
    listen("menu-copy", () => {
      const engine = deps.activeEngine();
      if (engine) {
        const sel = engine.getOrderedSelection();
        if (sel) {
          clipboardWrite(engine.getTextRange(sel.from, sel.to)).then(ok => { if (ok) quakeElement(null); });
        }
        return;
      }
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        if (start !== end) {
          const text = el.value.slice(start, end);
          clipboardWrite(text).then(ok => { if (ok) quakeElement(el); });
          return;
        }
      }
      const domSel = window.getSelection();
      const text = domSel?.toString() ?? "";
      if (text) {
        const anchor = domSel?.anchorNode?.parentElement ?? null;
        clipboardWrite(text).then(ok => { if (ok) quakeElement(anchor); });
      }
    }) as unknown as Promise<() => void>,
  );

  // Paste
  handles.push(
    listen("menu-paste", () => {
      const engine = deps.activeEngine();
      if (engine) {
        clipboardRead().then(text => { if (text) engine.insert(text); });
        return;
      }
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        clipboardRead().then(text => {
          if (!text) return;
          const start = el.selectionStart ?? 0;
          const end = el.selectionEnd ?? 0;
          const val = el.value;
          el.value = val.slice(0, start) + text + val.slice(end);
          el.selectionStart = el.selectionEnd = start + text.length;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
    }) as unknown as Promise<() => void>,
  );

  // Select All
  handles.push(
    listen("menu-select-all", () => { deps.activeEngine()?.selectAll(); }) as unknown as Promise<() => void>,
  );

  return Promise.all(handles);
}
