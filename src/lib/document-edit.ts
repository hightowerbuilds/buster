import type { EditorEngine, Pos } from "../editor/engine";
import { CommandFailure, type CommandSchema, type FeatureCommands } from "./feature-commands";

export interface TextEdit { find: string; replace: string; occurrence?: number }
export interface PlannedChange { start: number; end: number; replace: string }

const MAX_EDITS = 100;
const MAX_FIND = 20_000;
const preview = (text: string) => JSON.stringify(text.length > 60 ? `${text.slice(0, 57)}…` : text);

/**
 * Resolve every edit against the same original text. Matching is exact and case-sensitive. An edit
 * must match once, or name its 1-based occurrence; edits may not overlap. Nothing is applied here.
 */
export function planEdits(text: string, edits: TextEdit[]): PlannedChange[] {
  if (!edits.length || edits.length > MAX_EDITS) throw new CommandFailure("INVALID_ARGUMENTS", `Provide between 1 and ${MAX_EDITS} edits.`);
  const changes = edits.map((edit, i) => {
    const label = `Edit ${i + 1} (find ${preview(edit.find)})`;
    if (!edit.find || edit.find.length > MAX_FIND) throw new CommandFailure("INVALID_ARGUMENTS", `${label}: find must be 1–${MAX_FIND} characters.`);
    if (edit.occurrence !== undefined && (!Number.isInteger(edit.occurrence) || edit.occurrence < 1))
      throw new CommandFailure("INVALID_ARGUMENTS", `${label}: occurrence must be a whole number starting at 1.`);
    const matches: number[] = [];
    for (let at = text.indexOf(edit.find); at >= 0; at = text.indexOf(edit.find, at + edit.find.length)) matches.push(at);
    if (!matches.length) throw new CommandFailure("NO_MATCH", `${label} does not appear in the note. Matching is exact, including case, spacing and Markdown. Read the note again and copy the text exactly.`);
    let start: number;
    if (edit.occurrence !== undefined) {
      if (edit.occurrence > matches.length) throw new CommandFailure("NO_MATCH", `${label} appears ${matches.length} time(s), so occurrence ${edit.occurrence} does not exist.`);
      start = matches[edit.occurrence - 1];
    } else if (matches.length > 1) {
      throw new CommandFailure("AMBIGUOUS_MATCH", `${label} appears ${matches.length} times. Include more surrounding text so it is unique, or pass occurrence.`);
    } else start = matches[0];
    return { start, end: start + edit.find.length, replace: edit.replace.replace(/\r\n?/g, "\n"), index: i };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < changes.length; i++) {
    if (changes[i].start < changes[i - 1].end)
      throw new CommandFailure("OVERLAPPING_EDITS", `Edits ${changes[i - 1].index + 1} and ${changes[i].index + 1} overlap. Combine them into one edit.`);
  }
  return changes.map(({ start, end, replace }) => ({ start, end, replace }));
}

export function applyChanges(text: string, changes: PlannedChange[]): string {
  let result = "";
  let at = 0;
  for (const change of changes) {
    result += text.slice(at, change.start) + change.replace;
    at = change.end;
  }
  return result + text.slice(at);
}

/** Move an offset through applied changes; offsets inside a replaced span land at its end. */
export function mapOffset(offset: number, changes: PlannedChange[]): number {
  let shift = 0;
  for (const change of changes) {
    if (change.end <= offset) shift += change.replace.length - (change.end - change.start);
    else if (change.start < offset) return change.start + shift + change.replace.length;
    else break;
  }
  return offset + shift;
}

const toOffset = (lines: string[], pos: Pos) => lines.slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.col;
function toPos(text: string, offset: number): Pos {
  const before = text.slice(0, offset).split("\n");
  return { line: before.length - 1, col: before[before.length - 1].length };
}

const str: CommandSchema = { type: "string" };
const editSchema: CommandSchema = {
  type: "object",
  properties: { find: { type: "string", minLength: 1 }, replace: str, occurrence: { type: "number" } },
  required: ["find", "replace"],
  additionalProperties: false,
};
const inputSchema: CommandSchema = {
  type: "object",
  properties: { tabId: { type: "string", minLength: 1 }, revision: { type: "number" }, edits: { type: "array", items: editSchema } },
  required: ["tabId", "revision", "edits"],
  additionalProperties: false,
};

export interface DocumentEditDeps {
  hasTab: (tabId: string) => boolean;
  engine: (tabId: string) => EditorEngine | undefined;
}

export function registerDocumentEditCommands(commands: FeatureCommands, deps: DocumentEditDeps) {
  function prepare(args: { tabId: string; revision: number; edits: TextEdit[] }) {
    if (!deps.hasTab(args.tabId)) throw new CommandFailure("NOT_FOUND", "No open note has that tab ID. Use document list.");
    const engine = deps.engine(args.tabId);
    if (!engine) throw new CommandFailure("NOT_READY", "The note's editor is not ready. Read it again with document read.");
    if (engine.editSeq() !== args.revision)
      throw new CommandFailure("STALE_REVISION", "The note changed since that revision was read. Read it again with document read and retry.");
    const text = engine.getText();
    return { engine, text, changes: planEdits(text, args.edits) };
  }
  commands.register({
    name: "document edit",
    description: "Change text in an open note: capitalization, spelling, rewording, inserting or deleting passages. " +
      "Each edit replaces an exact, case-sensitive `find` string (copied from document read, including Markdown) with `replace`. " +
      "`find` must appear once in the note; include neighbouring words to make it unique, or pass a 1-based `occurrence`. " +
      "To insert, keep the anchor text in `replace`; to delete, use an empty `replace`. All edits are checked against `revision` " +
      "and applied together as one undo step, or none are applied.",
    version: 1,
    effect: "write",
    inputSchema,
    outputSchema: { type: "object", properties: { tabId: str, revision: { type: "number" }, applied: { type: "number" } }, required: ["tabId", "revision", "applied"], additionalProperties: false },
    examples: ['document edit {"tabId":"file_1","revision":12,"edits":[{"find":"ok it could be","replace":"Ok it could be"}]}'],
    check: args => { prepare(args as never); },
    run: args => {
      const { engine, text, changes } = prepare(args as never);
      const effective = changes.filter(change => text.slice(change.start, change.end) !== change.replace);
      if (!effective.length) return { tabId: args.tabId as string, revision: engine.editSeq(), applied: 0 };
      const lines = text.split("\n");
      const sel = engine.sel();
      const next = applyChanges(text, effective);
      const map = (pos: Pos) => toPos(next, mapOffset(toOffset(lines, pos), effective));
      const head = map(engine.cursor());
      engine.beginUndoGroup();
      try { engine.replaceDocument(next, sel ? { anchor: map(sel.anchor), head: map(sel.head) } : { anchor: head, head }); }
      finally { engine.endUndoGroup(); }
      return { tabId: args.tabId as string, revision: engine.editSeq(), applied: effective.length };
    },
  });
}
