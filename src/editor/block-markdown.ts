import { Fragment, Schema, type Node as DocNode } from "prosemirror-model";
import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownParser, MarkdownSerializer, schema as commonmarkSchema, type MarkdownSerializerState } from "prosemirror-markdown";
import { diffChars } from "diff";
import type { Pos } from "./engine";

// Keep raw HTML inert and lossless; never inject note HTML into the application.
export const blockSchema = new Schema({
  nodes: commonmarkSchema.spec.nodes.append({
    raw_block: { group: "block", atom: true, attrs: { source: { default: "" } },
      toDOM: node => ["pre", { class: "block-raw", "aria-label": "Embedded Markdown content" }, node.attrs.source] },
    raw_inline: { inline: true, group: "inline", atom: true, attrs: { source: { default: "" } },
      toDOM: node => ["span", { class: "block-raw" }, node.attrs.source] },
  }),
  marks: commonmarkSchema.spec.marks,
});
const tokenizer = defaultMarkdownParser.tokenizer;
// The parser is private to this module; clone the tokenizer's constructor.
const MarkdownIt = tokenizer.constructor as new (preset: string, options: object) => typeof tokenizer;
const markdown = new MarkdownIt("commonmark", { html: true });
markdown.core.ruler.after("block", "empty_paragraph", state => {
  for (const token of state.tokens) {
    if (token.type === "html_block" && token.content.trim() === "<p></p>") token.type = "empty_paragraph";
  }
});
export const blockParser = new MarkdownParser(blockSchema, markdown, {
  ...defaultMarkdownParser.tokens,
  html_block: { node: "raw_block", getAttrs: token => ({ source: token.content.replace(/\n$/, "") }) },
  html_inline: { node: "raw_inline", getAttrs: token => ({ source: token.content }) },
  empty_paragraph: { node: "paragraph" },
});

export function parseBlocks(source: string): DocNode {
  return blockParser.parse(source);
}

// ProseMirror's serializer intentionally omits its output buffer from its public
// type. Reading it here lets us map rendered caret positions to Markdown offsets
// without placing sentinel characters into the user's content.
type OutputState = MarkdownSerializerState & { out: string; atBlockStart: boolean; inAutolink?: boolean };
export interface BlockSourceMap { text: string; offsets: Map<number, number>; ends: Map<number, number> }
export function serializeBlocks(doc: DocNode): BlockSourceMap {
  const offsets = new Map<number, number>();
  const ends = new Map<number, number>();
  let current = -1;
  function text(state: MarkdownSerializerState, value: string, pos: number, escape: boolean) {
    const output = state as OutputState;
    const lines = value.split("\n");
    let consumed = 0;
    for (let i = 0; i < lines.length; i++) {
      state.write();
      const start = output.out.length;
      const escaped = escape ? state.esc(lines[i], output.atBlockStart) : lines[i];
      let at = 0;
      for (let n = 0; n < lines[i].length; n++) {
        if (escaped[at] === "\\" && escaped[at + 1] === lines[i][n] && escaped.length - at > lines[i].length - n) at++;
        offsets.set(pos + consumed + n, start + at);
        at++;
        ends.set(pos + consumed + n + 1, start + at);
      }
      offsets.set(pos + consumed + lines[i].length, start + escaped.length);
      output.out += escaped;
      consumed += lines[i].length;
      if (i < lines.length - 1) { output.out += "\n"; consumed++; }
    }
  }
  const nodes: typeof defaultMarkdownSerializer.nodes = {
    ...defaultMarkdownSerializer.nodes,
    paragraph(state, node) {
      if (!node.content.size) {
        state.write(); offsets.set(current + 1, (state as OutputState).out.length);
        state.write("<p></p>"); state.closeBlock(node);
      } else defaultMarkdownSerializer.nodes.paragraph(state, node, node, 0);
    },
    text(state, node, parent, index) {
      const original = parent.child(index).text!;
      const trimmed = original.indexOf(node.text!);
      text(state, node.text!, current + Math.max(0, trimmed), !node.marks.some(m => m.type.name === "code") && !(state as OutputState).inAutolink);
    },
    code_block(state, node) {
      const fence = "`".repeat(Math.max(3, ...Array.from(node.textContent.matchAll(/`+/g), m => m[0].length + 1)));
      state.write(fence + (node.attrs.params || "") + "\n");
      text(state, node.textContent, current + 1, false);
      state.write("\n" + fence); state.closeBlock(node);
    },
    raw_block(state, node) { state.write(node.attrs.source); state.closeBlock(node); },
    raw_inline(state, node) { state.write(node.attrs.source); },
  };
  const wrapped: typeof nodes = {};
  for (const [name, render] of Object.entries(nodes)) {
    wrapped[name] = (state, node, parent, index) => {
      const previous = current;
      // A block serializer renders descendants synchronously. Parent positions
      // are kept on this stack, so even reused immutable nodes map correctly.
      let offset = 0;
      for (let i = 0; i < index; i++) offset += parent.child(i).nodeSize;
      current = previous + 1 + offset;
      state.write();
      if (node.isLeaf && !node.isText) offsets.set(current, (state as OutputState).out.length);
      render(state, node, parent, index);
      current = previous;
    };
  }
  const serializer = new MarkdownSerializer(wrapped, {
    ...defaultMarkdownSerializer.marks,
    // Route code text through the mapped text renderer, with escaping disabled
    // there, rather than the default serializer's inline-code fast path.
    code: { ...defaultMarkdownSerializer.marks.code, escape: true },
  });
  const value = serializer.serialize(doc);
  return { text: value, offsets, ends };
}

/** Translate canonical offsets to the original source without changing a file on open. */
export function sourceOffsets(canonical: string, original: string): number[] {
  const result: number[] = [];
  let a = 0, b = 0;
  for (const part of diffChars(canonical, original)) {
    if (part.added) { b += part.value.length; result[a] = b; }
    else if (part.removed) { for (let i = 0; i < part.value.length; i++) result[a++] = b; }
    else { for (let i = 0; i < part.value.length; i++) result[a++] = b++; }
  }
  result[a] = b;
  return result;
}
export function mapToSource(map: BlockSourceMap, source: string): BlockSourceMap {
  if (map.text === source) return map;
  const translation = sourceOffsets(map.text, source);
  const translate = (points: Map<number, number>) => new Map([...points].map(([pos, offset]) => [pos, translation[offset] ?? source.length]));
  return { text: source, offsets: translate(map.offsets), ends: translate(map.ends) };
}
export function sourceOffset(map: BlockSourceMap, pos: number, bias = 1): number {
  if (bias < 0 && map.ends.has(pos)) return map.ends.get(pos)!;
  if (map.offsets.has(pos)) return map.offsets.get(pos)!;
  let nearest = 0, distance = Infinity;
  for (const [point, offset] of map.offsets) if (Math.abs(point - pos) < distance) { distance = Math.abs(point - pos); nearest = offset; }
  return nearest;
}
export function blockPosition(map: BlockSourceMap, offset: number): number {
  let nearest = 1, distance = Infinity;
  for (const [point, value] of map.offsets) if (Math.abs(value - offset) < distance) { distance = Math.abs(value - offset); nearest = point; }
  return nearest;
}
export function sourcePosition(text: string, offset: number): Pos {
  const lines = text.slice(0, Math.max(0, offset)).split("\n");
  return { line: lines.length - 1, col: lines[lines.length - 1].length };
}
export function positionOffset(text: string, pos: Pos): number {
  const lines = text.split("\n");
  return lines.slice(0, pos.line).reduce((n, line) => n + line.length + 1, 0) + pos.col;
}

/** Preserve the exact Markdown for unchanged top-level blocks, including extensions. */
export function preservedSerializer(initial: DocNode, source: string) {
  const originals = new WeakMap<DocNode, string>();
  const tokens = markdown.parse(source, {});
  const ranges = tokens.filter(t => t.level === 0 && t.map && t.nesting !== -1).map(t => t.map!);
  const lines = source.split("\n");
  if (ranges.length === initial.childCount) initial.forEach((node, _, index) => {
    const from = index === 0 ? 0 : ranges[index][0];
    const to = index + 1 < ranges.length ? ranges[index + 1][0] : lines.length;
    originals.set(node, lines.slice(from, to).join("\n"));
  });
  return (doc: DocNode): BlockSourceMap => {
    const canonical = serializeBlocks(doc);
    const pieces: string[] = [];
    doc.forEach(node => {
      pieces.push(originals.get(node) ?? serializeBlocks(blockSchema.node("doc", null, Fragment.from(node))).text);
    });
    const text = pieces.map((piece, i) => i < pieces.length - 1 ? piece.replace(/\n*$/, "\n\n") : piece).join("");
    return mapToSource(canonical, text);
  };
}
