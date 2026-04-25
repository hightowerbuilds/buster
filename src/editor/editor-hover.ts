import { createSignal } from "solid-js";
import { lspHover, lspDefinition, lspTypeDefinition } from "../lib/ipc";
import { showError } from "../lib/notify";

export interface HoverDeps {
  filePath: () => string | null;
  cursorLine: () => number;
  cursorCol: () => number;
  updateCursor: (line: number, col: number) => void;
  ensureCursorVisible: () => void;
  onGoToFile?: (path: string, line: number, col: number) => void;
  pushNavHistory?: (path: string, line: number, col: number) => void;
}

export function createHover(deps: HoverDeps) {
  const [hoverText, setHoverText] = createSignal("");
  const [hoverPos, setHoverPos] = createSignal<{ line: number; col: number } | null>(null);
  let hoverTimer: number | undefined;
  let lastHoverLine = -1;
  let lastHoverCol = -1;

  function dismiss() {
    setHoverText("");
    setHoverPos(null);
    if (hoverTimer) clearTimeout(hoverTimer);
  }

  function schedule(line: number, col: number) {
    if (!deps.filePath()) return;
    if (line === lastHoverLine && col === lastHoverCol) return;
    lastHoverLine = line;
    lastHoverCol = col;
    dismiss();
    hoverTimer = setTimeout(async () => {
      if (!deps.filePath()) return;
      try {
        const result = await lspHover(deps.filePath()!, line, col);
        if (result.contents) {
          setHoverText(result.contents);
          setHoverPos({ line, col });
        }
      } catch {}
    }, 500) as unknown as number;
  }

  async function goToDefinition() {
    if (!deps.filePath()) return;
    const line = deps.cursorLine();
    const col = deps.cursorCol();
    // Record current position before navigating
    deps.pushNavHistory?.(deps.filePath()!, line, col);
    try {
      const locations = await lspDefinition(deps.filePath()!, line, col);
      if (locations.length > 0) {
        const loc = locations[0];
        if (loc.file_path === deps.filePath()) {
          deps.updateCursor(loc.line, loc.col);
          deps.ensureCursorVisible();
        } else {
          deps.onGoToFile?.(loc.file_path, loc.line, loc.col);
        }
        // Record destination position
        deps.pushNavHistory?.(loc.file_path, loc.line, loc.col);
      }
    } catch {
      showError("Go to definition failed");
    }
  }

  function showImmediate(text: string, line: number, col: number) {
    if (line === lastHoverLine && col === lastHoverCol && hoverText() === text) return;
    lastHoverLine = line;
    lastHoverCol = col;
    if (hoverTimer) clearTimeout(hoverTimer);
    setHoverText(text);
    setHoverPos({ line, col });
  }

  async function goToTypeDefinition() {
    if (!deps.filePath()) return;
    const line = deps.cursorLine();
    const col = deps.cursorCol();
    deps.pushNavHistory?.(deps.filePath()!, line, col);
    try {
      const locations = await lspTypeDefinition(deps.filePath()!, line, col);
      if (locations.length > 0) {
        const loc = locations[0];
        if (loc.file_path === deps.filePath()) {
          deps.updateCursor(loc.line, loc.col);
          deps.ensureCursorVisible();
        } else {
          deps.onGoToFile?.(loc.file_path, loc.line, loc.col);
        }
        deps.pushNavHistory?.(loc.file_path, loc.line, loc.col);
      }
    } catch {
      showError("Go to type definition failed");
    }
  }

  return {
    hoverText,
    hoverPos,
    dismiss,
    schedule,
    showImmediate,
    goToDefinition,
    goToTypeDefinition,
  };
}
