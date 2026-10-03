import { describe, expect, it } from "vitest";
import { TextSelection } from "prosemirror-state";
import { createEditorEngine } from "./engine";
import { createBlockEditor } from "./block-editor";
import { blockPosition, parseBlocks, serializeBlocks, sourceOffset } from "./block-markdown";
import { createWritingFormatting } from "../lib/writing-format";

function fixture(text = "") {
  const engine = createEditorEngine(text);
  const editor = createBlockEditor(engine);
  return { engine, editor, select: (from: number, to = from) => editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to))) };
}
describe("editable Markdown blocks", () => {
  it("undoes paragraph formatting in a restored draft without adding blocks or changing source", () => {
    const source = "# Hidden draft\n\nUnsaved writing survives the pane migration.\n";
    const engine = createEditorEngine(source);
    engine.setCursor({ line: 0, col: 4 });
    const editor = createBlockEditor(engine);
    const from = editor.state.doc.firstChild!.nodeSize + 1;
    editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, from + editor.state.doc.lastChild!.content.size)));
    const formatting = createWritingFormatting({ tabs: () => [{ id: "note", name: "Note.md", path: "", dirty: true, type: "file" }], engine: () => engine });
    formatting.bold(formatting.capture("note"));
    expect(engine.getText()).toBe("# Hidden draft\n\n**Unsaved writing survives the pane migration.**");
    engine.undo(); editor.sync();
    expect(engine.getText()).toBe(source);
    expect(editor.state.doc.childCount).toBe(2);
  });
  it("opens formatted Markdown without changing the file or marking it dirty", () => {
    const source = "Title\n=====\n\nA __bold__ word.\n";
    const { engine, editor } = fixture(source);
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.textContent).toBe("TitleA bold word.");
    expect(engine.getText()).toBe(source);
    expect(engine.dirty()).toBe(false);
  });
  it("types inside a rendered heading and saves Markdown", () => {
    const f = fixture("# Hello\n\nNext paragraph.");
    f.select(6);
    f.editor.dispatch(f.editor.state.tr.insertText(" there"));
    expect(f.engine.getText()).toBe("# Hello there\n\nNext paragraph.");
    expect(f.engine.cursor()).toEqual({ line: 0, col: 13 });
    expect(f.editor.state.doc.firstChild?.textContent).toBe("Hello there");
  });
  it("formats a visual selection and keeps it selected, with one-step undo", () => {
    const f = fixture("Hello world");
    f.select(1, 6);
    f.editor.format("bold");
    expect(f.engine.getText()).toBe("**Hello** world");
    expect(f.engine.getTextRange(f.engine.sel()!.anchor, f.engine.sel()!.head)).toBe("Hello");
    f.engine.undo(); f.editor.sync();
    expect(f.engine.getText()).toBe("Hello world");
    expect(f.editor.state.doc.textContent).toBe("Hello world");
    f.engine.redo(); f.editor.sync();
    expect(f.engine.getText()).toBe("**Hello** world");
  });
  it("uses stored marks at a caret without showing paired Markdown delimiters", () => {
    const f = fixture();
    f.editor.format("bold");
    expect(f.engine.getText()).toBe("");
    expect(f.editor.inspect().bold).toBe(true);
    f.editor.dispatch(f.editor.state.tr.insertText("Bold writing"));
    expect(f.engine.getText()).toBe("**Bold writing**");
    expect(f.editor.state.doc.textContent).toBe("Bold writing");
  });
  it("continues through the existing formatting service", () => {
    const f = fixture("Hello world");
    const formatting = createWritingFormatting({
      tabs: () => [{ id: "note", name: "Note.md", path: "", dirty: false, type: "file" }], engine: () => f.engine });
    f.select(1, 6);
    formatting.bold(formatting.capture("note"));
    formatting.heading(formatting.capture("note"), 2);
    expect(f.engine.getText()).toBe("## **Hello** world");
    expect(formatting.inspect("note")).toMatchObject({ bold: true, heading: 2 });
  });
  it("synchronizes external Markdown edits and cursor movement", () => {
    const f = fixture("Hello");
    f.engine.setCursor({ line: 0, col: 5 }); f.engine.insert(" **world**"); f.editor.sync();
    expect(f.editor.state.doc.textContent).toBe("Hello world");
    f.engine.setSelection({ line: 0, col: 8 }, { line: 0, col: 13 }); f.editor.sync();
    expect(f.editor.state.doc.textBetween(f.editor.state.selection.from, f.editor.state.selection.to)).toBe("world");
  });
  it("retains blank writing blocks across save/reopen and undo", () => {
    const f = fixture("Hello");
    f.select(6); f.editor.dispatch(f.editor.state.tr.split(6));
    expect(f.editor.state.doc.childCount).toBe(2);
    expect(parseBlocks(f.engine.getText()).childCount).toBe(2);
    f.engine.undo(); f.editor.sync();
    expect(f.editor.state.doc.childCount).toBe(1);
  });
  it("round-trips lists, links, emphasis, quotes, code, images and literal punctuation", () => {
    for (const source of ["- one\n- two", "1. one\n2. two", "> A **quote**", "A [link](https://example.com) and `a*b`", "```js\nconst a = 2;\n```", "![alt](image.png)", "Literal \\*stars\\* and snake_case", "**bold *italic***", "A\nsoft line"]) {
      const doc = parseBlocks(source), map = serializeBlocks(doc);
      expect(parseBlocks(map.text).eq(doc), map.text).toBe(true);
      doc.descendants((node, pos) => { if (node.isText) {
        for (let i = 0; i < node.text!.length; i++) {
          const offset = sourceOffset(map, pos + i);
          expect(map.text[offset], `${source}: ${pos + i}`).toBe(node.text![i]);
          expect(blockPosition(map, offset)).toBe(pos + i);
        }
      } });
    }
  });
  it("keeps raw HTML inert and preserves it when neighboring prose is edited", () => {
    const source = "Hello\n\n<script>alert('x')</script>\n";
    const f = fixture(source);
    expect(f.editor.state.doc.lastChild?.type.name).toBe("raw_block");
    f.select(6); f.editor.dispatch(f.editor.state.tr.insertText("!"));
    expect(f.engine.getText()).toContain("<script>alert('x')</script>");
  });
});
