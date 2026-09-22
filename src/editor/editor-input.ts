/**
 * Text input handler for the canvas editor.
 * Inserts typed text and schedules an AI completion request.
 */

import type { EditorEngine } from "./engine";
import type { createGhostText } from "./editor-ghost-text";

type GhostTextHandle = ReturnType<typeof createGhostText>;

export interface InputDeps {
  engine: EditorEngine;
  ghost: GhostTextHandle;
  hiddenInput: () => HTMLTextAreaElement | undefined;
  isComposing: () => boolean;
}

export interface TextInsertionDeps {
  engine: EditorEngine;
  ghost: GhostTextHandle;
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
  const { engine, ghost } = deps;
  engine.insert(text);
  ghost.scheduleRequest();
}
