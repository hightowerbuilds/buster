import { createEffect, createMemo, on, onCleanup, onMount, untrack } from "solid-js";
import { DecorationSet, EditorView } from "prosemirror-view";
import type { EditorState } from "prosemirror-state";
import { createEditorEngine, type EditorEngine, type Pos, type Selection } from "./engine";
import { createBlockEditor } from "./block-editor";
import { useBuster } from "../lib/buster-context";
import { resolveBlogTokens, writingStyle } from "../lib/blog-themes";
import { asciiArtDecorations, refreshAsciiArt, setAsciiArtMotion } from "./ascii-art";
import { writingPalette } from "./writing-effects";
import { focusTabPanel } from "../lib/focus-service";
import { createSpreadMenu } from "./SpreadMenu";
import { isAiProvider } from "../lib/ai-oneshot";
import "prosemirror-view/style/prosemirror.css";
import "./BlockEditor.css";

export default function BlockEditor(props: {
  tabId: string; initialText: string; initialDirty: boolean; initialCursor?: Pos; initialSelection?: Selection | null;
  initialScrollTop: number; filePath: string | null; active: boolean; autoFocus: boolean;
  onEngineReady(engine: EditorEngine): void; onDirtyChange(dirty: boolean): void;
  onCursorChange(line: number, col: number): void; onScrollChange(top: number): void;
}) {
  const { store, engines, appearance, commands } = useBuster();
  const engine = untrack(() => engines.get(props.tabId) ?? createEditorEngine(props.initialText, props.filePath ?? undefined));
  untrack(() => {
    if (props.initialSelection) engine.setSelection(props.initialSelection.anchor, props.initialSelection.head);
    else if (props.initialCursor) engine.setCursor(props.initialCursor);
    if (props.initialDirty) engine.markDirty();
    props.onEngineReady(engine);
    engines.set(props.tabId, engine);
  });
  let mount!: HTMLDivElement;
  let scroller!: HTMLDivElement;
  let view: EditorView | undefined;
  let motionDecorations = DecorationSet.empty;
  const values = createMemo(() => appearance.forTab(props.tabId));
  const writing = createMemo(() => writingStyle(store.settings.blog_theme));
  const reducedMotion = () => !values().motion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  setAsciiArtMotion(reducedMotion);
  /** Blocks whose Courier ASCII art has already been shown, so recreated art doesn't assemble again. */
  const seenArt = new Set<string>();
  /** Courier ASCII art (drop caps, headings) plus an open spread's decorations. */
  const decorations = (state: EditorState) => {
    if (untrack(writing) !== "courier") return motionDecorations;
    // DecorationSet.create consumes its array (it nulls entries as it files
    // them), and the art is cached per document, so always pass a copy.
    const art = asciiArtDecorations(state.doc, seenArt);
    return DecorationSet.create(state.doc, motionDecorations === DecorationSet.empty ? [...art] : [...motionDecorations.find(), ...art]);
  };
  const spread = createSpreadMenu({
    tabId: props.tabId, engine, commands, view: () => view, scroller: () => scroller,
    aiProvider: () => isAiProvider(store.settings.ai_provider) ? store.settings.ai_provider : "claude",
    motion: () => reducedMotion() ? "off" : store.settings.spread_motion === "wild" || store.settings.spread_motion === "off" ? store.settings.spread_motion : "calm",
    setDecorations: (next, render = true) => {
      motionDecorations = next;
      if (render && view && !view.isDestroyed) view.setProps({ decorations });
    },
  });
  const controller = createBlockEditor(engine, state => {
    // An open spread's decorations describe the old document; move them onto the new one before the view does.
    if (view && motionDecorations !== DecorationSet.empty && !state.doc.eq(view.state.doc)) spread.documentChanged(state.doc);
    view?.updateState(state);
  });
  const style = createMemo(() => {
    const settings = values(), palette = writingPalette(store.palette, settings);
    return {
      ...resolveBlogTokens(writing(), palette),
      "--blog-bg": palette.editorBg, "--blog-text": palette.text,
      "--blog-container-padding": "0px", "font-size": `${settings.fontSize || store.settings.font_size}px`,
      "--blog-line-height": String(settings.lineHeight || 1.65),
      "--block-width": settings.columnWidth ? `${settings.columnWidth}px` : "100%",
      "--block-margin": settings.alignment === "center" ? "auto" : "0",
      padding: `${settings.paddingTop}px ${settings.paddingRight}px ${settings.paddingBottom}px ${settings.paddingLeft}px`,
    };
  });
  onMount(() => {
    view = new EditorView(mount, {
      state: controller.state,
      dispatchTransaction: tr => controller.dispatch(tr),
      decorations,
      attributes: { class: "blog-preview block-prose", role: "textbox", "aria-label": "Note editor", "aria-multiline": "true", "data-tab-focus-target": "true", spellcheck: "true" },
      handleDOMEvents: {
        beforeinput: (_view, event) => {
          const type = (event as InputEvent).inputType;
          if (type !== "historyUndo" && type !== "historyRedo") return false;
          event.preventDefault();
          if (type === "historyUndo") engine.undo(); else engine.redo();
          controller.sync();
          return true;
        },
        // Editing a link must not navigate away from the note.
        click: (_view, event) => { if ((event.target as Element).closest("a")) event.preventDefault(); return false; },
        keydown: (_view, event) => {
          if ((event.ctrlKey || event.metaKey) && ["b", "i", "z", "y"].includes(event.key.toLowerCase())) event.stopPropagation();
          if ((event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) && spread.openAtSelection()) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        // Right-clicking a word parts the text around it instead of opening a native menu.
        contextmenu: (_view, event) => {
          if (!spread.openAtPointer(event as MouseEvent)) return false;
          event.preventDefault();
          return true;
        },
      },
    });
    scroller.scrollTop = props.initialScrollTop;
    if (props.autoFocus) focusTabPanel(props.tabId);
  });
  createEffect(() => { engine.editSeq(); engine.cursor(); engine.sel(); controller.sync(); });
  createEffect(() => props.onDirtyChange(engine.dirty()));
  createEffect(() => { const pos = engine.cursor(); props.onCursorChange(pos.line, pos.col); });
  createEffect(() => { if (!props.active) spread.close(); });
  // Switching style adds or removes the ASCII art; size and color changes redraw it.
  createEffect(on(writing, () => { if (view && !view.isDestroyed) view.setProps({ decorations }); }, { defer: true }));
  createEffect(on(style, () => queueMicrotask(refreshAsciiArt), { defer: true }));
  onCleanup(() => { spread.dispose(); controller.destroy(); view?.destroy(); });
  return <div class="block-editor" ref={scroller} style={style()} data-writing-style={writing()} onScroll={() => props.onScrollChange(scroller.scrollTop)}>
    <div class="block-editor-column" ref={mount} />
  </div>;
}
