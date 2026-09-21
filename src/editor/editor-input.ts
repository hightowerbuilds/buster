/**
 * Text input handler for the canvas editor.
 * Handles bracket auto-close, language snippets, auto-outdent, and smart quotes.
 * Extracted from CanvasEditor.tsx.
 */

import type { EditorEngine } from "./engine";
import type { VimHandler } from "./vim-mode";
import type { createAutocomplete } from "./editor-autocomplete";
import type { createSignatureHelp } from "./editor-signature";
import type { createGhostText } from "./editor-ghost-text";
import { expandTypedLanguageSnippet } from "./language-snippets";
import { getAutoClosePairMap, getClosingPairSet } from "./language-registry";

type AutocompleteHandle = ReturnType<typeof createAutocomplete>;
type SignatureHelpHandle = ReturnType<typeof createSignatureHelp>;
type GhostTextHandle = ReturnType<typeof createGhostText>;

export interface InputDeps {
  engine: EditorEngine;
  vim: VimHandler;
  ac: AutocompleteHandle;
  sigHelp: SignatureHelpHandle;
  ghost: GhostTextHandle;
  filePath: () => string | null;
  languagePath: () => string | null;
  hiddenInput: () => HTMLTextAreaElement | undefined;
  isComposing: () => boolean;
  indentUnit: () => string;
  clearHighlightCache: () => void;
}

export interface TextInsertionDeps {
  engine: EditorEngine;
  ac: AutocompleteHandle;
  sigHelp: SignatureHelpHandle;
  ghost: GhostTextHandle;
  languagePath: () => string | null;
  indentUnit: () => string;
  clearHighlightCache: () => void;
}

export function handleEditorInput(deps: InputDeps) {
  const { vim } = deps;
  const hi = deps.hiddenInput();
  if (!hi || deps.isComposing()) return;
  const text = hi.value;
  if (!text) return;
  hi.value = "";

  // In Vim Normal/Visual mode, suppress text insertion
  if (vim.enabled() && vim.mode() !== "insert") return;

  insertEditorText(text, deps);
}

export function insertEditorText(text: string, deps: TextInsertionDeps) {
  const { engine, ac, sigHelp, ghost } = deps;

  const typedSnippet = expandTypedLanguageSnippet(text, {
    languagePath: deps.languagePath(),
    lines: engine.lines(),
    cursor: engine.cursor(),
    indentUnit: deps.indentUnit(),
  });
  if (typedSnippet) {
    engine.insert(typedSnippet.text);
    engine.setCursor(typedSnippet.cursor);
    deps.clearHighlightCache();
    return;
  }

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
        deps.clearHighlightCache();
        return;
      }
    }

    if (closeBrackets.has(text) && charAfter === text) {
      engine.moveCursor("right");
      deps.clearHighlightCache();
      return;
    }

    if (!isQuote || charAfter === "" || /[\s)\]},;]/.test(charAfter)) {
      engine.insert(text + closing);
      engine.moveCursor("left");
      deps.clearHighlightCache();
      ac.trigger();
      if (text.length === 1) sigHelp.onChar(text);
      ghost.scheduleRequest();
      return;
    }
  }

  // Skip over closing bracket
  if (text.length === 1 && closeBrackets.has(text)) {
    const line = engine.getLine(engine.cursor().line);
    const charAfter = line[engine.cursor().col] ?? "";
    if (charAfter === text) {
      engine.moveCursor("right");
      deps.clearHighlightCache();
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
        deps.clearHighlightCache();
        ac.trigger();
        sigHelp.onChar(text);
        ghost.scheduleRequest();
        return;
      }
    }
  }

  engine.insert(text);
  deps.clearHighlightCache();
  ac.trigger();
  if (text.length === 1) sigHelp.onChar(text);
  ghost.scheduleRequest();
}
