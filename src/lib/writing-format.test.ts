import { describe, expect, it } from "vitest";
import { createEditorEngine, type Selection } from "../editor/engine";
import { createWritingFormatting, registerWritingFormattingCommands } from "./writing-format";
import { FeatureCommands } from "./feature-commands";
import { newPaneWorkspace, showTabInPane, splitWritingPane } from "./writing-panes";

function fixture(text: string, range?: Selection) {
  const engine = createEditorEngine(text);
  if (range) engine.setSelection(range.anchor, range.head);
  let workspace = newPaneWorkspace("note");
  const paneId = workspace.activePaneId;
  const service = createWritingFormatting({ workspace: () => workspace, tabs: () => [{ id: "note", name: "Untitled.md", path: "", type: "file", dirty: false }, { id: "other", name: "other.md", path: "", type: "file", dirty: false }], engine: id => id === "note" ? engine : undefined });
  const commands = new FeatureCommands(); registerWritingFormattingCommands(commands, service);
  return { engine, service, paneId, target: () => service.capture(paneId), commands,
    swap: () => { workspace = showTabInPane(workspace, "other"); },
    focusElsewhere: () => { workspace = splitWritingPane(workspace, "right"); } };
}
const range = (a: number, b: number, aLine = 0, bLine = aLine): Selection => ({ anchor: { line: aLine, col: a }, head: { line: bLine, col: b } });

describe("writing formatting", () => {
  it("wraps a reversed Unicode selection and restores it with one undo, separately from later typing", () => {
    const f = fixture("A café 世界 passage", range(9, 2));
    f.service.bold(f.target());
    expect(f.engine.getText()).toBe("A **café 世界** passage");
    expect(f.engine.sel()).toEqual(range(11, 4));
    f.engine.insert("new"); f.engine.undo();
    expect(f.engine.getText()).toBe("A **café 世界** passage");
    f.engine.undo(); expect(f.engine.getText()).toBe("A café 世界 passage");
    expect(f.engine.sel()).toEqual(range(9, 2));
    f.engine.redo(); expect(f.engine.getText()).toBe("A **café 世界** passage");
  });
  it("inserts paired markers at an empty caret with the caret inside", () => {
    const f = fixture("hello"); f.engine.setCursor({ line: 0, col: 5 });
    f.service.bold(f.target()); expect(f.engine.getText()).toBe("hello****");
    expect(f.engine.cursor()).toEqual({ line: 0, col: 7 });
    f.engine.insert("world"); expect(f.engine.getText()).toBe("hello**world**");
    f.engine.undo(); expect(f.engine.getText()).toBe("hello****");
    f.engine.undo(); expect(f.engine.getText()).toBe("hello");
    const g = fixture(""); g.service.italic(g.target()); expect(g.engine.getText()).toBe("**"); expect(g.engine.cursor().col).toBe(1);
  });
  it("toggles complete emphasis, underscore syntax, markers-inclusive selections, and a caret inside", () => {
    for (const text of ["**word**", "__word__"]) for (const selected of [range(2, 6), range(0, 8)]) {
      const f = fixture(text, selected); expect(f.service.inspect(f.paneId).bold).toBe(true);
      f.service.bold(f.target()); expect(f.engine.getText()).toBe("word"); expect(f.engine.sel()).toEqual(range(0, 4));
    }
    const f = fixture("*word*"); f.engine.setCursor({ line: 0, col: 3 }); f.service.italic(f.target());
    expect(f.engine.getText()).toBe("word"); expect(f.engine.cursor().col).toBe(2);
  });
  it("supports nested bold/italic without double wrapping, rejecting partial emphasis", () => {
    const f = fixture("*word*", range(1, 5)); f.service.bold(f.target());
    expect(f.engine.getText()).toBe("***word***");
    expect(f.service.inspect(f.paneId)).toMatchObject({ bold: true, italic: true });
    f.service.bold(f.target()); expect(f.engine.getText()).toBe("*word*");
    const g = fixture("**word**", range(3, 5)); expect(() => g.service.bold(g.target())).toThrow(/complete/); expect(g.engine.getText()).toBe("**word**");
    const h = fixture("a **word** b", range(0, 7)); expect(() => h.service.italic(h.target())).toThrow(/overlapping/);
  });
  it("formats multiline prose independently, preserving blank lines and Markdown hard breaks", () => {
    const f = fixture("one  \n\n two\\\nthree", range(0, 5, 0, 2));
    f.service.bold(f.target()); expect(f.engine.getText()).toBe("**one**  \n\n **two**\\\nthree");
    const g = fixture("one  \n\n two  \nlast", range(0, 0, 0, 3));
    g.service.italic(g.target()); expect(g.engine.getText()).toBe("*one*  \n\n *two*  \nlast");
    g.engine.undo(); expect(g.engine.getText()).toBe("one  \n\n two  \nlast");
  });
  it("changes selected headings, excludes the end-at-column-zero line, and removes closing heading syntax", () => {
    const f = fixture("# one ###\n## two\nlast", range(0, 0, 0, 2));
    expect(f.service.inspect(f.paneId).heading).toBe("mixed");
    f.service.heading(f.target(), 3); expect(f.engine.getText()).toBe("### one\n### two\nlast");
    f.service.heading(f.target(), 0); expect(f.engine.getText()).toBe("one\ntwo\nlast");
    const g = fixture(""); g.service.heading(g.target(), 6); expect(g.engine.getText()).toBe("###### "); expect(g.engine.cursor().col).toBe(7);
  });
  it("converts list kinds with stable nested indentation and fresh numbering per depth", () => {
    const f = fixture("- top\n  * child\n  - child two\n- second\n\n- third", range(0, 7, 0, 5));
    f.service.list(f.target(), "ordered");
    expect(f.engine.getText()).toBe("1. top\n  1. child\n  2. child two\n2. second\n\n3. third");
    f.service.list(f.target(), "unordered"); expect(f.engine.getText()).toBe("- top\n  - child\n  - child two\n- second\n\n- third");
    f.service.list(f.target(), "unordered"); expect(f.engine.getText()).toBe("top\n  child\n  child two\nsecond\n\nthird");
    f.engine.undo(); expect(f.engine.getText()).toBe("- top\n  - child\n  - child two\n- second\n\n- third");
  });
  it("toggles ordered numbering and handles an empty current line", () => {
    const f = fixture("8) first\n19. second", range(0, 10, 0, 1));
    f.service.list(f.target(), "ordered"); expect(f.engine.getText()).toBe("first\nsecond");
    const g = fixture(""); g.service.list(g.target(), "ordered"); expect(g.engine.getText()).toBe("1. "); expect(g.engine.cursor().col).toBe(3);
  });
  it("preserves escaped literal stars, refuses split escapes and unmatched boundary delimiters", () => {
    const f = fixture("literal \\*star\\*", range(0, 16)); f.service.bold(f.target()); expect(f.engine.getText()).toBe("**literal \\*star\\***");
    const g = fixture("\\*word", range(1, 6)); expect(() => g.service.bold(g.target())).toThrow(); expect(g.engine.getText()).toBe("\\*word");
    const h = fixture("*word", range(1, 5)); expect(() => h.service.bold(h.target())).toThrow(/unmatched/);
  });
  it("rejects code spans, fenced blocks, setext, list continuation, links, and quotes without mutation", () => {
    for (const [text, selected] of [
      ["`word`", range(1, 5)], ["~~~js\nword\n~~~", range(0, 4, 1)], ["```\nword\n```", range(0, 4, 1)],
      ["title\n-----", range(0, 5)], ["    code", range(4, 8)], ["[word](url)", range(1, 5)], ["> quote", range(2, 7)],
      ["`one\ntwo`", range(0, 3, 1)],
    ] as [string, Selection][]) {
      const f = fixture(text, selected); expect(() => f.service.bold(f.target())).toThrow(); expect(f.engine.getText()).toBe(text); expect(f.engine.editSeq()).toBe(0);
    }
    const f = fixture("~~~\ncode\n~~~\nprose", range(0, 5, 3)); f.service.bold(f.target()); expect(f.engine.getLine(3)).toBe("**prose**");
  });
  it("guards stable document, selection and revision while allowing focus to move elsewhere", () => {
    const f = fixture("hello", range(0, 5)), target = f.target(); f.focusElsewhere(); f.service.bold(target); expect(f.engine.getText()).toBe("**hello**");
    for (const change of ["edit", "selection", "pane"]) {
      const g = fixture("hello", range(0, 5)), captured = g.target();
      if (change === "edit") g.engine.insert("different"); else if (change === "selection") g.engine.clearSelection(); else g.swap();
      const before = g.engine.getText(); expect(() => g.service.bold(captured)).toThrow(); expect(g.engine.getText()).toBe(before);
    }
  });
  it("uses command schemas, idempotency and readable stale errors", async () => {
    const f = fixture("hello", range(0, 5)), target = f.target();
    const request = { command: "format bold", args: { target }, requestId: "same" };
    expect(await f.commands.dispatch(request, "ai")).toMatchObject({ ok: true });
    expect(await f.commands.dispatch(request, "ai")).toMatchObject({ ok: true }); expect(f.engine.getText()).toBe("**hello**");
    expect(await f.commands.dispatch({ ...request, requestId: "new" }, "ai")).toMatchObject({ ok: false, error: { code: "STALE_FORMAT_TARGET" } });
    expect(await f.commands.dispatch({ command: "format heading", args: { target: f.target(), level: 7 }, requestId: "heading" }, "ai")).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
  });
  it("reports mixed selection state and refuses multi-cursor editing", () => {
    const g = fixture("plain **bold** tail", range(0, 19)); expect(g.service.inspect(g.paneId).bold).toBe("mixed");
    const f = fixture("**one**\ntwo", range(0, 3, 0, 1)); expect(f.service.inspect(f.paneId).bold).toBe("mixed");
    const target = f.target(); f.engine.addCursor({ line: 0, col: 0 }); expect(() => f.service.bold(target)).toThrow(/one cursor/);
  });
  it("keeps heading and list structure outside emphasis for complete selected lines", () => {
    const f = fixture("## heading ##\n- item\n  8. nested", range(0, 11, 0, 2));
    f.service.bold(f.target()); expect(f.engine.getText()).toBe("## **heading** ##\n- **item**\n  8. **nested**");
    const g = fixture("**word**"); expect(() => g.service.bold(g.target())).toThrow(/caret/);
  });
  it("toggles newly inserted empty markers while protecting indistinguishable literal rules", () => {
    for (const style of ["bold", "italic"] as const) {
      const f = fixture("");
      f.service[style](f.target()); expect(f.service.inspect(f.paneId)[style]).toBe(true);
      f.service[style](f.target()); expect(f.engine.getText()).toBe(""); expect(f.engine.cursor().col).toBe(0);
      f.engine.undo(); expect(f.engine.getText()).toBe(style === "bold" ? "****" : "**");
      f.engine.undo(); expect(f.engine.getText()).toBe("");
    }
    const g = fixture("****"); g.engine.setCursor({ line: 0, col: 2 });
    expect(() => g.service.bold(g.target())).toThrow(); expect(g.engine.getText()).toBe("****");
    const h = fixture(""); h.service.bold(h.target()); h.engine.insert(" ");
    expect(() => h.service.bold(h.target())).toThrow(); expect(h.engine.getText()).toBe("** **");
  });
});
