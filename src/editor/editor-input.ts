/**
 * Text input handler for the canvas editor.
 * Handles bracket and quote auto-close and auto-outdent.
 * Extracted from CanvasEditor.tsx.
 */

import type { EditorEngine } from "./engine";
import { getAutoClosePairMap, getClosingPairSet } from "./language-registry";


export interface InputDeps {
  engine: EditorEngine;
  languagePath: () => string | null;
  hiddenInput: () => HTMLTextAreaElement | undefined;
  isComposing: () => boolean;
  indentUnit: () => string;
}

export interface TextInsertionDeps {
  engine: EditorEngine;
  languagePath: () => string | null;
  indentUnit: () => string;
}

export function handleEditorInput(deps: InputDeps) {
  const hi = deps.hiddenInput();
  if (!hi || deps.isComposing()) return;
  const text = hi.value;
  if (!text) return;
  hi.value = "";

  // A deliberate selection replacement is its own edit even when it follows
  // ordinary typing within the engine's typing-coalescing interval.
  const selection = deps.engine.sel();
  const replacing = !!selection && (selection.anchor.line !== selection.head.line || selection.anchor.col !== selection.head.col);
  if (replacing) deps.engine.beginUndoGroup();
  try { insertEditorText(text, deps); }
  finally { if (replacing) deps.engine.endUndoGroup(); }
}

export function insertEditorText(text: string, deps: TextInsertionDeps) {
  const { engine } = deps;

  // Auto-close brackets and quotes
  const bracketPairs = getAutoClosePairMap(deps.languagePath());
  const closeBrackets = getClosingPairSet(deps.languagePath());
  if (text.length === 1 && bracketPairs[text]) {
    const closing = bracketPairs[text];
    const isQuote = text === '"' || text === "'" || text === "`";
    const line = engine.getLine(engine.cursor().line);
    const col = engine.cursor().col;
    const charAfter = line[col] ?? "";

    if (isQuote) {
      if (charAfter === text) {
        engine.moveCursor("right");
        return;
      }
    }

    if (closeBrackets.has(text) && charAfter === text) {
      engine.moveCursor("right");
      return;
    }

    if (!isQuote || charAfter === "" || /[\s)\]},;]/.test(charAfter)) {
      engine.insert(text + closing);
      engine.moveCursor("left");
      return;
    }
  }

  // Skip over closing bracket
  if (text.length === 1 && closeBrackets.has(text)) {
    const line = engine.getLine(engine.cursor().line);
    const charAfter = line[engine.cursor().col] ?? "";
    if (charAfter === text) {
      engine.moveCursor("right");
      return;
    }
  }

  // Auto-outdent
  if (text === "}" || text === "]" || text === ")") {
    const cur = engine.cursor();
    const line = engine.getLine(cur.line);
    if (/^\s*$/.test(line.slice(0, cur.col))) {
      const unit = deps.indentUnit();
      const currentIndent = line.match(/^\s*/)![0];
      if (currentIndent.length >= unit.length) {
        const newIndent = currentIndent.slice(unit.length);
        engine.deleteRange({ line: cur.line, col: 0 }, { line: cur.line, col: currentIndent.length });
        engine.setCursor({ line: cur.line, col: 0 });
        engine.insert(newIndent + text);
          return;
      }
    }
  }

  engine.insert(text);
}
