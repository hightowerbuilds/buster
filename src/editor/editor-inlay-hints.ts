import { createSignal } from "solid-js";
import { lspInlayHints } from "../lib/ipc";
import type { LspInlayHint } from "../lib/ipc";
import type { PhantomText } from "./canvas-renderer";

export interface InlayHintDeps {
  filePath: () => string | null;
  scrollTop: () => number;
  canvasHeight: () => number;
  fontSize: () => number;
  lineHeight?: () => number;
  editSeq: () => number;
}

export function createInlayHints(deps: InlayHintDeps) {
  const [hints, setHints] = createSignal<LspInlayHint[]>([]);
  let lastEditSeq = -1;
  let lastStartLine = -1;
  let lastEndLine = -1;
  let timer: number | undefined;

  function requestHints() {
    if (!deps.filePath()) return;
    if (timer) clearTimeout(timer);

    timer = setTimeout(async () => {
      if (!deps.filePath()) return;

      const lineHeight = deps.lineHeight?.() ?? deps.fontSize() + 8;
      const startLine = Math.max(0, Math.floor(deps.scrollTop() / lineHeight) - 5);
      const endLine = startLine + Math.ceil(deps.canvasHeight() / lineHeight) + 10;
      const editSeq = deps.editSeq();

      // Skip if nothing changed
      if (editSeq === lastEditSeq && startLine === lastStartLine && endLine === lastEndLine) return;
      lastEditSeq = editSeq;
      lastStartLine = startLine;
      lastEndLine = endLine;

      try {
        const result = await lspInlayHints(deps.filePath()!, startLine, endLine);
        setHints(result);
      } catch {
        setHints([]);
      }
    }, 300) as unknown as number;
  }

  function getPhantomTexts(): PhantomText[] {
    return hints().map(h => ({
      line: h.line,
      col: h.col,
      text: h.kind === "type" ? `: ${h.label}` : `${h.label}: `,
      style: "inlay" as const,
    }));
  }

  return {
    hints,
    requestHints,
    getPhantomTexts,
  };
}
