import { createSignal } from "solid-js";
import type { CompletionItem } from "../lib/ipc";
import { lspCompletion } from "../lib/ipc";

export interface AutocompleteDeps {
  filePath: () => string | null;
  autocompleteEnabled: () => boolean;
  cursorLine: () => number;
  cursorCol: () => number;
  lines: () => string[];
  updateCursor: (line: number, col: number) => void;
  insertText: (text: string) => void;
  setSelection: (anchorLine: number, anchorCol: number, headLine: number, headCol: number) => void;
  resetCursorBlink: () => void;
  clearHighlightCache: () => void;
}

/** A resolved tab stop within an expanded snippet. */
interface TabStop {
  /** Tab stop number (1, 2, ... 0 is final). */
  index: number;
  /** Absolute line in the document. */
  line: number;
  /** Absolute column where the placeholder starts. */
  col: number;
  /** Length of the placeholder text (0 for bare $N stops). */
  length: number;
}

export function createAutocomplete(deps: AutocompleteDeps) {
  const [completions, setCompletions] = createSignal<CompletionItem[]>([]);
  const [completionIdx, setCompletionIdx] = createSignal(0);
  const [completionVisible, setCompletionVisible] = createSignal(false);
  let triggerTimer: number | undefined;

  // ── Snippet session state ───────────────────────────────────
  let snippetStops: TabStop[] = [];
  let snippetStopIdx = -1;

  function isInSnippet(): boolean {
    return snippetStops.length > 0 && snippetStopIdx >= 0;
  }

  function exitSnippet() {
    snippetStops = [];
    snippetStopIdx = -1;
  }

  /** Advance to the next tab stop. Returns true if there was a stop to advance to. */
  function advanceSnippet(): boolean {
    if (!isInSnippet()) return false;
    snippetStopIdx++;
    if (snippetStopIdx >= snippetStops.length) {
      exitSnippet();
      return false;
    }
    const stop = snippetStops[snippetStopIdx];
    if (stop.length > 0) {
      deps.setSelection(stop.line, stop.col, stop.line, stop.col + stop.length);
    } else {
      deps.updateCursor(stop.line, stop.col);
    }
    deps.resetCursorBlink();
    return true;
  }

  function dismiss() {
    setCompletionVisible(false);
    setCompletions([]);
    setCompletionIdx(0);
    if (triggerTimer) clearTimeout(triggerTimer);
  }

  function showItems(items: CompletionItem[]) {
    if (items.length > 0) {
      setCompletions(items);
      setCompletionIdx(0);
      setCompletionVisible(true);
    } else {
      dismiss();
    }
  }

  function trigger() {
    if (!deps.autocompleteEnabled() || !deps.filePath()) return;
    if (triggerTimer) clearTimeout(triggerTimer);
    triggerTimer = setTimeout(async () => {
      const fp = deps.filePath();
      if (!fp) return;
      try {
        const items = await lspCompletion(fp, deps.cursorLine(), deps.cursorCol());
        showItems(items.map(i => ({ label: i.label, detail: i.detail ?? "" })));
      } catch {
        dismiss();
      }
    }, 100) as unknown as number;
  }

  /** Parse snippet text, returning plain text and all tab stops with their offsets. */
  function parseSnippet(text: string): { plain: string; stops: { index: number; offset: number; length: number }[] } {
    let plain = "";
    const stops: { index: number; offset: number; length: number }[] = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] === "$") {
        if (text[i + 1] === "{") {
          const close = text.indexOf("}", i + 2);
          if (close !== -1) {
            const inner = text.slice(i + 2, close);
            const colonIdx = inner.indexOf(":");
            const tabStop = colonIdx >= 0 ? parseInt(inner.slice(0, colonIdx)) : parseInt(inner);
            const placeholder = colonIdx >= 0 ? inner.slice(colonIdx + 1) : "";
            if (!isNaN(tabStop)) {
              stops.push({ index: tabStop, offset: plain.length, length: placeholder.length });
            }
            plain += placeholder;
            i = close + 1;
            continue;
          }
        } else if (/\d/.test(text[i + 1] ?? "")) {
          const tabStop = parseInt(text[i + 1]);
          if (!isNaN(tabStop)) {
            stops.push({ index: tabStop, offset: plain.length, length: 0 });
          }
          i += 2;
          continue;
        }
      }
      plain += text[i];
      i++;
    }
    // Sort: $1, $2, ... $N, then $0 last (final cursor position)
    stops.sort((a, b) => {
      if (a.index === 0) return 1;
      if (b.index === 0) return -1;
      return a.index - b.index;
    });
    return { plain, stops };
  }

  function accept() {
    const items = completions();
    const idx = completionIdx();
    if (idx < 0 || idx >= items.length) return;

    const item = items[idx];
    const line = deps.cursorLine();
    const col = deps.cursorCol();
    const lineText = deps.lines()[line] || "";
    const chars = [...lineText];
    let start = col;
    while (start > 0 && /[\w]/.test(chars[start - 1] || "")) {
      start--;
    }
    const prefix = chars.slice(start, col).join("");
    let remaining = item.label.slice(prefix.length);

    // Check if the completion text contains snippet syntax
    const hasSnippet = remaining.includes("$");
    if (hasSnippet) {
      const { plain, stops } = parseSnippet(remaining);
      remaining = plain;
      if (remaining.length > 0) {
        deps.insertText(remaining);
        deps.clearHighlightCache();

        // Build absolute tab stop positions
        if (stops.length > 0) {
          snippetStops = stops.map(s => ({
            index: s.index,
            line,
            col: col + s.offset,
            length: s.length,
          }));
          snippetStopIdx = -1; // advanceSnippet will increment to 0
          dismiss();
          deps.resetCursorBlink();
          advanceSnippet();
          return;
        }
      }
    } else if (remaining.length > 0) {
      deps.insertText(remaining);
      deps.clearHighlightCache();
    }
    dismiss();
    deps.resetCursorBlink();
  }

  function navigateDown() {
    setCompletionIdx(Math.min(completionIdx() + 1, Math.min(completions().length - 1, 7)));
  }

  function navigateUp() {
    setCompletionIdx(Math.max(completionIdx() - 1, 0));
  }

  return {
    completions,
    completionIdx,
    completionVisible,
    dismiss,
    trigger,
    showItems,
    accept,
    navigateDown,
    navigateUp,
    // Snippet session
    isInSnippet,
    advanceSnippet,
    exitSnippet,
  };
}
