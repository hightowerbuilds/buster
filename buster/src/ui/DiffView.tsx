import { Component, createSignal, onMount, For, Show } from "solid-js";
import { gitDiffFile, gitDiffStaged } from "../lib/ipc";
import { basename } from "buster-path";

interface DiffViewProps {
  workspaceRoot: string;
  filePath: string;
  staged?: boolean;
  onClose: () => void;
}

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  oldNum: number | null;
  newNum: number | null;
  text: string;
}

interface SplitRow {
  left: { num: number | null; text: string; type: "remove" | "context" | "empty" | "header" };
  right: { num: number | null; text: string; type: "add" | "context" | "empty" | "header" };
}

function parseDiff(raw: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of raw.split("\n")) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      lines.push({ type: "header", oldNum: null, newNum: null, text: line });
    } else if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
      // File header lines — skip
    } else if (line.startsWith("+")) {
      lines.push({ type: "add", oldNum: null, newNum: newLine, text: line.slice(1) });
      newLine++;
    } else if (line.startsWith("-")) {
      lines.push({ type: "remove", oldNum: oldLine, newNum: null, text: line.slice(1) });
      oldLine++;
    } else if (line.startsWith(" ")) {
      lines.push({ type: "context", oldNum: oldLine, newNum: newLine, text: line.slice(1) });
      oldLine++;
      newLine++;
    }
  }

  return lines;
}

/** Convert unified diff lines into aligned left/right rows for split view */
function toSplitRows(diffLines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < diffLines.length) {
    const line = diffLines[i];
    if (line.type === "header") {
      rows.push({
        left: { num: null, text: line.text, type: "header" },
        right: { num: null, text: line.text, type: "header" },
      });
      i++;
    } else if (line.type === "context") {
      rows.push({
        left: { num: line.oldNum, text: line.text, type: "context" },
        right: { num: line.newNum, text: line.text, type: "context" },
      });
      i++;
    } else {
      // Collect consecutive removes then adds — align them side by side
      const removes: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < diffLines.length && diffLines[i].type === "remove") {
        removes.push(diffLines[i]);
        i++;
      }
      while (i < diffLines.length && diffLines[i].type === "add") {
        adds.push(diffLines[i]);
        i++;
      }
      const maxLen = Math.max(removes.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        const rm = removes[j];
        const ad = adds[j];
        rows.push({
          left: rm
            ? { num: rm.oldNum, text: rm.text, type: "remove" }
            : { num: null, text: "", type: "empty" },
          right: ad
            ? { num: ad.newNum, text: ad.text, type: "add" }
            : { num: null, text: "", type: "empty" },
        });
      }
    }
  }
  return rows;
}

const DiffView: Component<DiffViewProps> = (props) => {
  const [diffLines, setDiffLines] = createSignal<DiffLine[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [splitMode, setSplitMode] = createSignal(false);

  onMount(async () => {
    try {
      const fetchDiff = props.staged ? gitDiffStaged : gitDiffFile;
      const raw = await fetchDiff(props.workspaceRoot, props.filePath);
      if (!raw.trim()) {
        setError("No changes");
      } else {
        setDiffLines(parseDiff(raw));
      }
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  });

  const fileName = () => basename(props.filePath) || props.filePath;
  const splitRows = () => toSplitRows(diffLines());

  return (
    <div class="diff-view">
      <div class="diff-header">
        <span class="diff-title">{fileName()}{props.staged ? " (staged)" : ""}</span>
        <button
          class={`diff-mode-btn${splitMode() ? " active" : ""}`}
          onClick={() => setSplitMode(!splitMode())}
          title={splitMode() ? "Switch to unified view" : "Switch to split view"}
        >
          {splitMode() ? "Unified" : "Split"}
        </button>
        <button class="diff-close" onClick={props.onClose}>x</button>
      </div>
      <Show when={loading()}>
        <div class="diff-empty">Loading...</div>
      </Show>
      <Show when={error()}>
        <div class="diff-empty">{error()}</div>
      </Show>
      <Show when={!loading() && !error() && !splitMode()}>
        <div class="diff-lines">
          <For each={diffLines()}>
            {(line) => (
              <div class={`diff-line diff-line-${line.type}`}>
                <span class="diff-gutter diff-gutter-old">
                  {line.oldNum ?? ""}
                </span>
                <span class="diff-gutter diff-gutter-new">
                  {line.newNum ?? ""}
                </span>
                <span class="diff-prefix">
                  {line.type === "add" ? "+" : line.type === "remove" ? "-" : line.type === "header" ? "@@" : " "}
                </span>
                <span class="diff-text">
                  {line.text}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={!loading() && !error() && splitMode()}>
        <div class="diff-split">
          <For each={splitRows()}>
            {(row) => (
              <div class="diff-split-row">
                <div class={`diff-split-cell diff-split-${row.left.type}`}>
                  <span class="diff-gutter">{row.left.num ?? ""}</span>
                  <span class="diff-text">{row.left.text}</span>
                </div>
                <div class={`diff-split-cell diff-split-${row.right.type}`}>
                  <span class="diff-gutter">{row.right.num ?? ""}</span>
                  <span class="diff-text">{row.right.text}</span>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default DiffView;
