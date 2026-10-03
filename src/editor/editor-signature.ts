import { createSignal } from "solid-js";
import type { LspSignatureHelp } from "../lib/ipc";
import { lspSignatureHelp } from "../lib/ipc";

export interface SignatureDeps {
  filePath: () => string | null;
  cursorLine: () => number;
  cursorCol: () => number;
}

export function createSignatureHelp(deps: SignatureDeps) {
  const [signature, setSignature] = createSignal<LspSignatureHelp | null>(null);
  let timer: number | undefined;

  function dismiss() {
    setSignature(null);
    if (timer) clearTimeout(timer);
  }

  function trigger() {
    if (!deps.filePath()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!deps.filePath()) return;
      try {
        const result = await lspSignatureHelp(deps.filePath()!, deps.cursorLine(), deps.cursorCol());
        setSignature(result);
      } catch {
        setSignature(null);
      }
    }, 150) as unknown as number;
  }

  /** Call on each character insertion to decide whether to trigger or dismiss */
  function onChar(ch: string) {
    if (ch === "(" || ch === ",") {
      trigger();
    } else if (ch === ")") {
      dismiss();
    }
  }

  return {
    signature,
    dismiss,
    trigger,
    onChar,
  };
}
