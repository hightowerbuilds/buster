/**
 * Spread menu — right-click a word in a note and the text parts around it,
 * holding the word's actions in the opening. Define grows the opening and the
 * word's own letters fly out to spell the headword. See
 * growth/phases/text-motion.md.
 */

import { For, Match, Show, Switch, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { TextSelection } from "prosemirror-state";
import type { DecorationSet, EditorView } from "prosemirror-view";
import { layout, prepare } from "@chenglou/pretext";
import type { EditorEngine } from "./engine";
import type { FeatureCommands } from "../lib/feature-commands";
import { captureSelection, type SelectionTarget } from "../lib/selection-commands";
import { showError } from "../lib/notify";
import { wordSelectionBounds } from "./word-selection";
import { canvasMeasure } from "./text-motion/flow";
import { shapeDefinition, type ShapedDefinition } from "./text-motion/definition";
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
type Found = { kind: "found"; shaped: ShapedDefinition; source: string; headwordHeight: number | null };
type Definition = Found | { kind: "missing"; query: string };
interface SpreadAction { label: string; pending?: string; run?: (target: SelectionTarget) => Promise<Outcome>; define?: true }

const PAD = 14;
/** Columns of the action grid; keep in step with `.text-motion-menu` in TextMotion.css. */
const MENU_COLUMNS = 3;
const DEFINE_WIDTH = 460;
const HEADWORD_PX = 26;
const BODY_FONT_PX = 13;
const BODY_LINE = BODY_FONT_PX * 1.5;
const MAX_DEFINE_ROWS = 11;
const STREAM_START_MS = 380;
const STREAM_STEP_MS = 14;

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

/** Height of the definition body at `width`, laid out with Pretext in the opening's font. */
function definitionBodyHeight(shaped: ShapedDefinition, width: number): number {
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim() || "Lato, sans-serif";
  const font = `400 ${BODY_FONT_PX}px ${family}`;
  const block = (text: string, gap: number) => text ? layout(prepare(text, font), width, BODY_LINE).height + gap : 0;
  return block(shaped.pronunciation, 6) + shaped.senses.reduce((sum, sense) => sum + block(sense, 4), 0) + 24;
}

export function createSpreadMenu(deps: SpreadMenuDeps) {
  let handle: SpreadHandle | null = null;
  let detach: (() => void) | null = null;

  async function dispatch(command: string, args: Record<string, unknown>) {
    const result = await deps.commands.dispatch({ requestId: crypto.randomUUID(), command, args }, "user");
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }

  /** Bold and Italic go through the catalog against the word the spread selected. */
  async function toggleFormat(command: "format bold" | "format italic"): Promise<Outcome> {
    const inspected = await dispatch("format inspect", { tabId: deps.tabId }) as { target: unknown };
    await dispatch(command, { target: inspected.target });
    return "changed";
  }

  const dictionary = () => deps.commands.describe("selection define")[0]?.available !== false;
  const actions: SpreadAction[] = [
    { label: "Copy", run: async target => { await dispatch("selection copy", { ...target }); return "kept"; } },
    { label: "Paste", run: async target => { await dispatch("selection paste", { ...target }); return "changed"; } },
    { label: "Define", define: true, pending: dictionary() ? undefined : "Offline dictionaries are unavailable here" },
    { label: "Bold", run: () => toggleFormat("format bold") },
    { label: "Italic", run: () => toggleFormat("format italic") },
    { label: "Spelling", pending: "Spelling & grammar arrive after Define" },
  ];

  /** Look the word up, grow the opening to fit, and send the word's letters to spell the headword. */
  async function define(target: SelectionTarget, current: SpreadHandle): Promise<Definition> {
    const data = await dispatch("selection define", { ...target }) as { query: string; definition: string | null; source: string };
    if (current.closing) throw new Error("closed");
    if (!data.definition) return { kind: "missing", query: data.query };
    const shaped = shapeDefinition(data.definition, data.query);
    const width = Math.min(current.maxWidth, DEFINE_WIDTH);
    const inner = width - PAD * 2;
    const word = current.targetWord();
    let scale = Math.min(2.2, Math.max(1.25, HEADWORD_PX / (word?.fontSize ?? 16)));
    if (word) scale = Math.min(scale, inner / Math.max(1, canvasMeasure(shaped.headword, word.font)));
    const headword = word ? current.lineHeight * scale : HEADWORD_PX * 1.3;
    const needed = PAD * 2 + headword + definitionBodyHeight(shaped, inner);
    const rows = Math.max(3, Math.min(MAX_DEFINE_ROWS, Math.ceil(needed / current.lineHeight)));
    const rect = current.reshape({ width, rows });
    const flown = word ? current.flyLettersTo(shaped.headword, { x: rect.left + PAD, y: rect.top + PAD }, scale) : null;
    return { kind: "found", shaped, source: data.source, headwordHeight: flown?.height ?? null };
  }

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
          define={() => define(target, opened)}
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

function SpreadOpening(props: {
  actions: SpreadAction[]; target: SelectionTarget; focus: boolean;
  define(): Promise<Definition>; onDone(outcome: Outcome): void;
}) {
  const [busy, setBusy] = createSignal(false);
  const [definition, setDefinition] = createSignal<Definition | null>(null);
  let menu!: HTMLDivElement;
  let panel: HTMLDivElement | undefined;
  async function run(action: SpreadAction) {
    if (busy() || (!action.run && !action.define)) return;
    setBusy(true);
    try {
      if (action.define) {
        setDefinition(await props.define());
        if (props.focus) queueMicrotask(() => panel?.focus());
      } else props.onDone(await action.run!(props.target));
    } catch (error) {
      if (error instanceof Error && error.message === "closed") return;
      showError(error instanceof Error ? error.message : String(error)); props.onDone("kept");
    } finally { setBusy(false); }
  }
  queueMicrotask(() => { if (props.focus) menu?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); });

  function Found(found: Found) {
    let delay = STREAM_START_MS;
    // Each word streams in a beat after the last.
    const stream = (text: string) => text.split(/(\s+)/).map(part => {
      if (!part.trim()) return part;
      delay += STREAM_STEP_MS;
      return <span style={{ "animation-delay": `${Math.min(delay, 1400)}ms` }}>{part}</span>;
    });
    return <>
      {/* The flying letters draw the headword; keep its space, and its text for assistive technology. */}
      <Show when={found.headwordHeight !== null}
        fallback={<div class="headword" style={{ "font-size": `${HEADWORD_PX}px` }}>{found.shaped.headword}</div>}>
        <div class="headword" style={{ height: `${found.headwordHeight}px`, color: "transparent" }}>{found.shaped.headword}</div>
      </Show>
      <Show when={found.shaped.pronunciation}><p class="pronunciation text-motion-stream">{stream(found.shaped.pronunciation)}</p></Show>
      <For each={found.shaped.senses}>{sense =>
        <p class={`sense text-motion-stream${/\s/.test(sense) ? "" : " label"}`}>{stream(sense)}</p>}
      </For>
      <p class="source">{found.source}</p>
    </>;
  }

  return <Show when={definition()} fallback={
    <div ref={menu} class="text-motion-menu" role="menu" aria-label={`Actions for “${props.target.text}”`}
      onKeyDown={event => {
        // Left/Right walk the ready actions in order; Up/Down move between the grid's two rows.
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const all = Array.from(menu.querySelectorAll<HTMLButtonElement>("button"));
          const below = all[all.indexOf(document.activeElement as HTMLButtonElement) + (event.key === "ArrowDown" ? MENU_COLUMNS : -MENU_COLUMNS)];
          if (below && !below.disabled) below.focus();
          return;
        }
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
      }}>
      <For each={props.actions}>{action =>
        <button type="button" role="menuitem" disabled={busy() || (!action.run && !action.define) || !!action.pending} title={action.pending}
          onMouseDown={event => event.preventDefault()} onClick={() => void run(action)}>{action.label}</button>}
      </For>
    </div>}>
    {current => <div ref={panel} class="text-motion-definition" tabIndex={-1} role="region"
      aria-label={`Definition of ${props.target.text}`} style={{ "--text-motion-pad": `${PAD}px` }}>
      <Switch>
        <Match when={current().kind === "missing"}>
          <p class="empty">No definition for “{props.target.text.trim()}” in your active dictionaries. Enable one in the macOS Dictionary app.</p>
        </Match>
        <Match when={current().kind === "found"}>{Found(current() as Found)}</Match>
      </Switch>
    </div>}
  </Show>;
}
