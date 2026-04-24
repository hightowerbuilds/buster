import type { BusterStoreState } from "./store-types";
import type { EditorEngine } from "../editor/engine";
import type { EngineMap } from "./buster-context";

export function createDiagnosticActions(
  store: BusterStoreState,
  engines: EngineMap,
  activeEngine: () => EditorEngine | null,
  handleFileSelect: (path: string) => Promise<void>,
) {
  function diagnosticCounts() {
    let errors = 0, warnings = 0;
    for (const key of Object.keys(store.diagnosticsMap)) {
      const diags = store.diagnosticsMap[key];
      if (!diags) continue;
      for (const d of diags) {
        if (d.severity === 1) errors++;
        else if (d.severity === 2) warnings++;
      }
    }
    return { errors, warnings };
  }

  function allDiagnosticsSorted() {
    const all: { file: string; line: number; col: number; severity: number; message: string }[] = [];
    for (const [file, diags] of Object.entries(store.diagnosticsMap)) {
      for (const d of diags) {
        all.push({ file, line: d.line, col: d.col, severity: d.severity, message: d.message });
      }
    }
    all.sort((a, b) => a.file !== b.file ? a.file.localeCompare(b.file) : a.line !== b.line ? a.line - b.line : a.col - b.col);
    return all;
  }

  async function jumpToDiagnostic(direction: 1 | -1) {
    const all = allDiagnosticsSorted();
    if (all.length === 0) return;
    const fp = store.activeFilePath;
    const curLine = activeEngine()?.cursor().line ?? 0;
    const curCol = activeEngine()?.cursor().col ?? 0;

    let idx = -1;
    if (direction === 1) {
      idx = all.findIndex(d => d.file === fp
        ? (d.line > curLine || (d.line === curLine && d.col > curCol))
        : d.file > (fp ?? ""));
    } else {
      for (let i = all.length - 1; i >= 0; i--) {
        const d = all[i];
        if (d.file === fp
          ? (d.line < curLine || (d.line === curLine && d.col < curCol))
          : d.file < (fp ?? "")) { idx = i; break; }
      }
    }
    if (idx === -1) idx = direction === 1 ? 0 : all.length - 1;

    const target = all[idx];
    if (target.file !== fp) await handleFileSelect(target.file);
    const eng = activeEngine() ?? (() => {
      const tab = store.tabs.find(t => t.path === target.file);
      return tab ? engines.get(tab.id) : undefined;
    })();
    eng?.setCursor({ line: target.line, col: target.col });
  }

  return { diagnosticCounts, jumpToDiagnostic };
}
