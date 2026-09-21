import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { EditorEngine } from "./engine";
import { useBuster } from "../lib/buster-context";
import { captureSelection, type SelectionTarget } from "../lib/selection-commands";
import { selectionMenuPosition } from "./selection-menu-geometry";
import { showError, showInfo } from "../lib/notify";

interface Props {
  tabId: string; engine: EditorEngine; active: boolean; dragging: boolean; composing: boolean;
  width: number; height: number; scrollTop: number; lineHeight: number; charWidth: number; gutter: number; wordWrap: boolean;
  focusEditor: () => void;
}
export default function SelectionActions(props: Props) {
  const { store, commands } = useBuster();
  const [target, setTarget] = createSignal<SelectionTarget | null>(null);
  const [dismissed, setDismissed] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let toolbar: HTMLDivElement | undefined;
  const pane = () => store.paneWorkspace.panes.find(p => p.tabId === props.tabId);
  const snapshot = () => pane() ? captureSelection(pane()!.id, props.tabId, props.engine) : null;
  const key = (value: SelectionTarget | null) => value ? JSON.stringify(value) : "";
  const position = () => {
    const selected = target();
    props.engine.foldSeq();
    return selected ? selectionMenuPosition(selected.range,
      props.engine.computeDisplayRows(props.charWidth, props.width, props.wordWrap, props.gutter),
      props.scrollTop, props.width, props.height, props.lineHeight, props.charWidth, props.gutter, 220, 82) : null;
  };
  createEffect(() => {
    const current = snapshot();
    const allowed = props.active && !props.dragging && !props.composing && !props.engine.hasMultiCursors();
    if (dismissed() && key(current) !== dismissed()) setDismissed("");
    setTarget(null);
    if (!allowed || !current || key(current) === dismissed()) return;
    const timer = setTimeout(() => setTarget(current), 180);
    onCleanup(() => clearTimeout(timer));
  });
  function dismiss(returnFocus = false) {
    setDismissed(key(snapshot())); setTarget(null);
    if (returnFocus && props.active) props.focusEditor();
  }
  onMount(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!props.active || props.composing) return;
      const input = event.target as HTMLElement;
      if (input.closest<HTMLElement>("[data-tab-panel-id]")?.dataset.tabPanelId !== props.tabId) return;
      if (event.key === "Escape" && target()) {
        event.preventDefault(); event.stopImmediatePropagation(); dismiss(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "Space") {
        const current = snapshot();
        if (!current) return;
        event.preventDefault(); event.stopImmediatePropagation();
        setDismissed(""); setTarget(current);
        requestAnimationFrame(() => toolbar?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
      }
    };
    window.addEventListener("keydown", keydown, true);
    onCleanup(() => window.removeEventListener("keydown", keydown, true));
  });
  async function run(action: "copy" | "paste" | "lookup" | "ai" | "voice") {
    const captured = target();
    if (!captured || busy()) return;
    setBusy(true);
    try {
      const result = await commands.dispatch({ requestId: crypto.randomUUID(), command: `selection ${action}`, args: { ...captured } }, "user");
      if (!result.ok) showError(result.error.message);
      else if (action === "copy") showInfo("Selection copied");
      if (result.ok && action === "voice") {
        dismiss();
        requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-speech-focus]:not(:disabled)")?.focus());
      }
      if ((action === "copy" || action === "paste") && props.active && pane()?.id === captured.paneId) props.focusEditor();
    } finally { setBusy(false); }
  }
  return <Show when={target() && position()}>{_position => <div ref={toolbar} class="selection-actions" role="toolbar"
    aria-label="Selected text actions" style={{ left: `${position()!.x}px`, top: `${position()!.y}px` }}
    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }} onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
    onKeyDown={event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault(); event.stopPropagation();
      const buttons = Array.from(toolbar!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }}>
    <div><button disabled={busy()} onClick={() => void run("copy")}>Copy</button><button disabled={busy()} onClick={() => void run("paste")}>Paste</button>
      <button aria-label="Dismiss selection actions" title="Escape — keep selection" onClick={() => dismiss(true)}>×</button></div>
    <div><button disabled={busy()} title="Choose a macOS voice and read this selection aloud" onClick={() => void run("voice")}>Voice</button><button disabled={busy()} title="Look up in local macOS dictionaries" onClick={() => void run("lookup")}>Look up</button><button disabled={busy()} title="Review AI suggestions beside this selection" onClick={() => void run("ai")}>AI</button>
      <span title="⌘⇧Space: focus or reopen actions" aria-label="Command Shift Space opens selection actions">⌘⇧Space</span></div>
  </div>}</Show>;
}
