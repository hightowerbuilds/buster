import { describe, it, expect } from "vitest";
import { createEditorEngine, computeDisplayRows } from "./engine";

// ── 1. Insert operations ─────────────────────────────────────────────

describe("insert", () => {
  it("inserts a single character at cursor", () => {
    const e = createEditorEngine("");
    e.insert("a");
    expect(e.getText()).toBe("a");
    expect(e.cursor()).toEqual({ line: 0, col: 1 });
  });

  it("inserts at the middle of a line", () => {
    const e = createEditorEngine("ac");
    e.setCursor({ line: 0, col: 1 });
    e.insert("b");
    expect(e.getText()).toBe("abc");
    expect(e.cursor()).toEqual({ line: 0, col: 2 });
  });

  it("inserts a newline and splits the line", () => {
    const e = createEditorEngine("ab");
    e.setCursor({ line: 0, col: 1 });
    e.insert("\n");
    expect(e.lines()).toEqual(["a", "b"]);
    expect(e.cursor()).toEqual({ line: 1, col: 0 });
  });

  it("inserts multi-line text", () => {
    const e = createEditorEngine("ad");
    e.setCursor({ line: 0, col: 1 });
    e.insert("b\nc");
    expect(e.lines()).toEqual(["ab", "cd"]);
    expect(e.cursor()).toEqual({ line: 1, col: 1 });
  });

  it("inserts replacing a selection", () => {
    const e = createEditorEngine("hello world");
    e.setSelection({ line: 0, col: 0 }, { line: 0, col: 5 });
    e.insert("hi");
    expect(e.getText()).toBe("hi world");
    expect(e.cursor()).toEqual({ line: 0, col: 2 });
    expect(e.sel()).toBeNull();
  });

  it("inserts at end of document", () => {
    const e = createEditorEngine("abc");
    e.setCursor({ line: 0, col: 3 });
    e.insert("d");
    expect(e.getText()).toBe("abcd");
  });
});

// ── 2. Backspace operations ──────────────────────────────────────────

describe("backspace", () => {
  it("deletes the character before cursor", () => {
    const e = createEditorEngine("abc");
    e.setCursor({ line: 0, col: 2 });
    e.backspace();
    expect(e.getText()).toBe("ac");
    expect(e.cursor()).toEqual({ line: 0, col: 1 });
  });

  it("merges with previous line at column 0", () => {
    const e = createEditorEngine("ab\ncd");
    e.setCursor({ line: 1, col: 0 });
    e.backspace();
    expect(e.lines()).toEqual(["abcd"]);
    expect(e.cursor()).toEqual({ line: 0, col: 2 });
  });

  it("does nothing at document start", () => {
    const e = createEditorEngine("abc");
    e.setCursor({ line: 0, col: 0 });
    e.backspace();
    expect(e.getText()).toBe("abc");
    expect(e.cursor()).toEqual({ line: 0, col: 0 });
  });

  it("deletes a selection", () => {
    const e = createEditorEngine("abcdef");
    e.setSelection({ line: 0, col: 1 }, { line: 0, col: 4 });
    e.backspace();
    expect(e.getText()).toBe("aef");
    expect(e.cursor()).toEqual({ line: 0, col: 1 });
  });
});

// ── 3. Delete forward ────────────────────────────────────────────────

describe("deleteForward", () => {
  it("deletes the character after cursor", () => {
    const e = createEditorEngine("abc");
    e.setCursor({ line: 0, col: 1 });
    e.deleteForward();
    expect(e.getText()).toBe("ac");
    expect(e.cursor()).toEqual({ line: 0, col: 1 });
  });

  it("merges with next line at end of line", () => {
    const e = createEditorEngine("ab\ncd");
    e.setCursor({ line: 0, col: 2 });
    e.deleteForward();
    expect(e.lines()).toEqual(["abcd"]);
  });

  it("does nothing at document end", () => {
    const e = createEditorEngine("abc");
    e.setCursor({ line: 0, col: 3 });
    e.deleteForward();
    expect(e.getText()).toBe("abc");
  });

  it("deletes a multi-line selection", () => {
    const e = createEditorEngine("line1\nline2\nline3");
    e.setSelection({ line: 0, col: 3 }, { line: 1, col: 3 });
    e.deleteForward();
    expect(e.getText()).toBe("line2\nline3");
  });
});

// ── 4. Multi-line operations ─────────────────────────────────────────

describe("multi-line operations", () => {
  it("inserts newline at start of line", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 0 });
    e.insert("\n");
    expect(e.lines()).toEqual(["", "hello"]);
    expect(e.cursor()).toEqual({ line: 1, col: 0 });
  });

  it("inserts newline at end of line", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 5 });
    e.insert("\n");
    expect(e.lines()).toEqual(["hello", ""]);
    expect(e.cursor()).toEqual({ line: 1, col: 0 });
  });

  it("deleteRange across multiple lines", () => {
    const e = createEditorEngine("aaa\nbbb\nccc");
    e.deleteRange({ line: 0, col: 1 }, { line: 2, col: 1 });
    expect(e.getText()).toBe("acc");
    expect(e.cursor()).toEqual({ line: 0, col: 1 });
  });

  it("selectAll then insert replaces entire document", () => {
    const e = createEditorEngine("line1\nline2\nline3");
    e.selectAll();
    e.insert("replaced");
    expect(e.getText()).toBe("replaced");
    expect(e.cursor()).toEqual({ line: 0, col: 8 });
  });

  it("getTextRange extracts across lines", () => {
    const e = createEditorEngine("aaa\nbbb\nccc");
    const text = e.getTextRange({ line: 0, col: 1 }, { line: 2, col: 2 });
    expect(text).toBe("aa\nbbb\ncc");
  });

  it("getTextRange within a single line", () => {
    const e = createEditorEngine("hello world");
    const text = e.getTextRange({ line: 0, col: 0 }, { line: 0, col: 5 });
    expect(text).toBe("hello");
  });
});

// ── 5. Selection ─────────────────────────────────────────────────────

describe("selection", () => {
  it("setSelection stores anchor and head", () => {
    const e = createEditorEngine("hello world");
    e.setSelection({ line: 0, col: 2 }, { line: 0, col: 7 });
    expect(e.sel()).toEqual({
      anchor: { line: 0, col: 2 },
      head: { line: 0, col: 7 },
    });
    expect(e.cursor()).toEqual({ line: 0, col: 7 });
  });

  it("clearSelection removes selection", () => {
    const e = createEditorEngine("hello");
    e.setSelection({ line: 0, col: 0 }, { line: 0, col: 5 });
    e.clearSelection();
    expect(e.sel()).toBeNull();
  });

  it("getOrderedSelection normalizes reversed selection", () => {
    const e = createEditorEngine("hello world");
    e.setSelection({ line: 0, col: 7 }, { line: 0, col: 2 });
    const ord = e.getOrderedSelection();
    expect(ord).toEqual({
      from: { line: 0, col: 2 },
      to: { line: 0, col: 7 },
    });
  });

  it("selectAll selects entire multi-line document", () => {
    const e = createEditorEngine("aa\nbb\ncc");
    e.selectAll();
    const s = e.sel();
    expect(s?.anchor).toEqual({ line: 0, col: 0 });
    expect(s?.head).toEqual({ line: 2, col: 2 });
  });

  it("getOrderedSelection returns null when no selection", () => {
    const e = createEditorEngine("hello");
    expect(e.getOrderedSelection()).toBeNull();
  });
});

// ── 6. Undo/redo ─────────────────────────────────────────────────────

describe("undo/redo", () => {
  it("undo restores previous state after insert", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 5 });
    e.insert(" world");
    expect(e.getText()).toBe("hello world");
    const undone = e.undo();
    expect(undone).toBe(true);
    expect(e.getText()).toBe("hello");
  });

  it("redo re-applies undone operation", () => {
    const e = createEditorEngine("abc");
    e.setCursor({ line: 0, col: 3 });
    e.insert("d");
    expect(e.getText()).toBe("abcd");
    e.undo();
    expect(e.getText()).toBe("abc");
    e.redo();
    expect(e.getText()).toBe("abcd");
  });

  it("undo returns false when stack is empty", () => {
    const e = createEditorEngine("hello");
    expect(e.undo()).toBe(false);
  });

  it("redo returns false when stack is empty", () => {
    const e = createEditorEngine("hello");
    expect(e.redo()).toBe(false);
  });

  it("new edit after undo clears redo stack", () => {
    const e = createEditorEngine("a");
    e.setCursor({ line: 0, col: 1 });
    e.insert("b");
    e.undo();
    e.insert("c");
    expect(e.redo()).toBe(false);
  });

  it("undo restores cursor position", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 5 });
    e.insert("!");
    expect(e.cursor()).toEqual({ line: 0, col: 6 });
    e.undo();
    expect(e.cursor()).toEqual({ line: 0, col: 5 });
  });
});

// ── 7. Multi-cursor ──────────────────────────────────────────────────

describe("multi-cursor", () => {
  it("addCursor creates extra cursors", () => {
    const e = createEditorEngine("aaa\nbbb");
    e.setCursor({ line: 0, col: 0 });
    e.addCursor({ line: 1, col: 0 });
    expect(e.hasMultiCursors()).toBe(true);
    expect(e.getCursors()).toHaveLength(2);
  });

  it("multi-cursor insert adds text at all cursors", () => {
    const e = createEditorEngine("aaa\nbbb");
    e.setCursor({ line: 0, col: 0 });
    e.addCursor({ line: 1, col: 0 });
    e.insert("X");
    expect(e.lines()).toEqual(["Xaaa", "Xbbb"]);
  });

  it("multi-cursor backspace deletes at all cursors", () => {
    const e = createEditorEngine("Xaaa\nXbbb");
    e.setCursor({ line: 0, col: 1 });
    e.addCursor({ line: 1, col: 1 });
    e.backspace();
    expect(e.lines()).toEqual(["aaa", "bbb"]);
  });

  it("clearExtras removes extra cursors", () => {
    const e = createEditorEngine("test");
    e.addCursor({ line: 0, col: 2 });
    expect(e.hasMultiCursors()).toBe(true);
    e.clearExtras();
    expect(e.hasMultiCursors()).toBe(false);
  });

  it("getCursors includes primary and extras", () => {
    const e = createEditorEngine("aaa\nbbb\nccc");
    e.setCursor({ line: 0, col: 1 });
    e.addCursor({ line: 1, col: 1 });
    e.addCursor({ line: 2, col: 1 });
    expect(e.getCursors()).toHaveLength(3);
  });

  it("addCursor deduplicates against primary", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 2 });
    e.addCursor({ line: 0, col: 2 }); // same as primary
    expect(e.hasMultiCursors()).toBe(false);
  });

  it("addCursor deduplicates against existing extras", () => {
    const e = createEditorEngine("aaa\nbbb");
    e.setCursor({ line: 0, col: 0 });
    e.addCursor({ line: 1, col: 0 });
    e.addCursor({ line: 1, col: 0 }); // duplicate
    expect(e.getCursors()).toHaveLength(2);
  });

  it("multi-cursor backspace deduplicates collapsed cursors", () => {
    // Two cursors at col 0 on adjacent lines — backspace merges lines, cursors collapse
    const e = createEditorEngine("aaa\nbbb\nccc");
    e.setCursor({ line: 1, col: 0 });
    e.addCursor({ line: 2, col: 0 });
    e.backspace();
    // After backspace: "aaabbb\nccc" with cursor at (0,3) — but second cursor was on line 2 col 0
    // which becomes line 1 col 0 after first backspace, then merges to (0,6) or similar
    // Key assertion: no duplicate cursors
    const cursors = e.getCursors();
    const keys = cursors.map(c => `${c.line}:${c.col}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("multi-cursor insert on same line adjusts positions correctly", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 1 });
    e.addCursor({ line: 0, col: 3 });
    e.insert("X");
    // Back-to-front: insert X at col 3 -> "helXlo", then X at col 1 -> "hXelXlo"
    expect(e.getText()).toBe("hXelXlo");
  });
});

// ── 8. Display rows (standalone function) ────────────────────────────

describe("computeDisplayRows (standalone)", () => {
  it("returns one row per line when wrap is off", () => {
    const rows = computeDisplayRows(["hello", "world"], 8, 800, false, 50);
    expect(rows).toEqual([
      { bufferLine: 0, startCol: 0, text: "hello" },
      { bufferLine: 1, startCol: 0, text: "world" },
    ]);
  });

  it("wraps long lines into multiple display rows", () => {
    // charW=8, editorWidth=200, gutterW=50, PADDING_LEFT=8, padding=10
    // maxChars = floor((200 - 50 - 8 - 10) / 8) = floor(132/8) = 16
    // No spaces, so hard break at 16 chars
    const longLine = "abcdefghijklmnopqrstuvwxyz"; // 26 chars > 16, no spaces
    const rows = computeDisplayRows([longLine], 8, 200, true, 50);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ bufferLine: 0, startCol: 0, text: "abcdefghijklmnop" });
    expect(rows[1]).toEqual({ bufferLine: 0, startCol: 16, text: "qrstuvwxyz" });
  });

  it("wraps at word boundary when possible", () => {
    // maxChars = 16, "hello world foo bar" = 19 chars
    // Should break after "world " (11 chars) since "world foo" doesn't fit
    const line = "hello world foo bar";
    const rows = computeDisplayRows([line], 8, 200, true, 50);
    expect(rows.length).toBe(2);
    // Break should happen at a space boundary before char 16
    expect(rows[0].text.endsWith(" ") || rows[1].text.startsWith("f")).toBe(true);
    expect(rows[0].bufferLine).toBe(0);
    expect(rows[1].bufferLine).toBe(0);
  });

  it("short lines are not wrapped", () => {
    const rows = computeDisplayRows(["hi"], 8, 800, true, 50);
    expect(rows).toEqual([{ bufferLine: 0, startCol: 0, text: "hi" }]);
  });

  it("empty document returns one empty row", () => {
    const rows = computeDisplayRows([""], 8, 800, false, 50);
    expect(rows).toEqual([{ bufferLine: 0, startCol: 0, text: "" }]);
  });

  it("multiple lines with wrap off still gives 1:1 mapping", () => {
    const rows = computeDisplayRows(["a", "b", "c"], 8, 100, false, 50);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toEqual({ bufferLine: 2, startCol: 0, text: "c" });
  });
});

// ── 9. Cursor movement edge cases ────────────────────────────────────

describe("cursor movement", () => {
  it("left at start of document stays put", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 0 });
    e.moveCursor("left");
    expect(e.cursor()).toEqual({ line: 0, col: 0 });
  });

  it("right at end of document stays put", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 5 });
    e.moveCursor("right");
    expect(e.cursor()).toEqual({ line: 0, col: 5 });
  });

  it("left at start of line wraps to end of previous line", () => {
    const e = createEditorEngine("abc\ndef");
    e.setCursor({ line: 1, col: 0 });
    e.moveCursor("left");
    expect(e.cursor()).toEqual({ line: 0, col: 3 });
  });

  it("right at end of line wraps to start of next line", () => {
    const e = createEditorEngine("abc\ndef");
    e.setCursor({ line: 0, col: 3 });
    e.moveCursor("right");
    expect(e.cursor()).toEqual({ line: 1, col: 0 });
  });

  it("up at first line stays put", () => {
    const e = createEditorEngine("abc\ndef");
    e.setCursor({ line: 0, col: 1 });
    e.moveCursor("up");
    expect(e.cursor()).toEqual({ line: 0, col: 1 });
  });

  it("down at last line stays put", () => {
    const e = createEditorEngine("abc\ndef");
    e.setCursor({ line: 1, col: 1 });
    e.moveCursor("down");
    expect(e.cursor()).toEqual({ line: 1, col: 1 });
  });

  it("up clamps col to shorter line", () => {
    const e = createEditorEngine("ab\nlong line");
    e.setCursor({ line: 1, col: 8 });
    e.moveCursor("up");
    expect(e.cursor()).toEqual({ line: 0, col: 2 });
  });

  it("down clamps col to shorter line", () => {
    const e = createEditorEngine("long line\nab");
    e.setCursor({ line: 0, col: 8 });
    e.moveCursor("down");
    expect(e.cursor()).toEqual({ line: 1, col: 2 });
  });

  it("sticky column: vertical movement remembers column across short lines", () => {
    const e = createEditorEngine("Hello World!\nHi\nHello World!");
    e.setCursor({ line: 0, col: 12 });
    e.moveCursor("down"); // clamps to col 2 on "Hi"
    expect(e.cursor()).toEqual({ line: 1, col: 2 });
    e.moveCursor("down"); // restores to col 12 on "Hello World!"
    expect(e.cursor()).toEqual({ line: 2, col: 12 });
  });

  it("sticky column: resets on horizontal movement", () => {
    const e = createEditorEngine("Hello World!\nHi\nHello World!");
    e.setCursor({ line: 0, col: 12 });
    e.moveCursor("down"); // clamps to 2, remembers 12
    expect(e.cursor()).toEqual({ line: 1, col: 2 });
    e.moveCursor("left"); // resets desiredCol
    e.moveCursor("down"); // should use col 1, not 12
    expect(e.cursor()).toEqual({ line: 2, col: 1 });
  });

  it("sticky column: resets on typing", () => {
    const e = createEditorEngine("Hello World!\nHi\nHello World!");
    e.setCursor({ line: 0, col: 12 });
    e.moveCursor("down"); // clamps to 2, remembers 12
    e.insert("x"); // resets desiredCol
    e.moveCursor("down"); // should use col 3 (after insert), not 12
    expect(e.cursor()).toEqual({ line: 2, col: 3 });
  });

  it("sticky column: works with shift+up selection", () => {
    const e = createEditorEngine("Hello World!\nHi\nHello World!");
    e.setCursor({ line: 2, col: 12 });
    e.moveCursor("up", true); // clamps to 2 on "Hi", remembers 12
    expect(e.cursor()).toEqual({ line: 1, col: 2 });
    expect(e.sel()?.anchor).toEqual({ line: 2, col: 12 });
    e.moveCursor("up", true); // restores to col 12
    expect(e.cursor()).toEqual({ line: 0, col: 12 });
  });

  it("left extends selection when shift is held", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 3 });
    e.moveCursor("left", true);
    expect(e.sel()).toEqual({
      anchor: { line: 0, col: 3 },
      head: { line: 0, col: 2 },
    });
  });

  it("moveCursorToLineStart goes to column 0", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 3 });
    e.moveCursorToLineStart();
    expect(e.cursor()).toEqual({ line: 0, col: 0 });
  });

  it("moveCursorToLineEnd goes to line length", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 0 });
    e.moveCursorToLineEnd();
    expect(e.cursor()).toEqual({ line: 0, col: 5 });
  });
});

// ── 9b. Word-level cursor movement ───────────────────────────────────

describe("word movement", () => {
  it("moveWord right jumps to end of word", () => {
    const e = createEditorEngine("hello world");
    e.setCursor({ line: 0, col: 0 });
    e.moveWord("right");
    expect(e.cursor()).toEqual({ line: 0, col: 6 }); // past "hello "
  });

  it("moveWord left jumps to start of word", () => {
    const e = createEditorEngine("hello world");
    e.setCursor({ line: 0, col: 7 });
    e.moveWord("left");
    expect(e.cursor()).toEqual({ line: 0, col: 6 }); // start of "world"
  });

  it("moveWord right from end of line wraps to next line", () => {
    const e = createEditorEngine("hello\nworld");
    e.setCursor({ line: 0, col: 5 });
    e.moveWord("right");
    expect(e.cursor()).toEqual({ line: 1, col: 0 });
  });

  it("moveWord left from start of line wraps to previous line end", () => {
    const e = createEditorEngine("hello\nworld");
    e.setCursor({ line: 1, col: 0 });
    e.moveWord("left");
    expect(e.cursor()).toEqual({ line: 0, col: 5 });
  });

  it("moveWord right at end of document stays put", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 5 });
    e.moveWord("right");
    expect(e.cursor()).toEqual({ line: 0, col: 5 });
  });

  it("moveWord left at start of document stays put", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 0 });
    e.moveWord("left");
    expect(e.cursor()).toEqual({ line: 0, col: 0 });
  });

  it("moveWord right with extend creates selection", () => {
    const e = createEditorEngine("hello world");
    e.setCursor({ line: 0, col: 0 });
    e.moveWord("right", true);
    expect(e.sel()).toEqual({
      anchor: { line: 0, col: 0 },
      head: { line: 0, col: 6 },
    });
  });

  it("deleteWordBackward deletes previous word", () => {
    const e = createEditorEngine("hello world");
    e.setCursor({ line: 0, col: 11 });
    e.deleteWordBackward();
    expect(e.getText()).toBe("hello ");
  });

  it("deleteWordBackward at start of line merges with previous", () => {
    const e = createEditorEngine("hello\nworld");
    e.setCursor({ line: 1, col: 0 });
    e.deleteWordBackward();
    expect(e.getText()).toBe("helloworld");
  });
});

// ── 9c. Undo groups ─────────────────────────────────────────────────

describe("undo groups", () => {
  it("multiple edits in undo group produce single undo", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 5 });
    e.beginUndoGroup();
    e.insert(" ");
    e.insert("w");
    e.insert("o");
    e.insert("r");
    e.insert("l");
    e.insert("d");
    e.endUndoGroup();
    expect(e.getText()).toBe("hello world");
    e.undo();
    expect(e.getText()).toBe("hello");
  });

  it("redo after undo group restores grouped state", () => {
    const e = createEditorEngine("abc");
    e.setCursor({ line: 0, col: 3 });
    e.beginUndoGroup();
    e.insert("1");
    e.insert("2");
    e.insert("3");
    e.endUndoGroup();
    expect(e.getText()).toBe("abc123");
    e.undo();
    expect(e.getText()).toBe("abc");
    e.redo();
    expect(e.getText()).toBe("abc123");
  });

  it("deleteRange + insert in group is single undo", () => {
    const e = createEditorEngine("hello world");
    e.beginUndoGroup();
    e.deleteRange({ line: 0, col: 5 }, { line: 0, col: 11 });
    e.setCursor({ line: 0, col: 5 });
    e.insert(" earth");
    e.endUndoGroup();
    expect(e.getText()).toBe("hello earth");
    e.undo();
    expect(e.getText()).toBe("hello world");
  });
});

// ── 10. Load and reset ───────────────────────────────────────────────

describe("loadText", () => {
  it("replaces entire document and resets cursor", () => {
    const e = createEditorEngine("old content");
    e.setCursor({ line: 0, col: 5 });
    e.loadText("new\ncontent");
    expect(e.lines()).toEqual(["new", "content"]);
    expect(e.cursor()).toEqual({ line: 0, col: 0 });
    expect(e.dirty()).toBe(false);
  });

  it("clears undo/redo history", () => {
    const e = createEditorEngine("start");
    e.setCursor({ line: 0, col: 5 });
    e.insert("x");
    e.loadText("fresh");
    expect(e.undo()).toBe(false);
    expect(e.redo()).toBe(false);
  });

  it("updates file path when provided", () => {
    const e = createEditorEngine("", "old.ts");
    e.loadText("content", "new.ts");
    expect(e.filePath()).toBe("new.ts");
  });

  it("loads empty string as single empty line", () => {
    const e = createEditorEngine("not empty");
    e.loadText("");
    expect(e.lines()).toEqual([""]);
  });

  it("clears selection and extras", () => {
    const e = createEditorEngine("hello");
    e.setSelection({ line: 0, col: 0 }, { line: 0, col: 5 });
    e.addCursor({ line: 0, col: 3 });
    e.loadText("new");
    expect(e.sel()).toBeNull();
    expect(e.extras()).toEqual([]);
  });
});

// ── 11. Dirty tracking ───────────────────────────────────────────────

describe("dirty tracking", () => {
  it("starts clean", () => {
    const e = createEditorEngine("hello");
    expect(e.dirty()).toBe(false);
  });

  it("becomes dirty after insert", () => {
    const e = createEditorEngine("hello");
    e.insert("x");
    expect(e.dirty()).toBe(true);
  });

  it("markClean resets dirty flag", () => {
    const e = createEditorEngine("hello");
    e.insert("x");
    expect(e.dirty()).toBe(true);
    e.markClean();
    expect(e.dirty()).toBe(false);
  });

  it("becomes dirty after backspace", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 5 });
    e.backspace();
    expect(e.dirty()).toBe(true);
  });
});

// ── 12. Edge cases ───────────────────────────────────────────────────

describe("edge cases", () => {
  it("empty document insert works", () => {
    const e = createEditorEngine("");
    e.insert("hello");
    expect(e.getText()).toBe("hello");
  });

  it("lineCount returns correct number", () => {
    const e = createEditorEngine("a\nb\nc");
    expect(e.lineCount()).toBe(3);
  });

  it("getLine returns correct line", () => {
    const e = createEditorEngine("first\nsecond\nthird");
    expect(e.getLine(0)).toBe("first");
    expect(e.getLine(1)).toBe("second");
    expect(e.getLine(2)).toBe("third");
  });

  it("getLine returns empty for out-of-range", () => {
    const e = createEditorEngine("hello");
    expect(e.getLine(99)).toBe("");
  });

  it("setCursor clamps to valid position", () => {
    const e = createEditorEngine("hi");
    e.setCursor({ line: 99, col: 99 });
    expect(e.cursor()).toEqual({ line: 0, col: 2 });
  });

  it("insert empty string is a no-op on text", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 2 });
    e.insert("");
    expect(e.getText()).toBe("hello");
  });
});

// ── 13. Multi-line replace correctness ────────────────────────────────

describe("multi-line replace", () => {
  it("replaces a single-line selection with multi-line text", () => {
    const e = createEditorEngine("hello world");
    e.setSelection({ line: 0, col: 6 }, { line: 0, col: 11 });
    e.insert("there\nfriend");
    expect(e.lines()).toEqual(["hello there", "friend"]);
    expect(e.cursor()).toEqual({ line: 1, col: 6 });
  });

  it("replaces a multi-line selection with a single line", () => {
    const e = createEditorEngine("aaa\nbbb\nccc");
    e.setSelection({ line: 0, col: 1 }, { line: 2, col: 2 });
    e.insert("X");
    expect(e.getText()).toBe("aXc");
    expect(e.cursor()).toEqual({ line: 0, col: 2 });
  });

  it("replaces a multi-line selection with multi-line text", () => {
    const e = createEditorEngine("line1\nline2\nline3\nline4");
    e.setSelection({ line: 1, col: 0 }, { line: 2, col: 5 });
    e.insert("replaced1\nreplaced2\nreplaced3");
    expect(e.lines()).toEqual(["line1", "replaced1", "replaced2", "replaced3", "line4"]);
    expect(e.cursor()).toEqual({ line: 3, col: 9 });
  });

  it("replaces entire document with multi-line text", () => {
    const e = createEditorEngine("old\ncontent");
    e.selectAll();
    e.insert("new\nmulti\nline\ncontent");
    expect(e.lines()).toEqual(["new", "multi", "line", "content"]);
    expect(e.cursor()).toEqual({ line: 3, col: 7 });
  });

  it("replaces reversed selection correctly", () => {
    const e = createEditorEngine("hello world");
    // Reversed selection: head=2, anchor=7 → ordered from=2, to=7 → deletes "llo w"
    e.setSelection({ line: 0, col: 7 }, { line: 0, col: 2 });
    e.insert("XY");
    expect(e.getText()).toBe("heXYorld");
  });

  it("replaces with empty string (delete selection)", () => {
    const e = createEditorEngine("aaa\nbbb\nccc");
    e.setSelection({ line: 0, col: 2 }, { line: 2, col: 1 });
    e.insert("");
    expect(e.getText()).toBe("aacc");
    expect(e.cursor()).toEqual({ line: 0, col: 2 });
  });
});

// ── 14. Selection edge cases ──────────────────────────────────────────

describe("selection edge cases", () => {
  it("selection spanning entire line includes newline", () => {
    const e = createEditorEngine("aaa\nbbb\nccc");
    e.setSelection({ line: 0, col: 0 }, { line: 1, col: 0 });
    const text = e.getTextRange(
      e.getOrderedSelection()!.from,
      e.getOrderedSelection()!.to
    );
    expect(text).toBe("aaa\n");
  });

  it("selection at end of document does not exceed bounds", () => {
    const e = createEditorEngine("abc");
    e.setSelection({ line: 0, col: 0 }, { line: 0, col: 3 });
    e.backspace();
    expect(e.getText()).toBe("");
    expect(e.cursor()).toEqual({ line: 0, col: 0 });
  });

  it("reversed multi-line selection deletes correctly", () => {
    const e = createEditorEngine("first\nsecond\nthird");
    e.setSelection({ line: 2, col: 3 }, { line: 0, col: 3 }); // reversed
    e.backspace();
    expect(e.getText()).toBe("firrd");
    expect(e.cursor()).toEqual({ line: 0, col: 3 });
  });

  it("zero-width selection at line boundary", () => {
    const e = createEditorEngine("hello\nworld");
    e.setSelection({ line: 0, col: 5 }, { line: 0, col: 5 });
    const ord = e.getOrderedSelection();
    expect(ord!.from).toEqual(ord!.to);
  });

  it("selection across many lines deletes correctly", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i}`);
    const e = createEditorEngine(lines.join("\n"));
    e.setSelection({ line: 2, col: 2 }, { line: 7, col: 3 });
    e.backspace();
    expect(e.lineCount()).toBe(5); // 0,1, merged(2+7), 8, 9
    expect(e.getLine(2)).toBe("lie7");
  });

  it("moveCursor left with selection clears selection and moves from head", () => {
    const e = createEditorEngine("hello world");
    e.setSelection({ line: 0, col: 2 }, { line: 0, col: 8 });
    e.moveCursor("left");
    expect(e.sel()).toBeNull();
    // Engine moves left from head position (col 8) → col 7
    expect(e.cursor()).toEqual({ line: 0, col: 7 });
  });

  it("moveCursor right with selection clears selection and moves from head", () => {
    const e = createEditorEngine("hello world");
    e.setSelection({ line: 0, col: 2 }, { line: 0, col: 8 });
    e.moveCursor("right");
    expect(e.sel()).toBeNull();
    // Engine moves right from head position (col 8) → col 9
    expect(e.cursor()).toEqual({ line: 0, col: 9 });
  });
});

// ── 15. Multi-cursor ordering and same-line correctness ───────────────

describe("multi-cursor advanced", () => {
  it("three cursors on same line insert in correct order", () => {
    const e = createEditorEngine("abcdefgh");
    e.setCursor({ line: 0, col: 2 });
    e.addCursor({ line: 0, col: 4 });
    e.addCursor({ line: 0, col: 6 });
    e.insert("|");
    // Back-to-front: insert at 6 → "abcdef|gh", then 4 → "abcd|ef|gh", then 2 → "ab|cd|ef|gh"
    expect(e.getText()).toBe("ab|cd|ef|gh");
  });

  it("multi-cursor delete forward on same line removes characters at all positions", () => {
    // "ab|cd|ef|gh" — cursors at the pipe characters (col 2, 5, 8)
    const e = createEditorEngine("ab|cd|ef|gh");
    e.setCursor({ line: 0, col: 2 });
    e.addCursor({ line: 0, col: 5 });
    e.addCursor({ line: 0, col: 8 });
    e.deleteForward();
    // Each cursor deletes the "|" after it → "abcdefgh"
    expect(e.getText()).toBe("abcdefgh");
  });

  it("multi-cursor across different lines maintains independence", () => {
    const e = createEditorEngine("alpha\nbeta\ngamma");
    e.setCursor({ line: 0, col: 5 });
    e.addCursor({ line: 1, col: 4 });
    e.addCursor({ line: 2, col: 5 });
    e.insert("!");
    expect(e.lines()).toEqual(["alpha!", "beta!", "gamma!"]);
  });

  it("multi-cursor newline insert creates new lines for each cursor", () => {
    const e = createEditorEngine("aaa\nbbb");
    e.setCursor({ line: 0, col: 3 });
    e.addCursor({ line: 1, col: 3 });
    e.insert("\n");
    expect(e.lines()).toEqual(["aaa", "", "bbb", ""]);
  });

  it("multi-cursor undo restores all cursor positions", () => {
    const e = createEditorEngine("aaa\nbbb");
    e.setCursor({ line: 0, col: 0 });
    e.addCursor({ line: 1, col: 0 });
    e.insert("X");
    expect(e.getText()).toBe("Xaaa\nXbbb");
    e.undo();
    expect(e.getText()).toBe("aaa\nbbb");
  });
});

// ── 16. Undo/redo boundary conditions ─────────────────────────────────

describe("undo/redo boundaries", () => {
  it("many undos past the beginning are harmless", () => {
    const e = createEditorEngine("start");
    e.insert("x");
    e.undo();
    expect(e.undo()).toBe(false);
    expect(e.undo()).toBe(false);
    expect(e.getText()).toBe("start");
  });

  it("many redos past the end are harmless", () => {
    const e = createEditorEngine("start");
    e.setCursor({ line: 0, col: 5 });
    e.insert("x");
    e.undo();
    e.redo();
    expect(e.redo()).toBe(false);
    expect(e.redo()).toBe(false);
    expect(e.getText()).toBe("startx");
  });

  it("undo after loadText returns false (history cleared)", () => {
    const e = createEditorEngine("old");
    e.insert("x");
    e.loadText("new");
    expect(e.undo()).toBe(false);
  });

  it("undo restores multi-line delete", () => {
    const e = createEditorEngine("line1\nline2\nline3");
    e.setSelection({ line: 0, col: 0 }, { line: 2, col: 5 });
    e.backspace();
    expect(e.getText()).toBe("");
    e.undo();
    expect(e.getText()).toBe("line1\nline2\nline3");
  });

  it("alternating undo/redo produces consistent states", () => {
    const e = createEditorEngine("A");
    e.setCursor({ line: 0, col: 1 });
    // Use undo groups to guarantee separate undo entries
    e.beginUndoGroup();
    e.insert("B");
    e.endUndoGroup();
    e.beginUndoGroup();
    e.insert("C");
    e.endUndoGroup();
    // State: "ABC"
    e.undo(); // "AB"
    expect(e.getText()).toBe("AB");
    e.undo(); // "A"
    expect(e.getText()).toBe("A");
    e.redo(); // "AB"
    expect(e.getText()).toBe("AB");
    e.redo(); // "ABC"
    expect(e.getText()).toBe("ABC");
    e.undo(); // "AB"
    expect(e.getText()).toBe("AB");
  });

  it("nested undo groups are handled correctly", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 5 });
    e.beginUndoGroup();
    e.insert("1");
    e.insert("2");
    e.endUndoGroup();
    e.beginUndoGroup();
    e.insert("3");
    e.insert("4");
    e.endUndoGroup();
    expect(e.getText()).toBe("hello1234");
    e.undo(); // undoes group 2 ("34")
    expect(e.getText()).toBe("hello12");
    e.undo(); // undoes group 1 ("12")
    expect(e.getText()).toBe("hello");
  });
});

// ── 17. Cursor stability at document boundaries ───────────────────────

describe("cursor boundary stability", () => {
  it("insert at line 0, col 0 on empty doc", () => {
    const e = createEditorEngine("");
    e.setCursor({ line: 0, col: 0 });
    e.insert("x");
    expect(e.getText()).toBe("x");
    expect(e.cursor()).toEqual({ line: 0, col: 1 });
  });

  it("backspace on single-character doc leaves empty", () => {
    const e = createEditorEngine("x");
    e.setCursor({ line: 0, col: 1 });
    e.backspace();
    expect(e.getText()).toBe("");
    expect(e.cursor()).toEqual({ line: 0, col: 0 });
  });

  it("delete forward on single-character doc at col 0", () => {
    const e = createEditorEngine("x");
    e.setCursor({ line: 0, col: 0 });
    e.deleteForward();
    expect(e.getText()).toBe("");
    expect(e.cursor()).toEqual({ line: 0, col: 0 });
  });

  it("cursor stays valid after deleting last line", () => {
    const e = createEditorEngine("aaa\nbbb");
    e.setSelection({ line: 0, col: 3 }, { line: 1, col: 3 });
    e.backspace();
    expect(e.lineCount()).toBe(1);
    expect(e.cursor().line).toBe(0);
  });

  it("rapid insert/delete cycle leaves cursor consistent", () => {
    const e = createEditorEngine("test");
    e.setCursor({ line: 0, col: 2 });
    for (let i = 0; i < 10; i++) {
      e.insert("x");
      e.backspace();
    }
    expect(e.getText()).toBe("test");
    expect(e.cursor()).toEqual({ line: 0, col: 2 });
  });

  it("insert at end of long document", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const e = createEditorEngine(lines.join("\n"));
    e.setCursor({ line: 99, col: 7 });
    e.insert("!");
    expect(e.getLine(99)).toBe("line 99!");
    expect(e.lineCount()).toBe(100);
  });

  it("backspace at start of long document is no-op", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const text = lines.join("\n");
    const e = createEditorEngine(text);
    e.setCursor({ line: 0, col: 0 });
    e.backspace();
    expect(e.getText()).toBe(text);
  });
});

// ── 18. Large operations ──────────────────────────────────────────────

describe("large operations", () => {
  it("insert 1000 characters in a row", () => {
    const e = createEditorEngine("");
    const bigText = "x".repeat(1000);
    e.insert(bigText);
    expect(e.getText()).toBe(bigText);
    expect(e.cursor()).toEqual({ line: 0, col: 1000 });
  });

  it("insert 100 newlines creates 101 lines", () => {
    const e = createEditorEngine("");
    e.insert("\n".repeat(100));
    expect(e.lineCount()).toBe(101);
    expect(e.cursor()).toEqual({ line: 100, col: 0 });
  });

  it("selectAll and delete on large document", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line number ${i}`);
    const e = createEditorEngine(lines.join("\n"));
    e.selectAll();
    e.backspace();
    expect(e.getText()).toBe("");
    expect(e.lineCount()).toBe(1);
  });

  it("undo large insert restores original", () => {
    const original = "original text";
    const e = createEditorEngine(original);
    e.selectAll();
    e.insert("x".repeat(5000));
    e.undo();
    expect(e.getText()).toBe(original);
  });
});

// ── 19. Indent / outdent ──────────────────────────────────────────

describe("indentLines", () => {
  it("indents current line when no selection", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 2 });
    e.indentLines();
    expect(e.getText()).toBe("\thello");
    expect(e.cursor().col).toBe(3);
  });

  it("indents all lines in selection", () => {
    const e = createEditorEngine("aaa\nbbb\nccc");
    e.setSelection({ line: 0, col: 0 }, { line: 2, col: 3 });
    e.indentLines();
    expect(e.lines()).toEqual(["\taaa", "\tbbb", "\tccc"]);
  });
});

describe("outdentLines", () => {
  it("removes leading tab from current line", () => {
    const e = createEditorEngine("\thello");
    e.setCursor({ line: 0, col: 3 });
    e.outdentLines();
    expect(e.getText()).toBe("hello");
    expect(e.cursor().col).toBe(2);
  });

  it("removes leading spaces", () => {
    const e = createEditorEngine("  hello");
    e.setCursor({ line: 0, col: 4 });
    e.outdentLines();
    expect(e.getText()).toBe("hello");
  });

  it("does nothing when line has no indentation", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 2 });
    e.outdentLines();
    expect(e.getText()).toBe("hello");
  });

  it("outdents all lines in selection", () => {
    const e = createEditorEngine("\taaa\n\tbbb\n\tccc");
    e.setSelection({ line: 0, col: 0 }, { line: 2, col: 4 });
    e.outdentLines();
    expect(e.lines()).toEqual(["aaa", "bbb", "ccc"]);
  });
});

// ── 20. Duplicate lines ───────────────────────────────────────────

describe("duplicateLines", () => {
  it("duplicates current line below", () => {
    const e = createEditorEngine("hello\nworld");
    e.setCursor({ line: 0, col: 3 });
    e.duplicateLines();
    expect(e.lines()).toEqual(["hello", "hello", "world"]);
    expect(e.cursor()).toEqual({ line: 1, col: 3 });
  });

  it("duplicates selection range below", () => {
    const e = createEditorEngine("aaa\nbbb\nccc");
    e.setSelection({ line: 0, col: 0 }, { line: 1, col: 3 });
    e.duplicateLines();
    expect(e.lines()).toEqual(["aaa", "bbb", "aaa", "bbb", "ccc"]);
  });
});

// ── 21. Move lines ────────────────────────────────────────────────

describe("moveLines", () => {
  it("moves line up", () => {
    const e = createEditorEngine("aaa\nbbb\nccc");
    e.setCursor({ line: 1, col: 1 });
    e.moveLines("up");
    expect(e.lines()).toEqual(["bbb", "aaa", "ccc"]);
    expect(e.cursor()).toEqual({ line: 0, col: 1 });
  });

  it("moves line down", () => {
    const e = createEditorEngine("aaa\nbbb\nccc");
    e.setCursor({ line: 1, col: 1 });
    e.moveLines("down");
    expect(e.lines()).toEqual(["aaa", "ccc", "bbb"]);
    expect(e.cursor()).toEqual({ line: 2, col: 1 });
  });

  it("does nothing when moving first line up", () => {
    const e = createEditorEngine("aaa\nbbb");
    e.setCursor({ line: 0, col: 0 });
    e.moveLines("up");
    expect(e.lines()).toEqual(["aaa", "bbb"]);
  });

  it("does nothing when moving last line down", () => {
    const e = createEditorEngine("aaa\nbbb");
    e.setCursor({ line: 1, col: 0 });
    e.moveLines("down");
    expect(e.lines()).toEqual(["aaa", "bbb"]);
  });

  it("moves selection range up", () => {
    const e = createEditorEngine("aaa\nbbb\nccc\nddd");
    e.setSelection({ line: 1, col: 0 }, { line: 2, col: 3 });
    e.moveLines("up");
    expect(e.lines()).toEqual(["bbb", "ccc", "aaa", "ddd"]);
  });
});

// ── 22. Join lines ────────────────────────────────────────────────

describe("joinLines", () => {
  it("joins current line with next", () => {
    const e = createEditorEngine("hello\nworld");
    e.setCursor({ line: 0, col: 3 });
    e.joinLines();
    expect(e.getText()).toBe("hello world");
    expect(e.cursor().col).toBe(5);
  });

  it("trims leading whitespace from joined line", () => {
    const e = createEditorEngine("hello\n    world");
    e.setCursor({ line: 0, col: 5 });
    e.joinLines();
    expect(e.getText()).toBe("hello world");
  });

  it("does nothing on last line", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 3 });
    e.joinLines();
    expect(e.getText()).toBe("hello");
  });
});

// ── 23. Toggle line comment ───────────────────────────────────────

describe("toggleLineComment", () => {
  it("comments an uncommented line", () => {
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 0 });
    e.toggleLineComment("//");
    expect(e.getText()).toBe("// hello");
  });

  it("uncomments a commented line", () => {
    const e = createEditorEngine("// hello");
    e.setCursor({ line: 0, col: 0 });
    e.toggleLineComment("//");
    expect(e.getText()).toBe("hello");
  });

  it("comments multiple lines in selection", () => {
    const e = createEditorEngine("aaa\nbbb\nccc");
    e.setSelection({ line: 0, col: 0 }, { line: 2, col: 3 });
    e.toggleLineComment("//");
    expect(e.lines()).toEqual(["// aaa", "// bbb", "// ccc"]);
  });

  it("uncomments multiple lines in selection", () => {
    const e = createEditorEngine("// aaa\n// bbb\n// ccc");
    e.setSelection({ line: 0, col: 0 }, { line: 2, col: 6 });
    e.toggleLineComment("//");
    expect(e.lines()).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("preserves indentation when commenting", () => {
    const e = createEditorEngine("  hello\n    world");
    e.setSelection({ line: 0, col: 0 }, { line: 1, col: 9 });
    e.toggleLineComment("//");
    // Inserts "// " at minimum indent (col 2), preserving relative indentation
    expect(e.lines()).toEqual(["  // hello", "  //   world"]);
  });

  it("works with hash comments", () => {
    const e = createEditorEngine("print('hello')");
    e.setCursor({ line: 0, col: 0 });
    e.toggleLineComment("#");
    expect(e.getText()).toBe("# print('hello')");
  });

  it("skips empty lines when determining comment state", () => {
    const e = createEditorEngine("// aaa\n\n// bbb");
    e.setSelection({ line: 0, col: 0 }, { line: 2, col: 6 });
    e.toggleLineComment("//");
    // All non-empty lines are commented, so uncomment
    expect(e.lines()).toEqual(["aaa", "", "bbb"]);
  });
});

// ── 24. Code folding commands ─────────────────────────────────────

describe("code folding commands", () => {
  const text = [
    "function outer() {",
    "  if (ready) {",
    "    run();",
    "  }",
    "  finish();",
    "}",
    "after();",
  ].join("\n");

  it("folds every foldable region", () => {
    const e = createEditorEngine(text);

    expect(e.foldAll()).toBe(true);

    expect(e.isFolded(0)).toBe(true);
    expect(e.isFolded(1)).toBe(true);
    expect(e.foldedLines().has(1)).toBe(true);
    expect(e.foldedLines().has(4)).toBe(true);
    expect(e.foldedLines().has(5)).toBe(false);
  });

  it("unfolds every folded region", () => {
    const e = createEditorEngine(text);
    e.foldAll();

    expect(e.unfoldAll()).toBe(true);

    expect(e.isFolded(0)).toBe(false);
    expect(e.isFolded(1)).toBe(false);
    expect(e.foldedLines().size).toBe(0);
  });

  it("reports no change when there is nothing to fold or unfold", () => {
    const e = createEditorEngine("one\ntwo\nthree");

    expect(e.foldAll()).toBe(false);
    expect(e.unfoldAll()).toBe(false);
  });

  it("preserves nested folds when unfolding an outer fold", () => {
    const e = createEditorEngine(text);
    e.foldAll();

    expect(e.toggleFold(0)).toBe(true);

    expect(e.isFolded(0)).toBe(false);
    expect(e.isFolded(1)).toBe(true);
    expect(e.foldedLines().has(2)).toBe(true);
    expect(e.foldedLines().has(4)).toBe(false);
  });
});
