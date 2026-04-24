/**
 * Text input handler for the canvas editor.
 * Handles bracket auto-close, Emmet expansion, auto-outdent, and smart quotes.
 * Extracted from CanvasEditor.tsx.
 */

import { extname } from "buster-path";
import type { EditorEngine } from "./engine";
import type { VimHandler } from "./vim-mode";
import type { createAutocomplete } from "./editor-autocomplete";
import type { createSignatureHelp } from "./editor-signature";
import type { createGhostText } from "./editor-ghost-text";

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
  hiddenInput: () => HTMLTextAreaElement | undefined;
  isComposing: () => boolean;
  indentUnit: () => string;
  clearHighlightCache: () => void;
}

const BRACKET_PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
const CLOSE_BRACKETS = new Set([")", "]", "}"]);

export function handleEditorInput(deps: InputDeps) {
  const { engine, vim, ac, sigHelp, ghost } = deps;
  const hi = deps.hiddenInput();
  if (!hi || deps.isComposing()) return;
  const text = hi.value;
  if (!text) return;
  hi.value = "";

  // In Vim Normal/Visual mode, suppress text insertion
  if (vim.enabled() && vim.mode() !== "insert") return;

  // Emmet-style HTML boilerplate
  if (text === "!" && deps.filePath()) {
    const ext = extname(deps.filePath()!).toLowerCase();
    if ((ext === ".html" || ext === ".htm") && engine.lineCount() <= 1 && engine.getLine(0).trim() === "") {
      const unit = deps.indentUnit();
      const boilerplate =
`<!DOCTYPE html>
<html lang="en">
<head>
${unit}<meta charset="UTF-8">
${unit}<meta name="viewport" content="width=device-width, initial-scale=1.0">
${unit}<title>Document</title>
</head>
<body>
${unit}
</body>
</html>`;
      engine.insert(boilerplate);
      engine.setCursor({ line: 8, col: unit.length });
      deps.clearHighlightCache();
      return;
    }
  }

  // Auto-close brackets and quotes
  if (text.length === 1 && BRACKET_PAIRS[text]) {
    const closing = BRACKET_PAIRS[text];
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

    if (CLOSE_BRACKETS.has(text) && charAfter === text) {
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
  if (text.length === 1 && CLOSE_BRACKETS.has(text)) {
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
