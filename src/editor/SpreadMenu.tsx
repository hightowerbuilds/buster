/**
 * Spread menu — right-click a word in a note and the text parts around it,
 * holding the word's actions in the opening. See growth/phases/text-motion.md.
 */

import { For, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { TextSelection } from "prosemirror-state";
import type { DecorationSet, EditorView } from "prosemirror-view";
import type { EditorEngine } from "./engine";
import type { FeatureCommands } from "../lib/feature-commands";
import { captureSelection, type SelectionTarget } from "../lib/selection-commands";
import { showError } from "../lib/notify";
import { wordSelectionBounds } from "./word-selection";
import { openSpread, type SpreadHandle } from "./text-motion/spread";
import "./TextMotion.css";

export interface SpreadMenuDeps {
  tabId: string;
  engine: EditorEngine;
  commands: FeatureCommands;
  view: () => EditorView | undefined;
  scroller: () => HTMLElement;
  reducedMotion: () => boolean;
  setDecorations(decorations: DecorationSet): void;
}

type Outcome = "kept" | "changed";
interface SpreadAction { label: string; pending?: string; run?: (target: SelectionTarget) => Promise<Outcome> }

const isWordChar = (value: string | undefined) => !!value && /[\p{L}\p{N}\p{M}_]/u.test(value);

/** The selection under the pointer, or the word there. Null when the pointer is not on a word. */
export function spreadRangeAt(view: EditorView, clientX: number, clientY: number): { from: number; to: number } | null {
  const { state } = view;
  const hit = view.posAtCoords({ left: clientX, top: clientY });
  if (!hit) return null;
  const selection = state.selection;
  if (!selection.empty && selection.$from.sameParent(selection.$to) && hit.pos >= selection.from && hit.pos <= selection.to) {
    return { from: selection.from, to: selection.to };
  }
  const $pos = state.doc.resolve(hit.pos);
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return null;
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, undefined, "￼");
  // A click on a word's right half resolves to the position after it.
  const offset = !isWordChar(text[$pos.parentOffset]) && isWordChar(text[$pos.parentOffset - 1]) ? $pos.parentOffset - 1 : $pos.parentOffset;
  if (!isWordChar(text[offset])) return null;
  const bounds = wordSelectionBounds(text, offset);
  return { from: $pos.start() + bounds.start, to: $pos.start() + bounds.end };
}

export function createSpreadMenu(deps: SpreadMenuDeps) {
  let handle: SpreadHandle | null = null;
  let detach: (() => void) | null = null;

  async function dispatch(command: string, args: Record<string, unknown>) {
    const result = await deps.commands.dispatch({ requestId: crypto.randomUUID(), command, args }, "user");
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }

  const actions: SpreadAction[] = [
    { label: "Copy", run: async target => { await dispatch("selection copy", { ...target }); return "kept"; } },
    { label: "Paste", run: async target => { await dispatch("selection paste", { ...target }); return "changed"; } },
    { label: "Define", pending: "Definitions open in the next step of the text-motion roadmap" },
    { label: "Bold", run: async () => {
      const inspected = await dispatch("format inspect", { tabId: deps.tabId }) as { target: unknown };
      await dispatch("format bold", { target: inspected.target });
      return "changed";
    } },
    { label: "Spelling", pending: "Spelling & grammar arrive after Define" },
  ];

  function close(options: { changed?: boolean; refocus?: boolean } = {}) {
    if (!handle || handle.closing) return;
    detach?.(); detach = null;
    handle.close({ changed: options.changed });
    if (options.refocus) deps.view()?.focus();
  }

  function open(range: { from: number; to: number }, viaKeyboard: boolean) {
    const view = deps.view();
    if (!view) return;
    if (handle) { detach?.(); detach = null; handle.dispose(); handle = null; }
    if (!view.state.selection.eq(TextSelection.create(view.state.doc, range.from, range.to))) {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)));
    }
    const target = captureSelection(deps.tabId, deps.engine);
    if (!target) return;

    let opened: SpreadHandle;
    try {
      opened = openSpread({
        view, scroller: deps.scroller(), from: range.from, to: range.to, reducedMotion: deps.reducedMotion(),
        setDecorations: deps.setDecorations,
        renderOpening: host => render(() => <SpreadOpening actions={actions} target={target} focus={viaKeyboard}
          onDone={outcome => close({ changed: outcome === "changed", refocus: true })} />, host),
        onClosed: () => { if (handle === opened) handle = null; },
      });
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
      return;
    }
    handle = opened;

    const opening = () => deps.scroller().querySelector(".text-motion-opening");
    const pointer = (event: PointerEvent) => { if (!opening()?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close({ refocus: true }); return; }
      // Typing into the note closes the opening first; the keystroke still reaches the editor.
      if (!opening()?.contains(event.target as Node) && !event.metaKey && !event.ctrlKey && event.key.length === 1) close();
    };
    const resize = () => close({ changed: true });
    window.addEventListener("pointerdown", pointer, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", resize);
    detach = () => {
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", resize);
    };
  }

  return {
    /** Context-menu entry. Returns true when the spread opened (the native menu should not). */
    openAtPointer(event: MouseEvent): boolean {
      const view = deps.view();
      const range = view ? spreadRangeAt(view, event.clientX, event.clientY) : null;
      if (!range) return false;
      open(range, false);
      return true;
    },
    /** Keyboard entry (context-menu key, Shift+F10): the current selection, or the word at the caret. */
    openAtSelection(): boolean {
      const view = deps.view();
      if (!view) return false;
      const { from, to, empty, $from } = view.state.selection;
      if (!empty && view.state.selection.$from.sameParent(view.state.selection.$to)) { open({ from, to }, true); return true; }
      const coords = view.coordsAtPos(from);
      const range = spreadRangeAt(view, coords.left + 1, (coords.top + coords.bottom) / 2) ?? (isWordChar($from.parent.textContent[$from.parentOffset - 1])
        ? spreadRangeAt(view, coords.left - 2, (coords.top + coords.bottom) / 2) : null);
      if (!range) return false;
      open(range, true);
      return true;
    },
    /** The document changed underneath an open spread (an edit, an undo, the assistant). */
    documentChanged() { close({ changed: true }); },
    close,
    /** End at once, without animating (the editor is unmounting). */
    dispose() { detach?.(); detach = null; handle?.dispose(); handle = null; },
  };
}

function SpreadOpening(props: { actions: SpreadAction[]; target: SelectionTarget; focus: boolean; onDone(outcome: Outcome): void }) {
  const [busy, setBusy] = createSignal(false);
  let menu!: HTMLDivElement;
  async function run(action: SpreadAction) {
    if (!action.run || busy()) return;
    setBusy(true);
    try { props.onDone(await action.run(props.target)); }
    catch (error) { showError(error instanceof Error ? error.message : String(error)); props.onDone("kept"); }
    finally { setBusy(false); }
  }
  queueMicrotask(() => { if (props.focus) menu?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); });
  return <div ref={menu} class="text-motion-menu" role="menu" aria-label={`Actions for “${props.target.text}”`}
    onKeyDown={event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }}>
    <For each={props.actions}>{action =>
      <button type="button" role="menuitem" disabled={busy() || !action.run} title={action.pending}
        onMouseDown={event => event.preventDefault()} onClick={() => void run(action)}>{action.label}</button>}
    </For>
  </div>;
}
