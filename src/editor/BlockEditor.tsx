import { createEffect, createMemo, onCleanup, onMount, untrack } from "solid-js";
import { EditorView } from "prosemirror-view";
import { createEditorEngine, type EditorEngine, type Pos, type Selection } from "./engine";
import { createBlockEditor } from "./block-editor";
import { useBuster } from "../lib/buster-context";
import { resolveBlogTokens } from "../lib/blog-themes";
import { writingPalette } from "./writing-effects";
import { focusTabPanel } from "../lib/focus-service";
import "prosemirror-view/style/prosemirror.css";
import "./BlockEditor.css";

export default function BlockEditor(props: {
  tabId: string; initialText: string; initialDirty: boolean; initialCursor?: Pos; initialSelection?: Selection | null;
  initialScrollTop: number; filePath: string | null; active: boolean; autoFocus: boolean;
  onEngineReady(engine: EditorEngine): void; onDirtyChange(dirty: boolean): void;
  onCursorChange(line: number, col: number): void; onScrollChange(top: number): void;
}) {
  const { store, engines, appearance } = useBuster();
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
  const controller = createBlockEditor(engine, state => view?.updateState(state));
  const values = createMemo(() => appearance.forTab(props.tabId));
  const style = createMemo(() => {
    const settings = values(), palette = writingPalette(store.palette, settings);
    return {
      ...resolveBlogTokens(store.settings.blog_theme || "normal", store.settings.theme_mode || "dark", palette),
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
          return false;
        },
      },
    });
    scroller.scrollTop = props.initialScrollTop;
    if (props.autoFocus) focusTabPanel(props.tabId);
  });
  createEffect(() => { engine.editSeq(); engine.cursor(); engine.sel(); controller.sync(); });
  createEffect(() => props.onDirtyChange(engine.dirty()));
  createEffect(() => { const pos = engine.cursor(); props.onCursorChange(pos.line, pos.col); });
  onCleanup(() => { controller.destroy(); view?.destroy(); });
  return <div class="block-editor" ref={scroller} style={style()} onScroll={() => props.onScrollChange(scroller.scrollTop)}>
    <div class="block-editor-column" ref={mount} />
  </div>;
}
