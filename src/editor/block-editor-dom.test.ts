// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import { createEditorEngine } from "./engine";
import { createBlockEditor } from "./block-editor";

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
});
const views: EditorView[] = [];
afterEach(() => { views.forEach(v => v.destroy()); views.length = 0; document.body.replaceChildren(); });
function mounted(source = "") {
  const engine = createEditorEngine(source);
  const root = document.createElement("div"); document.body.append(root);
  let view: EditorView | undefined;
  const editor = createBlockEditor(engine, state => view?.updateState(state));
  view = new EditorView(root, { state: editor.state, dispatchTransaction: tr => editor.dispatch(tr) });
  views.push(view);
  return { engine, editor, view, root };
}
function key(view: EditorView, name: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: name, ...extra });
  view.someProp("handleKeyDown", handler => handler(view, event));
}
describe("block editing DOM", () => {
  it("renders editable headings, paragraphs and lists without Markdown markers", () => {
    const f = mounted("# A heading\n\nSome **bold** and *italic*.\n\n- first\n- second");
    expect(f.view.dom.getAttribute("contenteditable")).toBe("true");
    expect(f.root.querySelector("h1")?.textContent).toBe("A heading");
    expect(f.root.querySelector("strong")?.textContent).toBe("bold");
    expect(f.root.querySelector("em")?.textContent).toBe("italic");
    expect(f.root.querySelectorAll("li")).toHaveLength(2);
    expect(f.root.textContent).not.toContain("**");
  });
  it("retains native selection across toolbar formatting and edits only that passage", () => {
    const f = mounted("One two three");
    f.view.focus();
    f.editor.dispatch(f.editor.state.tr.setSelection(TextSelection.create(f.editor.state.doc, 5, 8)));
    expect(document.getSelection()?.toString()).toBe("two");
    f.editor.format("italic");
    expect(document.getSelection()?.toString()).toBe("two");
    f.view.dispatch(f.view.state.tr.insertText("new"));
    expect(f.engine.getText()).toBe("One *new* three");
    expect(f.root.querySelector("em")?.textContent).toBe("new");
  });
  it("creates and exits list items with Enter, and handles undo/redo", () => {
    const f = mounted("- first");
    f.view.dispatch(f.view.state.tr.setSelection(TextSelection.atEnd(f.view.state.doc)));
    key(f.view, "Enter");
    expect(f.view.state.doc.firstChild?.childCount).toBe(2);
    f.view.dispatch(f.view.state.tr.insertText("second"));
    expect(f.engine.getText()).toContain("second");
    key(f.view, "Enter"); key(f.view, "Enter");
    expect(f.view.state.doc.lastChild?.type.name).toBe("paragraph");
    key(f.view, "z", { ctrlKey: true });
    key(f.view, "z", { ctrlKey: true, shiftKey: true });
    expect(f.view.state.doc.lastChild?.type.name).toBe("paragraph");
  });
  it("pastes rich text using schema nodes and saves Markdown", () => {
    const f = mounted();
    f.view.pasteHTML("<h2>Title</h2><p>Some <strong>bold</strong> writing.</p>", new Event("paste") as ClipboardEvent);
    expect(f.engine.getText()).toContain("## Title");
    expect(f.engine.getText()).toContain("**bold**");
    expect(f.engine.getText()).not.toContain("<strong>");
  });
  it("keeps notes independent when multiple panes are open", () => {
    const a = mounted("First"), b = mounted("Second");
    a.view.dispatch(a.view.state.tr.insertText("!"));
    expect(a.engine.getText()).toBe("!First");
    expect(b.engine.getText()).toBe("Second");
    expect(b.root.textContent).toBe("Second");
  });
});
