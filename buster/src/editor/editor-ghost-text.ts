import { createSignal } from "solid-js";
import type { PhantomText } from "./canvas-renderer";

export interface GhostTextDeps {
  filePath: () => string | null;
  cursorLine: () => number;
  cursorCol: () => number;
  content: () => { lines: string[] } | null;
}

export function createGhostText(_deps: GhostTextDeps) {
  const [ghostText, setGhostText] = createSignal("");
  const [ghostLine, setGhostLine] = createSignal<number | null>(null);
  const [ghostCol, setGhostCol] = createSignal<number | null>(null);

  function dismiss() {
    setGhostText("");
    setGhostLine(null);
    setGhostCol(null);
  }

  // Ghost text (AI inline completion) is disabled — the AI backend was removed.
  // This stub keeps the interface intact so the editor doesn't need restructuring.
  function scheduleRequest() {}

  function accept(): string | null {
    const text = ghostText();
    if (!text) return null;
    dismiss();
    return text;
  }

  function getPhantomTexts(): PhantomText[] {
    return [];
  }

  return {
    ghostText,
    ghostLine,
    ghostCol,
    dismiss,
    scheduleRequest,
    accept,
    getPhantomTexts,
  };
}
