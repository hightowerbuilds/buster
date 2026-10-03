import { createSignal } from "solid-js";
import type { LspCodeAction } from "../lib/ipc";
import { lspCodeAction } from "../lib/ipc";

export interface CodeActionDeps {
  filePath: () => string | null;
  cursorLine: () => number;
  cursorCol: () => number;
}

export function createCodeActions(deps: CodeActionDeps) {
  const [actions, setActions] = createSignal<LspCodeAction[]>([]);
  const [menuVisible, setMenuVisible] = createSignal(false);
  const [menuIdx, setMenuIdx] = createSignal(0);
  // Track which lines have available actions (for light bulb rendering)
  const [actionLine, setActionLine] = createSignal<number | null>(null);

  async function fetchActions() {
    if (!deps.filePath()) return;
    const line = deps.cursorLine();
    const col = deps.cursorCol();
    try {
      const result = await lspCodeAction(deps.filePath()!, line, col, line, col);
      setActions(result);
      setActionLine(result.length > 0 ? line : null);
    } catch {
      setActions([]);
      setActionLine(null);
    }
  }

  function showMenu() {
    if (actions().length === 0) return;
    setMenuIdx(0);
    setMenuVisible(true);
  }

  function dismiss() {
    setMenuVisible(false);
    setMenuIdx(0);
  }

  function navigateDown() {
    setMenuIdx(Math.min(menuIdx() + 1, actions().length - 1));
  }

  function navigateUp() {
    setMenuIdx(Math.max(menuIdx() - 1, 0));
  }

  function selectedAction(): LspCodeAction | null {
    const items = actions();
    const idx = menuIdx();
    return idx >= 0 && idx < items.length ? items[idx] : null;
  }

  return {
    actions,
    menuVisible,
    menuIdx,
    actionLine,
    fetchActions,
    showMenu,
    dismiss,
    navigateDown,
    navigateUp,
    selectedAction,
  };
}
