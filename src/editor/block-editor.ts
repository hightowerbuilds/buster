import { batch } from "solid-js";
import { EditorState, TextSelection, type Command, type Transaction } from "prosemirror-state";
import { baseKeymap, chainCommands, setBlockType, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import type { EditorEngine } from "./engine";
import { blockPosition, blockSchema as schema, mapToSource, parseBlocks, positionOffset, preservedSerializer, serializeBlocks, sourceOffset, sourcePosition } from "./block-markdown";

export type BlockFormat = "heading" | "bold" | "italic" | "list";
export const blockEditors = new WeakMap<EditorEngine, BlockEditor>();
export type BlockEditor = ReturnType<typeof createBlockEditor>;

export function createBlockEditor(engine: EditorEngine, update: (state: EditorState) => void = () => {}) {
  const doc = parseBlocks(engine.getText());
  let serialize = preservedSerializer(doc, engine.getText());
  let map = mapToSource(serializeBlocks(doc), engine.getText());
  let syncing = false;
  const plugins = [
    inputRules({ rules: [
      textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, match => ({ level: match[1].length })),
      wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list),
      wrappingInputRule(/^(\d+)\.\s$/, schema.nodes.ordered_list, match => ({ order: +match[1] })),
      wrappingInputRule(/^>\s$/, schema.nodes.blockquote),
      textblockTypeInputRule(/^```([\w-]*)\s$/, schema.nodes.code_block, match => ({ params: match[1] })),
    ] }),
    keymap({
      "Mod-z": () => { engine.undo(); sync(); return true; },
      "Mod-Shift-z": () => { engine.redo(); sync(); return true; },
      "Mod-y": () => { engine.redo(); sync(); return true; },
      "Mod-b": toggleMark(schema.marks.strong),
      "Mod-i": toggleMark(schema.marks.em),
      Enter: chainCommands(splitListItem(schema.nodes.list_item), baseKeymap.Enter),
      Tab: sinkListItem(schema.nodes.list_item),
      "Shift-Tab": liftListItem(schema.nodes.list_item),
      "Shift-Enter": (state, dispatch) => { dispatch?.(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView()); return true; },
    }), keymap(baseKeymap),
  ];
  let state = EditorState.create({ doc, plugins });
  function selection() {
    return {
      anchor: sourcePosition(map.text, sourceOffset(map, state.selection.anchor, state.selection.anchor > state.selection.head ? -1 : 1)),
      head: sourcePosition(map.text, sourceOffset(map, state.selection.head, state.selection.head > state.selection.anchor ? -1 : 1)),
    };
  }
  function dispatch(transaction: Transaction) {
    const next = state.applyTransaction(transaction).state;
    const changed = !next.doc.eq(state.doc);
    state = next;
    syncing = true;
    try {
      batch(() => {
        if (changed) {
          map = serialize(state.doc);
          engine.replaceDocument(map.text, selection());
        } else {
          const range = selection();
          if (state.selection.empty) engine.setCursor(range.head);
          else engine.setSelection(range.anchor, range.head);
        }
        update(state);
      });
    } finally { syncing = false; }
  }
  function sync() {
    if (syncing) return;
    const text = engine.getText();
    let tr = state.tr;
    if (text !== map.text) {
      const next = parseBlocks(text);
      serialize = preservedSerializer(next, text);
      map = mapToSource(serializeBlocks(next), text);
      tr = tr.replaceWith(0, state.doc.content.size, next.content);
    }
    const range = engine.sel() ?? { anchor: engine.cursor(), head: engine.cursor() };
    const anchor = Math.min(tr.doc.content.size, blockPosition(map, positionOffset(text, range.anchor)));
    const head = Math.min(tr.doc.content.size, blockPosition(map, positionOffset(text, range.head)));
    const nextSelection = TextSelection.between(tr.doc.resolve(anchor), tr.doc.resolve(head));
    if (!tr.docChanged && nextSelection.eq(state.selection)) return;
    state = state.apply(tr.setSelection(nextSelection));
    update(state);
  }
  function inspect() {
    const { from, to, $from, empty } = state.selection;
    const marks = state.storedMarks ?? $from.marks();
    const markState = (name: string): boolean | "mixed" => {
      if (empty) return !!schema.marks[name].isInSet(marks);
      let yes = false, no = false;
      state.doc.nodesBetween(from, to, node => {
        if (node.isText) { if (schema.marks[name].isInSet(node.marks)) yes = true; else no = true; }
      });
      return yes && no ? "mixed" : yes;
    };
    const headings: number[] = [];
    state.doc.nodesBetween(from, to, node => { if (node.isTextblock) headings.push(node.type === schema.nodes.heading ? node.attrs.level : 0); });
    let list: "ordered" | "unordered" | "none" = "none";
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type === schema.nodes.bullet_list) { list = "unordered"; break; }
      if ($from.node(depth).type === schema.nodes.ordered_list) { list = "ordered"; break; }
    }
    return { heading: headings.some(level => level !== headings[0]) ? "mixed" as const : headings[0] ?? 0,
      bold: markState("strong"), italic: markState("em"), list };
  }
  function format(kind: BlockFormat, value?: number | string) {
    let command: Command;
    if (kind === "bold" || kind === "italic") command = toggleMark(schema.marks[kind === "bold" ? "strong" : "em"]);
    else if (kind === "heading") command = setBlockType(value ? schema.nodes.heading : schema.nodes.paragraph, value ? { level: Number(value) } : undefined);
    else {
      const desired = value === "ordered" ? schema.nodes.ordered_list : schema.nodes.bullet_list;
      const { $from } = state.selection;
      let depth = $from.depth;
      while (depth > 0 && ![schema.nodes.bullet_list, schema.nodes.ordered_list].includes($from.node(depth).type)) depth--;
      if (depth && $from.node(depth).type !== desired) {
        command = (current, send) => { send?.(current.tr.setNodeMarkup($from.before(depth), desired, { tight: true })); return true; };
      } else command = depth ? liftListItem(schema.nodes.list_item) : wrapInList(desired, { tight: true });
    }
    engine.beginUndoGroup();
    try { return command(state, dispatch); } finally { engine.endUndoGroup(); }
  }
  const controller = { get state() { return state; }, dispatch, sync, inspect, format, destroy: () => { blockEditors.delete(engine); } };
  blockEditors.set(engine, controller);
  sync();
  return controller;
}
