import type { EditorEngine, Selection, Pos } from "../editor/engine";
import type { PaneWorkspace } from "./writing-panes";
import { CommandFailure, type FeatureCommands, type CommandSchema } from "./feature-commands";

export interface SelectionTarget { paneId: string; tabId: string; revision: number; range: Selection; text: string }
export interface SelectionCommandDeps {
  workspace: () => PaneWorkspace;
  engine: (tabId: string) => EditorEngine | undefined;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<boolean>;
}
export function captureSelection(paneId: string, tabId: string, engine: EditorEngine): SelectionTarget | null {
  const range = engine.sel();
  if (!range) return null;
  const text = engine.getTextRange(range.anchor, range.head);
  if (!text) return null;
  return { paneId, tabId, revision: engine.editSeq(), range: { anchor: { ...range.anchor }, head: { ...range.head } }, text };
}
const obj = (properties: Record<string, CommandSchema>): CommandSchema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const str: CommandSchema = { type: "string" }, num: CommandSchema = { type: "number" };
const pos = obj({ line: num, col: num });
const rangeSchema = obj({ anchor: pos, head: pos });
export const snapshotSchema = obj({ paneId: str, tabId: str, revision: num, range: rangeSchema, text: str });
const samePos = (a: Pos, b: Pos) => a.line === b.line && a.col === b.col;

export function registerSelectionCommands(service: FeatureCommands, deps: SelectionCommandDeps) {
  function source(paneId: string, tabId?: string) {
    const pane = deps.workspace().panes.find(p => p.id === paneId);
    if (!pane || !pane.tabId || (tabId !== undefined && tabId !== pane.tabId)) throw new CommandFailure("NOT_FOUND", "The source note is no longer in this pane.");
    const engine = deps.engine(pane.tabId);
    if (!engine) throw new CommandFailure("UNAVAILABLE", "Select text in a writing note first.");
    return { engine, tabId: pane.tabId };
  }
  function validPosition(p: Pos, engine: EditorEngine) {
    if (!Number.isInteger(p.line) || !Number.isInteger(p.col) || p.line < 0 || p.line >= engine.lineCount() || p.col < 0 || p.col > engine.getLine(p.line).length)
      throw new CommandFailure("INVALID_ARGUMENTS", "Range positions must be valid zero-based UTF-16 line/column offsets.");
  }
  function validate(target: SelectionTarget) {
    const { engine } = source(target.paneId, target.tabId);
    validPosition(target.range.anchor, engine); validPosition(target.range.head, engine);
    const current = captureSelection(target.paneId, target.tabId, engine);
    if (!current || current.revision !== target.revision || current.text !== target.text ||
      !samePos(current.range.anchor, target.range.anchor) || !samePos(current.range.head, target.range.head))
      throw new CommandFailure("STALE_SELECTION", "The source selection changed. Select the passage again and retry.");
    if (engine.hasMultiCursors()) throw new CommandFailure("UNAVAILABLE", "Selection actions currently require one cursor.");
    return engine;
  }
  function add(name: string, description: string, inputSchema: CommandSchema, outputSchema: CommandSchema,
    run: (args: any) => unknown, effect: "read" | "write" = "write") {
    service.register({ name, description, inputSchema, outputSchema, run, effect, version: 1, examples: [name] });
  }
  add("selection read", "Capture a note's selected text, pane, document, revision, and range without reading the clipboard.", obj({ paneId: str }), snapshotSchema, args => {
    const { engine, tabId } = source(args.paneId);
    const target = captureSelection(args.paneId, tabId, engine);
    if (!target) throw new CommandFailure("UNAVAILABLE", "Select a nonempty passage first.");
    return target;
  }, "read");
  add("selection set", "Select a range in a specific note revision. Positions are zero-based UTF-16 offsets; focus stays unchanged.",
    obj({ paneId: str, tabId: str, revision: num, range: rangeSchema }), snapshotSchema, args => {
      const { engine } = source(args.paneId, args.tabId);
      if (engine.editSeq() !== args.revision) throw new CommandFailure("STALE_SELECTION", "The document revision changed.");
      validPosition(args.range.anchor, engine); validPosition(args.range.head, engine);
      if (samePos(args.range.anchor, args.range.head)) throw new CommandFailure("INVALID_ARGUMENTS", "Select a nonempty range.");
      if (engine.hasMultiCursors()) throw new CommandFailure("UNAVAILABLE", "Selection actions currently require one cursor.");
      engine.setSelection(args.range.anchor, args.range.head);
      return captureSelection(args.paneId, args.tabId, engine);
    });
  add("selection copy", "Copy an explicitly captured selection to the system clipboard without changing the note.", snapshotSchema,
    obj({ copied: { type: "boolean" } }), async (target: SelectionTarget) => {
      validate(target);
      try { if (await deps.writeClipboard(target.text)) return { copied: true }; } catch { /* report below */ }
      throw new CommandFailure("CLIPBOARD_UNAVAILABLE", "Could not write to the system clipboard. Try the native Copy shortcut.");
    });
  add("selection paste", "Read the system clipboard and replace a captured selection as one undoable edit. Reject changed targets after clipboard access.", snapshotSchema,
    obj({ tabId: str, revision: num }), async (target: SelectionTarget) => {
      validate(target);
      let text: string;
      try { text = await deps.readClipboard(); }
      catch { throw new CommandFailure("CLIPBOARD_UNAVAILABLE", "Clipboard access is unavailable. Use the native Paste shortcut in the note."); }
      const engine = validate(target);
      if (!text) throw new CommandFailure("EMPTY_CLIPBOARD", "The clipboard has no text; the selection was kept.");
      engine.beginUndoGroup();
      try { engine.insert(text.replace(/\r\n?/g, "\n")); } finally { engine.endUndoGroup(); }
      return { tabId: target.tabId, revision: engine.editSeq() };
    });
}
