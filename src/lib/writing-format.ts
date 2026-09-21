import { marked, type Token } from "marked";
import { createSignal } from "solid-js";
import type { EditorEngine, Pos, Selection } from "../editor/engine";
import type { PaneWorkspace } from "./writing-panes";
import type { Tab } from "./tab-types";
import { CommandFailure, type FeatureCommands, type CommandSchema } from "./feature-commands";

export interface FormatTarget { paneId: string; tabId: string; revision: number; range: Selection; text: string }
export interface WritingFormattingDeps { workspace(): PaneWorkspace; tabs(): Tab[]; engine(tabId: string): EditorEngine | undefined }
type Edit = { start: number; end: number; text: string };
type InlineSpan = { start: number; end: number; marker: number; kind: string };
const fail = (message: string): never => { throw new CommandFailure("UNSUPPORTED_FORMAT", message); };
const same = (a: Pos, b: Pos) => a.line === b.line && a.col === b.col;
const compare = (a: Pos, b: Pos) => a.line - b.line || a.col - b.col;
const ordered = (range: Selection) => compare(range.anchor, range.head) <= 0 ? [range.anchor, range.head] : [range.head, range.anchor];
const offset = (lines: string[], pos: Pos) => lines.slice(0, pos.line).reduce((n, line) => n + line.length + 1, 0) + pos.col;
function position(text: string, value: number): Pos {
  const before = text.slice(0, Math.max(0, value)).split("\n");
  return { line: before.length - 1, col: before[before.length - 1].length };
}
function spans(line: string) {
  const result: InlineSpan[] = [];
  function visit(tokens: Token[], base: number) {
    let at = base;
    for (const token of tokens) {
      if (token.type === "strong" || token.type === "em") {
        const marker = token.type === "strong" ? 2 : 1;
        result.push({ start: at, end: at + token.raw.length, marker, kind: token.type });
        if ("tokens" in token && token.tokens) visit(token.tokens as Token[], at + marker);
      } else if (["codespan", "link", "image", "html", "escape"].includes(token.type)) {
        result.push({ start: at, end: at + token.raw.length, marker: 0, kind: token.type });
      }
      at += token.raw.length;
    }
  }
  visit(marked.Lexer.lexInline(line), 0);
  return result;
}
function lineRange(range: Selection) {
  const [start, end] = ordered(range);
  return { first: start.line, last: end.line > start.line && end.col === 0 ? end.line - 1 : end.line };
}
function guardBlocks(lines: string[], first: number, last: number) {
  const document = lines.join("\n"), from = offset(lines, { line: first, col: 0 }), to = offset(lines, { line: last, col: lines[last].length });
  for (const span of spans(document)) {
    if (["codespan", "link", "image", "html"].includes(span.kind) && document.slice(span.start, span.end).includes("\n") && from < span.end && to >= span.start) fail("Multiline code, links, and HTML are edited directly in Markdown.");
  }
  let fence: { char: string; size: number } | undefined;
  for (let i = 0; i <= last; i++) {
    const line = lines[i];
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    const inside = !!fence;
    if (marker) {
      if (!fence) fence = { char: marker[1][0], size: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.size && !marker[2].trim()) fence = undefined;
    }
    if (i < first) continue;
    if (inside || marker) fail("Format prose outside fenced code blocks.");
    if (/^\s*>/.test(line)) fail("Block quotes are edited directly in Markdown.");
    if (/^(?: {4}|\t)/.test(line) && !/^\s*(?:[-+*]|\d+[.)])\s/.test(line)) fail("Indented code and list continuation lines are edited directly in Markdown.");
    if (/^ {0,3}(?:={2,}|-{2,})\s*$/.test(line) || (i + 1 < lines.length && /^ {0,3}(?:={2,}|-{2,})\s*$/.test(lines[i + 1]))) fail("Setext headings and rule boundaries are edited directly in Markdown.");
    if (/^\s*(?:\|.*\||(?:[-*_]\s*){3,})\s*$/.test(line)) fail("Tables and thematic rules are edited directly in Markdown.");
  }
}
function inlinePlan(line: string, start: number, end: number, kind: "strong" | "em"): Edit[] {
  const parsed = spans(line);
  if (start === end && parsed.some(s => s.marker && (start === s.start || start === s.end))) fail("Place the caret inside the emphasized passage, or select the passage to toggle it.");
  const overlaps = (s: InlineSpan) => start === end ? start > s.start && start < s.end : start < s.end && end > s.start;
  for (const span of parsed) {
    if (!overlaps(span)) continue;
    if (["codespan", "link", "image", "html"].includes(span.kind)) fail("Select plain prose outside code, links, images, and HTML.");
    if (span.kind === "escape" && (start > span.start || end < span.end)) fail("Keep escaped Markdown characters together when selecting text.");
  }
  const ancestors = parsed.filter(s => s.kind === kind && start >= s.start + s.marker && end <= s.end - s.marker);
  const active = ancestors[ancestors.length - 1];
  const exact = parsed.find(s => s.kind === kind && start === s.start && end === s.end);
  const toggle = exact || active;
  if (toggle) {
    if (start !== end && !exact && (start !== toggle.start + toggle.marker || end !== toggle.end - toggle.marker)) fail("Select the complete emphasized passage to remove its formatting.");
    return [{ start: toggle.start, end: toggle.start + toggle.marker, text: "" }, { start: toggle.end - toggle.marker, end: toggle.end, text: "" }];
  }
  for (const span of parsed.filter(s => s.marker && overlaps(s))) {
    const contains = start <= span.start && end >= span.end;
    const contained = start >= span.start + span.marker && end <= span.end - span.marker;
    if ((!contains && !contained) || (span.kind === kind && contains)) fail("Select one complete emphasis span, or plain text, to avoid overlapping Markdown markers.");
  }
  // A preceding escape would turn the opening marker into literal text.
  let slashes = 0; for (let i = start - 1; i >= 0 && line[i] === "\\"; i--) slashes++;
  if (slashes % 2) fail("Move the selection away from an escape character.");
  slashes = 0; for (let i = end - 1; i >= start && line[i] === "\\"; i--) slashes++;
  if (slashes % 2) fail("Keep a trailing escape outside the formatted passage.");
  const marker = kind === "strong" ? "**" : "*";
  // Unmatched delimiters at a boundary cannot safely be reinterpreted.
  for (const col of [start - 1, start, end - 1, end]) {
    if (col < 0 || col >= line.length || !/[*_]/.test(line[col])) continue;
    if (!parsed.some(s => col >= s.start && col < s.end)) fail("Move the selection away from unmatched Markdown emphasis markers.");
  }
  return start === end ? [{ start, end, text: marker + marker }] : [{ start, end: start, text: marker }, { start: end, end, text: marker }];
}

export function createWritingFormatting(deps: WritingFormattingDeps) {
  // Distinguish a just-created empty pair from a literal thematic rule such as ****.
  // This ephemeral hint expires on any document edit; source text alone is ambiguous.
  const templates = new Map<string, { engine: EditorEngine; revision: number; kind: "strong" | "em"; start: number; size: number; caret: Pos }>();
  const [templateVersion, setTemplateVersion] = createSignal(0);
  function source(paneId: string, tabId?: string) {
    const pane = deps.workspace().panes.find(p => p.id === paneId);
    const tab = deps.tabs().find(t => t.id === pane?.tabId);
    if (!pane || !tab || (tabId && tab.id !== tabId)) throw new CommandFailure("NOT_FOUND", "The source note is no longer in this pane.");
    if (tab.type !== "file" || !/\.(?:md|markdown)$/i.test(tab.path || tab.name)) throw new CommandFailure("UNAVAILABLE", "Return to a Markdown note to use formatting.");
    const engine = deps.engine(tab.id);
    if (!engine || engine.hasMultiCursors()) throw new CommandFailure("UNAVAILABLE", "Formatting requires a ready Markdown note with one cursor.");
    return { tab, engine };
  }
  function capture(paneId: string): FormatTarget {
    const { tab, engine } = source(paneId);
    const range = engine.sel() || { anchor: engine.cursor(), head: engine.cursor() };
    return { paneId, tabId: tab.id, revision: engine.editSeq(), range: { anchor: { ...range.anchor }, head: { ...range.head } }, text: engine.getTextRange(range.anchor, range.head) };
  }
  function validate(target: FormatTarget) {
    const { engine } = source(target.paneId, target.tabId);
    const current = capture(target.paneId);
    if (target.revision !== current.revision || target.text !== current.text || !same(target.range.anchor, current.range.anchor) || !same(target.range.head, current.range.head)) throw new CommandFailure("STALE_FORMAT_TARGET", "The note or selection changed. Return to the note and retry formatting.");
    return engine;
  }
  function edit(target: FormatTarget, edits: Edit[], insideMarker?: number, inline = false) {
    const engine = validate(target), before = engine.getText(), lines = before.split("\n");
    edits = edits.filter(e => before.slice(e.start, e.end) !== e.text).sort((a, b) => a.start - b.start);
    if (!edits.length) return inspect(target.paneId);
    if (templates.delete(target.tabId)) setTemplateVersion(n => n + 1);
    const [start, end] = ordered(target.range), from = offset(lines, start), to = offset(lines, end);
    const map = (at: number, bias: "left" | "right") => {
      let delta = 0;
      for (const e of edits) {
        if (at < e.start || (at === e.start && e.start === e.end && bias === "left")) break;
        if (at < e.end) return e.start + delta + e.text.length;
        delta += e.text.length - (e.end - e.start);
      }
      return at + delta;
    };
    let after = before;
    for (const e of [...edits].reverse()) after = after.slice(0, e.start) + e.text + after.slice(e.end);
    let a = map(from, "right"), b = map(to, inline && from !== to ? "left" : "right");
    if (insideMarker !== undefined) a = b = from + insideMarker;
    const low = position(after, a), high = position(after, b);
    engine.beginUndoGroup();
    try {
      // Replace only the affected interval, preserving unrelated text and one undo snapshot.
      const first = edits[0].start, last = edits[edits.length - 1].end;
      const totalDelta = after.length - before.length;
      engine.setSelection(position(before, first), position(before, last));
      engine.insert(after.slice(first, last + totalDelta));
      if (a === b) engine.setCursor(low);
      else engine.setSelection(compare(target.range.anchor, target.range.head) <= 0 ? low : high, compare(target.range.anchor, target.range.head) <= 0 ? high : low);
    } finally { engine.endUndoGroup(); }
    return inspect(target.paneId);
  }
  function emphasis(target: FormatTarget, kind: "strong" | "em") {
    const engine = validate(target), lines = engine.getText().split("\n"), { first, last } = lineRange(target.range);
    const [start, end] = ordered(target.range), empty = same(start, end), edits: Edit[] = [];
    const pending = templates.get(target.tabId);
    if (pending && pending.engine === engine && pending.revision === target.revision && empty && same(start, pending.caret)) {
      if (pending.kind !== kind) fail("Type into the empty markers, or toggle their original style off first.");
      return edit(target, [{ start: pending.start, end: pending.start + pending.size, text: "" }]);
    }
    guardBlocks(lines, first, last);
    for (let i = first; i <= last; i++) {
      let a = i === start.line ? start.col : 0, b = i === end.line ? end.col : lines[i].length;
      const blockPrefix = lines[i].match(/^(?: {0,3}#{1,6}[ \t]+|\s*(?:[-+*]|\d+[.)])[ \t]+)/)?.[0].length || 0;
      if (blockPrefix && a < blockPrefix) {
        if (empty || a > 0 || b < blockPrefix) fail("Select the text after the heading or list marker to apply emphasis.");
        a = blockPrefix;
      }
      if (/^ {0,3}#{1,6}[ \t]+/.test(lines[i])) {
        const closing = lines[i].match(/[ \t]+#+[ \t]*$/);
        if (closing && b > closing.index!) {
          if (empty || a > closing.index!) fail("Place the caret before the closing heading markers.");
          b = closing.index!;
        }
      }
      if (!empty) {
        while (a < b && /\s/.test(lines[i][a])) a++;
        while (b > a && /\s/.test(lines[i][b - 1])) b--;
        // Keep backslash hard breaks outside the emphasis, just like two-space breaks.
        if (b === lines[i].length && i < lines.length - 1) {
          let slashes = 0; for (let c = b - 1; c >= a && lines[i][c] === "\\"; c--) slashes++;
          if (slashes % 2) b--;
        }
        if (a === b) continue;
      }
      const base = offset(lines, { line: i, col: 0 });
      edits.push(...inlinePlan(lines[i], a, b, kind).map(e => ({ ...e, start: e.start + base, end: e.end + base })));
    }
    const insertedPair = empty && edits.length === 1 && !!edits[0].text;
    const result = edit(target, edits, insertedPair ? (kind === "strong" ? 2 : 1) : undefined, true);
    if (insertedPair) {
      for (const id of templates.keys()) if (!deps.tabs().some(tab => tab.id === id)) templates.delete(id);
      templates.set(target.tabId, { engine, revision: engine.editSeq(), kind, start: edits[0].start, size: edits[0].text.length, caret: { ...engine.cursor() } });
      setTemplateVersion(n => n + 1);
      return inspect(target.paneId);
    }
    return result;
  }
  function heading(target: FormatTarget, level: number) {
    if (!Number.isInteger(level) || level < 0 || level > 6) throw new CommandFailure("INVALID_ARGUMENTS", "Heading level must be 0 (paragraph) through 6.");
    const engine = validate(target), lines = engine.getText().split("\n"), { first, last } = lineRange(target.range), edits: Edit[] = [];
    guardBlocks(lines, first, last);
    for (let i = first; i <= last; i++) {
      if (/^\s*(?:[-+*]|\d+[.)])\s/.test(lines[i])) fail("Remove list formatting before turning a list item into a heading.");
      if (!lines[i].trim() && first !== last) continue;
      const prefix = lines[i].match(/^( {0,3})(#{1,6}(?:[ \t]+|$))?/)!;
      const at = offset(lines, { line: i, col: prefix[1].length });
      edits.push({ start: at, end: at + (prefix[2]?.length || 0), text: level ? "#".repeat(level) + " " : "" });
      if (prefix[2]) {
        const closing = lines[i].match(/[ \t]+#+[ \t]*$/);
        if (closing && closing.index! >= prefix[0].length) edits.push({ start: offset(lines, { line: i, col: closing.index! }), end: offset(lines, { line: i, col: lines[i].length }), text: "" });
      }
    }
    return edit(target, edits);
  }
  function list(target: FormatTarget, kind: "unordered" | "ordered") {
    if (kind !== "unordered" && kind !== "ordered") throw new CommandFailure("INVALID_ARGUMENTS", "Choose an ordered or unordered list.");
    const engine = validate(target), lines = engine.getText().split("\n"), { first, last } = lineRange(target.range), edits: Edit[] = [];
    guardBlocks(lines, first, last);
    const selected = lines.slice(first, last + 1);
    if (selected.some(line => /^ {0,3}#{1,6}(?:\s|$)/.test(line))) fail("Choose Paragraph before converting headings to a list.");
    const match = (line: string) => line.match(/^(\s*)(?:(\d+[.)]|[-+*])([ \t]+|$))?/)!;
    const relevant = selected.filter(line => line.trim() || first === last);
    const remove = relevant.length > 0 && relevant.every(line => { const m = match(line); return !!m[2] && (/\d/.test(m[2]) ? "ordered" : "unordered") === kind; });
    const counters = new Map<number, number>();
    for (let i = first; i <= last; i++) {
      const line = lines[i]; if (!line.trim() && first !== last) continue;
      const m = match(line), indent = m[1].length, at = offset(lines, { line: i, col: indent });
      for (const depth of counters.keys()) if (depth > indent) counters.delete(depth);
      const n = (counters.get(indent) || 0) + 1; counters.set(indent, n);
      edits.push({ start: at, end: at + (m[2]?.length || 0) + (m[3]?.length || 0), text: remove ? "" : kind === "ordered" ? `${n}. ` : "- " });
    }
    return edit(target, edits);
  }
  function inspect(paneId: string) {
    templateVersion();
    const target = capture(paneId), { engine } = source(paneId), lines = engine.getText().split("\n"), { first, last } = lineRange(target.range);
    const [a, b] = ordered(target.range);
    const states = lines.slice(first, last + 1).map((line, n) => {
      const i = first + n, from = i === a.line ? a.col : 0, to = i === b.line ? b.col : line.length;
      const parsed = spans(line);
      const active = (kind: string): boolean | "mixed" => {
        if (parsed.some(s => s.kind === kind && ((from >= s.start + s.marker && to <= s.end - s.marker) || (from === s.start && to === s.end)))) return true;
        return parsed.some(s => s.kind === kind && from < s.end - s.marker && to > s.start + s.marker) ? "mixed" : false;
      };
      return { heading: line.match(/^ {0,3}(#{1,6})(?:\s|$)/)?.[1].length || 0, bold: active("strong"), italic: active("em"), list: /^\s*\d+[.)]\s/.test(line) ? "ordered" : /^\s*[-+*]\s/.test(line) ? "unordered" : "none" };
    });
    const state = <K extends keyof typeof states[number]>(key: K): typeof states[number][K] | "mixed" => states.every(s => s[key] === states[0][key]) ? states[0][key] : "mixed";
    const pending = templates.get(target.tabId);
    const templateKind = pending && pending.engine === engine && pending.revision === target.revision && same(a, b) && same(a, pending.caret) ? pending.kind : undefined;
    return { target, heading: state("heading"), bold: templateKind === "strong" || state("bold"), italic: templateKind === "em" || state("italic"), list: state("list") };
  }
  return { capture, inspect, heading, bold: (target: FormatTarget) => emphasis(target, "strong"), italic: (target: FormatTarget) => emphasis(target, "em"), list };
}
export type WritingFormatting = ReturnType<typeof createWritingFormatting>;

export function registerWritingFormattingCommands(commands: FeatureCommands, service: WritingFormatting) {
  const str: CommandSchema = { type: "string" }, num: CommandSchema = { type: "number" };
  const obj = (properties: Record<string, CommandSchema>): CommandSchema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
  const pos = obj({ line: num, col: num });
  const target = obj({ paneId: str, tabId: str, revision: num, range: obj({ anchor: pos, head: pos }), text: str });
  const exampleTarget: FormatTarget = { paneId: "pane-id", tabId: "note-id", revision: 0, range: { anchor: { line: 0, col: 0 }, head: { line: 0, col: 5 } }, text: "Hello" };
  const examples: Record<string, object[]> = {
    "format inspect": [{ paneId: "pane-id" }],
    "format heading": [{ target: exampleTarget, level: 2 }, { target: exampleTarget, level: 0 }],
    "format bold": [{ target: exampleTarget }],
    "format italic": [{ target: exampleTarget }, { target: { ...exampleTarget, range: { anchor: { line: 0, col: 5 }, head: { line: 0, col: 5 } }, text: "" } }],
    "format list": [{ target: exampleTarget, kind: "unordered" }, { target: exampleTarget, kind: "ordered" }],
  };
  const add = (name: string, description: string, inputSchema: CommandSchema, run: (args: any) => unknown, effect: "read" | "write" = "write") => commands.register({ name, description, inputSchema, outputSchema: { type: "object" }, run, effect, version: 1, examples: examples[name].map(args => `${name} ${JSON.stringify(args)}`) });
  add("format inspect", "Capture a Markdown note's stable target, including a collapsed caret, and current/mixed formatting states.", obj({ paneId: str }), a => service.inspect(a.paneId), "read");
  add("format heading", "Set current/selected prose lines to paragraph (0) or heading H1–H6. Requires the unchanged inspected target; one undo.", obj({ target, level: num }), a => service.heading(a.target, a.level));
  add("format bold", "Toggle complete strong emphasis or wrap selected plain text; a collapsed caret inserts paired markers. Complex Markdown returns a readable error.", obj({ target }), a => service.bold(a.target));
  add("format italic", "Toggle complete emphasis or wrap selected plain text; a collapsed caret inserts paired markers. Preserves line breaks and trailing spaces.", obj({ target }), a => service.italic(a.target));
  add("format list", "Toggle ordered/unordered lists across selected lines, preserving indentation and empty lines. Conversion renumbers from 1 per indentation depth.", obj({ target, kind: { type: "string", enum: ["unordered", "ordered"] } }), a => service.list(a.target, a.kind));
}
