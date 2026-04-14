import { Component, Show } from "solid-js";
import type { LspState } from "../lib/store-types";

interface StatusBarProps {
  line: number;
  col: number;
  totalLines: number;
  fileName: string | null;
  gitBranch?: string | null;
  onBranchClick?: () => void;
  onSync?: () => void;
  syncing?: boolean;
  lspState?: LspState;
  lspLanguages?: string[];
  errorCount?: number;
  warningCount?: number;
  onDiagnosticsClick?: () => void;
}

const LSP_LABELS: Record<LspState, string> = {
  inactive: "",
  starting: "LSP Starting...",
  active: "LSP",
  error: "LSP Error",
  crashed: "LSP Crashed",
};

const StatusBar: Component<StatusBarProps> = (props) => {
  const lspLabel = () => {
    const state = props.lspState ?? "inactive";
    if (state === "active" && props.lspLanguages?.length) {
      return `LSP: ${props.lspLanguages.join(", ")}`;
    }
    return LSP_LABELS[state];
  };

  return (
    <div class="status-bar" role="status" aria-label="Status bar" aria-live="polite">
      <div class="status-left">
        <span class="status-item">Buster</span>
        <Show when={props.gitBranch}>
          <span
            class="status-item status-branch"
            style={{ cursor: props.onBranchClick ? "pointer" : "default" }}
            onClick={() => props.onBranchClick?.()}
            title="Click to switch branches"
          >
            {props.gitBranch}
          </span>
        </Show>
        <Show when={props.onSync}>
          <button
            class={`status-sync-btn${props.syncing ? " syncing" : ""}`}
            onClick={() => props.onSync?.()}
            title="Sync: refresh file tree, git status, and open files"
            aria-label="Sync workspace"
            disabled={props.syncing}
          >
            {props.syncing ? "Syncing..." : "Sync"}
          </button>
        </Show>
      </div>
      <div class="status-right">
        <Show when={(props.errorCount ?? 0) > 0 || (props.warningCount ?? 0) > 0}>
          <span
            class="status-item status-diagnostics"
            style={{ cursor: props.onDiagnosticsClick ? "pointer" : "default" }}
            onClick={() => props.onDiagnosticsClick?.()}
            title="Click to jump to next diagnostic (F8)"
          >
            <Show when={(props.errorCount ?? 0) > 0}>
              <span class="status-errors">{props.errorCount} error{props.errorCount === 1 ? "" : "s"}</span>
            </Show>
            <Show when={(props.warningCount ?? 0) > 0}>
              <span class="status-warnings">{props.warningCount} warning{props.warningCount === 1 ? "" : "s"}</span>
            </Show>
          </span>
        </Show>
        <Show when={lspLabel()}>
          <span class={`status-item status-lsp status-lsp-${props.lspState ?? "inactive"}`}>
            {lspLabel()}
          </span>
        </Show>
        <span class="status-item">
          Ln {props.line + 1}, Col {props.col + 1}
        </span>
        <span class="status-item">{props.totalLines} lines</span>
        <span class="status-item">{props.fileName || "untitled"}</span>
      </div>
    </div>
  );
};

export default StatusBar;
