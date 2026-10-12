/**
 * Spread menu — right-click a word or a selected phrase in a note and the text
 * parts around it, holding its actions in the opening. Some actions grow the
 * opening into a panel: Define (the word's own letters fly out to spell the
 * headword) and Spelling, and for phrases Search, Count, and Rephrase. See
 * growth/phases/text-motion.md.
 */

import { For, Match, Show, Switch, createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { TextSelection } from "prosemirror-state";
import type { DecorationSet, EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { layout, prepare } from "@chenglou/pretext";
import type { EditorEngine, Selection } from "./engine";
import type { FeatureCommands } from "../lib/feature-commands";
import { captureSelection, type SelectionTarget } from "../lib/selection-commands";
import { showError, showSuccess } from "../lib/notify";
import { wordSelectionBounds } from "./word-selection";
import { AI_LADDERS, providerName, type AiProvider, type AiRung } from "../lib/ai-oneshot";
import { canvasMeasure } from "./text-motion/flow";
import { definitionNote, shapeDefinition, type ShapedDefinition } from "./text-motion/definition";
import { formatDuration, passageStats, wordUses, type PassageStats, type WordUse } from "./text-motion/stats";
import { openSpread, type MotionIntensity, type SpreadHandle } from "./text-motion/spread";
import "./TextMotion.css";

export interface SpreadMenuDeps {
  tabId: string;
  engine: EditorEngine;
  commands: FeatureCommands;
  view: () => EditorView | undefined;
  scroller: () => HTMLElement;
  /** Off when the OS or the note's appearance asks for reduced motion; otherwise Settings › Spread Motion. */
  motion: () => MotionIntensity;
  setDecorations(decorations: DecorationSet, render?: boolean): void;
  /** The writer's AI provider (Settings › AI), used by Rephrase and Spelling. */
  aiProvider(): AiProvider;
}

type Outcome = "kept" | "changed";
type Found = { kind: "found"; shaped: ShapedDefinition; source: string; headwordHeight: number | null };
type Definition = Found | { kind: "missing"; query: string };
interface SearchNote { path: string; tabId: string | null; matches: Array<{ line: number; text: string }>; totalMatches: number }
interface SearchResult { query: string; notes: SearchNote[]; truncated: boolean }
type Panel =
  | { kind: "definition"; definition: Definition }
  | { kind: "count"; stats: PassageStats; uses: WordUse[] }
  | { kind: "search"; result: SearchResult }
  | { kind: "rephrase" }
  | { kind: "spelling" };
interface SpreadAction { label: string; pending?: string; run?: (target: SelectionTarget) => Promise<Outcome>; panel?: () => Promise<Panel> }

/** The callbacks a panel uses to talk back to the spread. */
interface PanelHost {
  target: SelectionTarget;
  thisTab: string;
  done(outcome: Outcome): void;
  openMatch(note: SearchNote, query: string): void;
  /** Keep a definition as a new note in the Notes folder; resolves to its path. */
  keep(name: string, text: string): Promise<string>;
  ai: AiHost;
}
type AiKind = "rephrase" | "spelling";
interface AiHost {
  provider: AiProvider;
  ladder: AiRung[];
  /** Ask once per session, per provider, before the first text leaves the Mac. */
  needsConsent(): boolean;
  /** Ask at `rung` of the provider's ladder; rejects with `code` UNUSABLE when the reply had nothing usable. */
  request(kind: AiKind, rung: number): Promise<Record<string, unknown>>;
  /** Replace the spread's word or phrase. */
  apply(text: string): Promise<void>;
  /** Replace `range`, valid in note revision `revision`, as one undoable edit. */
  applyAt(revision: number, range: Selection, text: string): Promise<void>;
  /** Grow the opening to fit `height` px of panel content. */
  fit(height: number): void;
}
interface GrammarIssue { excerpt: string; replacement: string; explanation: string; range: Selection }
interface SpellingCheck { word: string; revision: number; misspelled: boolean; suggestions: string[]; grammar: GrammarIssue[] }

const PAD = 14;
/** Columns of the action grid; keep in step with `.text-motion-menu` in TextMotion.css. */
const MENU_COLUMNS = 3;
const DEFINE_WIDTH = 460;
const HEADWORD_PX = 26;
const BODY_FONT_PX = 13;
const BODY_LINE = BODY_FONT_PX * 1.5;
const MAX_DEFINE_ROWS = 11;
const PANEL_WIDTH = 460;
const MAX_PANEL_ROWS = 12;
const COUNT_HEIGHT = 112;
const AI_POLL_MS = 250;
/** Providers the writer has agreed to send text to this session (Rephrase, Spelling). */
const consented = new Set<AiProvider>();
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

/** Height of `text` in the panel's body font at `width`, laid out with Pretext; 0 for no text. */
function textHeight(text: string, width: number): number {
  if (!text) return 0;
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim() || "Lato, sans-serif";
  return layout(prepare(text, `400 ${BODY_FONT_PX}px ${family}`), width, BODY_LINE).height;
}

/** Height of the definition body at `width`. */
function definitionBodyHeight(shaped: ShapedDefinition, width: number): number {
  const block = (text: string, gap: number) => text ? textHeight(text, width) + gap : 0;
  return block(shaped.pronunciation, 6) + shaped.senses.reduce((sum, sense) => sum + block(sense, 4), 0) + 34;
}

/** Height of the search results at `width`: a summary line, then each note's name and first matches. */
function searchHeight(result: SearchResult, width: number): number {
  if (!result.notes.length) return BODY_LINE * 2;
  return BODY_LINE + 6 + result.notes.reduce((sum, note) =>
    sum + BODY_LINE + note.matches.slice(0, 2).reduce((h, match) => h + textHeight(match.text.trim(), width - 12) + 2, 0) + 14, 0);
}

const isPhrase = (text: string) => /\s/.test(text.trim());

export function createSpreadMenu(deps: SpreadMenuDeps) {
  let handle: SpreadHandle | null = null;
  let detach: (() => void) | null = null;
  /** Stops work an open panel started (a running rephrase). */
  let stopPanel: (() => void) | null = null;

  async function dispatch(command: string, args: Record<string, unknown>) {
    const result = await deps.commands.dispatch({ requestId: crypto.randomUUID(), command, args }, "user");
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.data;
  }

  /** Bold and Italic go through the catalog against the word the spread selected. */
  async function toggleFormat(command: "format bold" | "format italic"): Promise<Outcome> {
    const inspected = await dispatch("format inspect", { tabId: deps.tabId }) as { target: unknown };
    await dispatch(command, { target: inspected.target });
    return "changed";
  }

  const dictionary = () => deps.commands.describe("selection define")[0]?.available !== false;
  const copy: SpreadAction = { label: "Copy", run: async target => { await dispatch("selection copy", { ...target }); return "kept"; } };
  const bold: SpreadAction = { label: "Bold", run: () => toggleFormat("format bold") };
  const italic: SpreadAction = { label: "Italic", run: () => toggleFormat("format italic") };

  /** A word's actions, or a phrase's: both fill the two-row grid. */
  function actionsFor(target: SelectionTarget, current: () => SpreadHandle): SpreadAction[] {
    if (isPhrase(target.text)) return [
      copy, bold, italic,
      { label: "Search", panel: () => search(target, current()) },
      { label: "Count", panel: async () => count(target, current()) },
      { label: "Rephrase", panel: async () => ({ kind: "rephrase" }) },
    ];
    return [
      copy,
      { label: "Paste", run: async target => { await dispatch("selection paste", { ...target }); return "changed"; } },
      { label: "Define", panel: () => define(target, current()), pending: dictionary() ? undefined : "Offline dictionaries are unavailable here" },
      bold, italic,
      { label: "Spelling", panel: async () => ({ kind: "spelling" }) },
    ];
  }

  /** Grow the opening to hold `height` px of panel content at `width`. */
  function fit(current: SpreadHandle, height: number, width = PANEL_WIDTH) {
    const rows = Math.max(3, Math.min(MAX_PANEL_ROWS, Math.ceil((height + PAD * 2) / current.lineHeight)));
    return current.reshape({ width: Math.min(current.maxWidth, width), rows });
  }

  /** Totals for the phrase, then how often each of its words is used here and across the note. */
  function count(target: SelectionTarget, current: SpreadHandle): Panel {
    const uses = wordUses(target.text, deps.engine.getText());
    fit(current, COUNT_HEIGHT + BODY_LINE * (uses.length + 1) + 12, 380);
    return { kind: "count", stats: passageStats(target.text), uses };
  }

  /** Find the phrase across every note, then grow the opening to list where it appears. */
  async function search(target: SelectionTarget, current: SpreadHandle): Promise<Panel> {
    const query = target.text.replace(/\s+/g, " ").trim();
    const result = await dispatch("notes search", { query }) as SearchResult;
    if (current.closing) throw new Error("closed");
    fit(current, searchHeight(result, Math.min(current.maxWidth, PANEL_WIDTH) - PAD * 2));
    return { kind: "search", result };
  }

  /** Close the spread and open the note with the match selected. */
  async function openMatch(note: SearchNote, query: string) {
    close({ refocus: note.tabId === deps.tabId });
    try {
      const opened = await dispatch("note open", { path: note.path, focus: true }) as { tabId: string; revision?: number };
      const match = note.matches[0];
      const col = match ? match.text.toLowerCase().indexOf(query.toLowerCase()) : -1;
      if (match && col >= 0 && opened.revision !== undefined) {
        await dispatch("selection set", { tabId: opened.tabId, revision: opened.revision,
          range: { anchor: { line: match.line - 1, col }, head: { line: match.line - 1, col: col + query.length } } });
      }
    } catch (error) { showError(error instanceof Error ? error.message : String(error)); }
  }

  /** Rephrase and Spelling through the writer's AI CLI: start a request, poll it, and stop it if the spread closes first. */
  function aiHost(target: SelectionTarget, current: () => SpreadHandle): AiHost & { cancel(): void } {
    const provider = deps.aiProvider();
    let running: { kind: AiKind; id: string } | null = null;
    const cancel = () => {
      if (running) void dispatch(`selection ${running.kind} cancel`, { requestId: running.id }).catch(() => {});
      running = null;
    };
    return {
      provider, ladder: AI_LADDERS[provider],
      needsConsent: () => !consented.has(provider),
      cancel,
      async request(kind, rung) {
        consented.add(provider);
        cancel();
        const mine = { kind, id: crypto.randomUUID() };
        running = mine;
        await dispatch(`selection ${kind}`, { target, provider, rung, requestId: mine.id });
        for (;;) {
          await new Promise(resolve => setTimeout(resolve, AI_POLL_MS));
          if (running !== mine || current().closing) throw new Error("closed");
          const read = await dispatch(`selection ${kind} read`, { requestId: mine.id }) as
            { status: string; error?: { code: string; message: string } } & Record<string, unknown>;
          if (read.status === "running") continue;
          running = null;
          if (read.status === "ready") return read;
          if (read.status === "canceled") throw new Error("closed");
          throw Object.assign(new Error(read.error?.message ?? "The request failed."), { code: read.error?.code });
        }
      },
      async apply(text) {
        await dispatch("selection replace", { target, text });
      },
      async applyAt(revision, range, text) {
        const selected = await dispatch("selection set", { tabId: target.tabId, revision, range });
        await dispatch("selection replace", { target: selected, text });
      },
      fit: height => { if (!current().closing) fit(current(), height); },
    };
  }

  /** Look the word up, grow the opening to fit, and send the word's letters to spell the headword. */
  async function define(target: SelectionTarget, current: SpreadHandle): Promise<Panel> {
    const data = await dispatch("selection define", { ...target }) as { query: string; definition: string | null; source: string };
    if (current.closing) throw new Error("closed");
    if (!data.definition) return { kind: "definition", definition: { kind: "missing", query: data.query } };
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
    return { kind: "definition", definition: { kind: "found", shaped, source: data.source, headwordHeight: flown?.height ?? null } };
  }

  function close(options: { changed?: boolean; refocus?: boolean } = {}) {
    if (!handle || handle.closing) return;
    stopPanel?.(); stopPanel = null;
    detach?.(); detach = null;
    handle.close({ changed: options.changed });
    if (options.refocus) deps.view()?.focus();
  }

  function open(range: { from: number; to: number }, viaKeyboard: boolean) {
    const view = deps.view();
    if (!view) return;
    if (handle) { stopPanel?.(); stopPanel = null; detach?.(); detach = null; handle.dispose(); handle = null; }
    if (!view.state.selection.eq(TextSelection.create(view.state.doc, range.from, range.to))) {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)));
    }
    const target = captureSelection(deps.tabId, deps.engine);
    if (!target) return;

    let opened: SpreadHandle;
    const current = () => opened;
    const ai = aiHost(target, current);
    stopPanel = ai.cancel;
    const panelHost: PanelHost = {
      target, thisTab: deps.tabId,
      done: outcome => close({ changed: outcome === "changed", refocus: true }),
      openMatch: (note, query) => void openMatch(note, query),
      keep: async (name, text) => {
        // A note with that name already exists: fall back to the next free element name.
        const created = await dispatch("note create", { name, text }).catch(error =>
          (error as { code?: string }).code === "NAME_TAKEN" ? dispatch("note create", { text }) : Promise.reject(error)) as { path: string };
        return created.path;
      },
      ai,
    };
    try {
      opened = openSpread({
        view, scroller: deps.scroller(), from: range.from, to: range.to, motion: deps.motion(),
        setDecorations: deps.setDecorations,
        renderOpening: host => render(() => <SpreadOpening actions={actionsFor(target, current)} focus={viaKeyboard} host={panelHost} />, host),
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
    // A resized column re-measures and the words carry on to their new places.
    const resize = () => handle?.relayout();
    const observer = new ResizeObserver(resize);
    observer.observe(deps.scroller());
    // The motion layer never prints; the note prints as written.
    const print = () => { if (handle) { stopPanel?.(); stopPanel = null; detach?.(); detach = null; handle.dispose(); handle = null; } };
    window.addEventListener("pointerdown", pointer, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("beforeprint", print);
    detach = () => {
      observer.disconnect();
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("beforeprint", print);
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
    /**
     * The document is about to change underneath an open spread (an action's
     * edit, an undo, the assistant); `doc` is the edited document. The words
     * land on their new places.
     */
    documentChanged(doc: PMNode) {
      if (!handle) return;
      stopPanel?.(); stopPanel = null;
      detach?.(); detach = null;
      handle.close({ changed: true, doc });
    },
    close,
    /** End at once, without animating (the editor is unmounting). */
    dispose() { stopPanel?.(); stopPanel = null; detach?.(); detach = null; handle?.dispose(); handle = null; },
  };
}

function SpreadOpening(props: { actions: SpreadAction[]; focus: boolean; host: PanelHost }) {
  const [busy, setBusy] = createSignal(false);
  const [panel, setPanel] = createSignal<Panel | null>(null);
  let menu!: HTMLDivElement;
  let region: HTMLDivElement | undefined;
  const target = props.host.target;
  async function run(action: SpreadAction) {
    if (busy() || action.pending || (!action.run && !action.panel)) return;
    setBusy(true);
    try {
      if (action.panel) {
        setPanel(await action.panel());
        if (props.focus) queueMicrotask(() => (region?.querySelector<HTMLElement>("button") ?? region)?.focus());
      } else props.host.done(await action.run!(target));
    } catch (error) {
      if (error instanceof Error && error.message === "closed") return;
      showError(error instanceof Error ? error.message : String(error)); props.host.done("kept");
    } finally { setBusy(false); }
  }
  queueMicrotask(() => { if (props.focus) menu?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); });

  const label = (current: Panel) => ({
    definition: `Definition of ${target.text}`, count: `Count for “${target.text}”`,
    search: `Notes containing “${target.text}”`, rephrase: `Rephrasings of “${target.text}”`,
    spelling: `Spelling and grammar for “${target.text}”`,
  })[current.kind];

  return <Show when={panel()} fallback={
    <div ref={menu} class="text-motion-menu" role="menu" aria-label={`Actions for “${target.text}”`}
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
        <button type="button" role="menuitem" class="text-motion-button" disabled={busy() || (!action.run && !action.panel) || !!action.pending}
          title={action.pending} onMouseDown={event => event.preventDefault()} onClick={() => void run(action)}>{action.label}</button>}
      </For>
    </div>}>
    {current => <div ref={region} class={`text-motion-panel text-motion-${current().kind}`} tabIndex={-1} role="region"
      aria-label={label(current())} style={{ "--text-motion-pad": `${PAD}px` }} onMouseDown={event => {
        // Pressing a panel button keeps focus (and the selection) in the note.
        if ((event.target as HTMLElement).closest("button")) event.preventDefault();
      }}>
      <Switch>
        <Match when={current().kind === "definition"}>{DefinitionPanel((current() as { definition: Definition }).definition, target, props.host)}</Match>
        <Match when={current().kind === "count"}>{CountPanel(current() as { stats: PassageStats; uses: WordUse[] })}</Match>
        <Match when={current().kind === "search"}>{SearchPanel((current() as { result: SearchResult }).result, props.host)}</Match>
        <Match when={current().kind === "rephrase"}><RephrasePanel host={props.host} /></Match>
        <Match when={current().kind === "spelling"}><SpellingPanel host={props.host} /></Match>
      </Switch>
    </div>}
  </Show>;
}

/** Each word of `text` streams in a beat after the last; `start` carries the beat across calls. */
function streamer(start = STREAM_START_MS) {
  let delay = start;
  return (text: string): JSX.Element[] => text.split(/(\s+)/).map(part => {
    if (!part.trim()) return part as unknown as JSX.Element;
    delay += STREAM_STEP_MS;
    return <span style={{ "animation-delay": `${Math.min(delay, 1400)}ms` }}>{part}</span>;
  });
}

function DefinitionPanel(definition: Definition, target: SelectionTarget, host: PanelHost) {
  if (definition.kind === "missing") {
    return <p class="empty">No definition for “{target.text.trim()}” in your active dictionaries. Enable one in the macOS Dictionary app.</p>;
  }
  const found = definition;
  const stream = streamer();
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
    <div class="definition-footer">
      <p class="source">{found.source}</p>
      <KeepButton keep={() => host.keep(`${found.shaped.headword} (definition)`, definitionNote(found.shaped, found.source))} />
    </div>
  </>;
}

/** "Keep as note": saves the definition as a new note, then says where. */
function KeepButton(props: { keep: () => Promise<string> }) {
  const [state, setState] = createSignal<"ready" | "saving" | "kept">("ready");
  async function keep() {
    if (state() !== "ready") return;
    setState("saving");
    try { const path = await props.keep(); setState("kept"); showSuccess(`Kept as ${path}`); }
    catch (error) { setState("ready"); showError(error instanceof Error ? error.message : String(error)); }
  }
  return <button type="button" class="text-motion-button keep-note" disabled={state() !== "ready"} onClick={() => void keep()}>
    {state() === "kept" ? "Kept" : state() === "saving" ? "Keeping…" : "Keep as note"}
  </button>;
}

function CountPanel({ stats, uses }: { stats: PassageStats; uses: WordUse[] }) {
  const most = Math.max(1, ...uses.map(use => use.inNote));
  const figures: Array<[string, number | string]> = [
    ["characters", stats.characters], ["without spaces", stats.charactersNoSpaces],
    ["sentences", stats.sentences], ["to read", formatDuration(stats.readingSeconds)],
  ];
  return <>
    <p class="count-words text-motion-stream"><span><strong>{stats.words.toLocaleString()}</strong> {stats.words === 1 ? "word" : "words"}</span></p>
    <dl class="count-figures">
      <For each={figures}>{([name, value], index) =>
        <div class="text-motion-arrive" style={{ "animation-delay": `${STREAM_START_MS / 2 + index() * 60}ms` }}>
          <dt>{name}</dt><dd>{typeof value === "number" ? value.toLocaleString() : value}</dd></div>}
      </For>
    </dl>
    <table class="count-uses">
      <thead><tr><th scope="col">word</th><th scope="col">here</th><th scope="col">in note</th></tr></thead>
      <tbody>
        <For each={uses}>{(use, index) =>
          <tr class="text-motion-arrive" style={{ "animation-delay": `${STREAM_START_MS / 2 + 240 + index() * 40}ms` }}>
            <th scope="row">{use.word}</th>
            <td>{use.inSelection}</td>
            <td><span class="count-bar" style={{ width: `${(use.inNote / most) * 100}%` }} />{use.inNote.toLocaleString()}</td>
          </tr>}
        </For>
      </tbody>
    </table>
  </>;
}

/** The match text with each occurrence of `query` marked. */
function highlight(text: string, query: string): JSX.Element[] {
  const parts: JSX.Element[] = [];
  const lower = text.toLowerCase(), needle = query.toLowerCase();
  let at = 0;
  for (let hit = lower.indexOf(needle); hit >= 0 && needle; hit = lower.indexOf(needle, at)) {
    parts.push(text.slice(at, hit) as unknown as JSX.Element, <mark>{text.slice(hit, hit + needle.length)}</mark>);
    at = hit + needle.length;
  }
  parts.push(text.slice(at) as unknown as JSX.Element);
  return parts;
}

function SearchPanel(result: SearchResult, host: PanelHost) {
  const total = result.notes.reduce((sum, note) => sum + note.totalMatches, 0);
  const noteName = (path: string) => path.replace(/\.(md|markdown|txt)$/i, "");
  return <Show when={result.notes.length} fallback={<p class="empty">“{result.query}” doesn't appear in any note.</p>}>
    <p class="search-summary text-motion-stream"><span>{total.toLocaleString()} {total === 1 ? "match" : "matches"} in {result.notes.length} {result.notes.length === 1 ? "note" : "notes"}{result.truncated ? " (first 100 shown)" : ""}</span></p>
    <ul class="search-notes">
      <For each={result.notes}>{(note, index) =>
        <li class="text-motion-arrive" style={{ "animation-delay": `${STREAM_START_MS / 2 + index() * 50}ms` }}>
          <button type="button" class="search-note" onClick={() => host.openMatch(note, result.query)}>
            <span class="search-note-name">{noteName(note.path)}{note.tabId === host.thisTab ? " · this note" : ""}</span>
            <span class="search-note-count">{note.totalMatches}</span>
            <For each={note.matches.slice(0, 2)}>{match => <span class="search-match">{highlight(match.text.trim(), result.query)}</span>}</For>
          </button>
        </li>}
      </For>
    </ul>
  </Show>;
}

/**
 * The shared life of a model-backed panel: ask consent once per provider, work
 * at a rung of the ladder (climbing on its own when a reply is unusable), then
 * show what came back or why it failed.
 */
function aiRequest<T>(host: PanelHost, kind: AiKind, layout: (found: T) => void) {
  const ai = host.ai;
  const last = ai.ladder.length - 1;
  const [state, setState] = createSignal<"consent" | "working" | "ready" | "failed">(ai.needsConsent() ? "consent" : "working");
  const [rung, setRung] = createSignal(0);
  const [found, setFound] = createSignal<T | null>(null);
  const [note, setNote] = createSignal("");
  const [error, setError] = createSignal("");
  const [applying, setApplying] = createSignal(false);
  const step = (index: number) => ai.ladder[index];
  async function request(index: number): Promise<void> {
    setRung(index); setState("working"); setError("");
    try {
      const reply = await ai.request(kind, index) as T;
      layout(reply);
      setFound(() => reply); setState("ready");
    } catch (failure) {
      if (failure instanceof Error && failure.message === "closed") return;
      if ((failure as { code?: string }).code === "UNUSABLE" && index < last) {
        setNote(`${step(index).label} didn't return a usable answer, so ${step(index + 1).label} is trying.`);
        return request(index + 1);
      }
      setError(failure instanceof Error ? failure.message : String(failure)); setState("failed");
    }
  }
  /** Run an edit, then close the spread on the changed note. */
  async function edit(change: () => Promise<void>) {
    if (applying()) return;
    setApplying(true);
    try { await change(); host.done("changed"); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); setState("failed"); }
    finally { setApplying(false); }
  }
  if (state() === "working") void request(0);
  return { ai, last, state, rung, found, note, error, applying, step, request, edit, company: providerName(ai.provider) };
}

/** Consent, working, and failure states shared by Rephrase and Spelling; `ready` is the panel's own. */
function AiStates(props: { flow: ReturnType<typeof aiRequest<any>>; host: PanelHost; consent: JSX.Element; working: string; children: JSX.Element }) {
  const flow = props.flow;
  return <>
    <Switch>
      <Match when={flow.state() === "consent"}>
        <p>{props.consent} to <strong>{flow.company}</strong> through your subscription. It starts with {flow.step(0).label}.</p>
        <div class="ai-actions">
          <button type="button" class="text-motion-button" onClick={() => void flow.request(0)}>Send</button>
          <button type="button" class="text-motion-button" onClick={() => props.host.done("kept")}>Cancel</button>
        </div>
      </Match>
      <Match when={flow.state() === "working"}>
        <Show when={flow.note()}><p class="ai-note">{flow.note()}</p></Show>
        <p class="ai-working" aria-live="polite">{props.working} with {flow.step(flow.rung()).label}<span class="dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></p>
      </Match>
      <Match when={flow.state() === "ready"}>{props.children}</Match>
      <Match when={flow.state() === "failed"}>
        <p class="empty" role="alert">{flow.error()}</p>
        <div class="ai-actions"><button type="button" class="text-motion-button" onClick={() => void flow.request(flow.rung())}>Try again</button></div>
      </Match>
    </Switch>
    <p class="source">{flow.step(flow.rung()).label} · your {flow.company} subscription</p>
  </>;
}

/** "Try Sonnet 5.5": the next rung, while there is one. */
function Escalate(props: { flow: ReturnType<typeof aiRequest<any>> }) {
  const flow = props.flow;
  return <Show when={flow.rung() < flow.last}>
    <div class="ai-actions">
      <button type="button" class="text-motion-button" disabled={flow.applying()} onClick={() => void flow.request(flow.rung() + 1)}>Try {flow.step(flow.rung() + 1).short}</button>
    </div>
  </Show>;
}

function RephrasePanel(props: { host: PanelHost }) {
  const words = props.host.target.text.trim().split(/\s+/).length;
  let region!: HTMLDivElement;
  props.host.ai.fit(BODY_LINE * 4 + 40);
  const flow = aiRequest<{ options: string[] }>(props.host, "rephrase", found => {
    const width = region?.clientWidth ? region.clientWidth - 22 : PANEL_WIDTH - PAD * 2 - 22;
    props.host.ai.fit(BODY_LINE + 10 + found.options.reduce((sum, option) => sum + textHeight(option, width) + 20, 0) + BODY_LINE * 2 + 16);
    queueMicrotask(() => region?.querySelector<HTMLButtonElement>(".ai-option")?.focus({ preventScroll: true }));
  });

  return <div ref={region} class="ai-panel">
    <AiStates flow={flow} host={props.host} working="Rephrasing"
      consent={<>Rephrase sends the {words} selected {words === 1 ? "word" : "words"}, and nothing else from your note,</>}>
      <p class="ai-heading">Choose a rephrasing to replace your selection</p>
      <For each={flow.found()?.options ?? []}>{(option, index) =>
        <button type="button" class="ai-option rephrase-option text-motion-stream" disabled={flow.applying()} onClick={() => void flow.edit(() => props.host.ai.apply(option))}>
          <span style={{ "animation-delay": `${index() * 120}ms` }}>{option}</span>
        </button>}
      </For>
      <Escalate flow={flow} />
    </AiStates>
  </div>;
}

function SpellingPanel(props: { host: PanelHost }) {
  const word = props.host.target.text.trim();
  let region!: HTMLDivElement;
  props.host.ai.fit(BODY_LINE * 4 + 40);
  const flow = aiRequest<SpellingCheck>(props.host, "spelling", found => {
    const width = region?.clientWidth ? region.clientWidth - 90 : PANEL_WIDTH - PAD * 2 - 90;
    const grammar = found.grammar.reduce((sum, issue) =>
      sum + textHeight(`${issue.excerpt} → ${issue.replacement}`, width) + textHeight(issue.explanation, width) * 12 / 13 + 16, 0);
    props.host.ai.fit(30 + BODY_LINE + (found.suggestions.length ? 40 : 0) + (grammar || BODY_LINE) + BODY_LINE * 2 + 30);
    queueMicrotask(() => region?.querySelector<HTMLButtonElement>(".spelling-suggestions button, .grammar button")?.focus({ preventScroll: true }));
  });
  const check = () => flow.found()!;

  return <div ref={region} class="ai-panel">
    <AiStates flow={flow} host={props.host} working="Checking"
      consent={<>Spelling sends the sentence around “{word}”, and nothing else from your note,</>}>
      <p class={`flagged text-motion-stream${check().misspelled ? "" : " is-correct"}`}><span>{word}</span></p>
      <p class="ai-heading">{check().misspelled
        ? check().suggestions.length ? "Looks misspelled. Choose a correction:" : "Looks misspelled, but no correction came back."
        : "Spelled correctly here."}</p>
      <Show when={check().suggestions.length}>
        <div class="ai-actions spelling-suggestions">
          <For each={check().suggestions}>{(suggestion, index) =>
            <button type="button" class="text-motion-button text-motion-arrive" style={{ "animation-delay": `${index() * 80}ms` }}
              disabled={flow.applying()} onClick={() => void flow.edit(() => props.host.ai.apply(suggestion))}>{suggestion}</button>}
          </For>
        </div>
      </Show>
      <Show when={check().grammar.length} fallback={<p class="ai-note">No grammar problems in this sentence.</p>}>
        <For each={check().grammar}>{(issue, index) =>
          <div class="grammar text-motion-arrive" style={{ "animation-delay": `${200 + index() * 100}ms` }}>
            <span><del>{issue.excerpt}</del> → <ins>{issue.replacement}</ins></span>
            <button type="button" class="text-motion-button" disabled={flow.applying()} aria-label={`Fix: ${issue.excerpt} to ${issue.replacement}`}
              onClick={() => void flow.edit(() => props.host.ai.applyAt(check().revision, issue.range, issue.replacement))}>Fix</button>
            <span class="why">{issue.explanation}</span>
          </div>}
        </For>
      </Show>
      <Escalate flow={flow} />
    </AiStates>
  </div>;
}
