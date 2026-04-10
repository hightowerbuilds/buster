import { Component, For, Show, createMemo } from "solid-js";
import { basename } from "buster-path";

interface Diagnostic {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  severity: number;
  message: string;
}

interface ProblemsPanelProps {
  diagnosticsMap: Map<string, Diagnostic[]>;
  onJumpTo: (filePath: string, line: number, col: number) => void;
}

const SEVERITY_LABEL: Record<number, string> = { 1: "Error", 2: "Warning", 3: "Info", 4: "Hint" };
const SEVERITY_CLASS: Record<number, string> = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

const ProblemsPanel: Component<ProblemsPanelProps> = (props) => {
  const grouped = createMemo(() => {
    const groups: { file: string; name: string; diagnostics: Diagnostic[] }[] = [];
    for (const [file, diags] of props.diagnosticsMap) {
      if (diags.length === 0) continue;
      const name = basename(file) || file;
      // Sort by severity then line
      const sorted = [...diags].sort((a, b) => a.severity !== b.severity ? a.severity - b.severity : a.line - b.line);
      groups.push({ file, name, diagnostics: sorted });
    }
    // Sort groups by error count descending
    groups.sort((a, b) => {
      const aErrors = a.diagnostics.filter(d => d.severity === 1).length;
      const bErrors = b.diagnostics.filter(d => d.severity === 1).length;
      return bErrors - aErrors;
    });
    return groups;
  });

  const totalErrors = createMemo(() => {
    let errors = 0, warnings = 0;
    for (const [, diags] of props.diagnosticsMap) {
      for (const d of diags) {
        if (d.severity === 1) errors++;
        else if (d.severity === 2) warnings++;
      }
    }
    return { errors, warnings };
  });

  return (
    <div class="problems-panel">
      <div class="problems-header">
        <span class="problems-title">Problems</span>
        <span class="problems-counts">
          <Show when={totalErrors().errors > 0}>
            <span class="problems-count problems-count-error">{totalErrors().errors} error{totalErrors().errors === 1 ? "" : "s"}</span>
          </Show>
          <Show when={totalErrors().warnings > 0}>
            <span class="problems-count problems-count-warning">{totalErrors().warnings} warning{totalErrors().warnings === 1 ? "" : "s"}</span>
          </Show>
          <Show when={totalErrors().errors === 0 && totalErrors().warnings === 0}>
            <span class="problems-count">No problems</span>
          </Show>
        </span>
      </div>
      <div class="problems-body">
        <For each={grouped()}>
          {(group) => (
            <div class="problems-group">
              <div class="problems-file">{group.name} <span class="problems-file-count">({group.diagnostics.length})</span></div>
              <For each={group.diagnostics}>
                {(diag) => (
                  <div
                    class={`problems-item problems-item-${SEVERITY_CLASS[diag.severity] ?? "info"}`}
                    onClick={() => props.onJumpTo(group.file, diag.line, diag.col)}
                  >
                    <span class="problems-severity">{SEVERITY_LABEL[diag.severity] ?? "Info"}</span>
                    <span class="problems-message">{diag.message}</span>
                    <span class="problems-location">Ln {diag.line + 1}, Col {diag.col + 1}</span>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default ProblemsPanel;
