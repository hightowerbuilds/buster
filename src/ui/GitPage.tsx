import { Component, createSignal, createEffect, on, Show, onMount, onCleanup } from "solid-js";
import GitPanel from "./GitPanel";
import GitGraph from "./GitGraph";
import ConflictResolver from "./ConflictResolver";
import { useBuster } from "../lib/buster-context";
import { measureTextWidth } from "../editor/text-measure";

type GitView = "status" | "graph" | "log";

interface GitPageProps {
  active: boolean;
  workspaceRoot?: string;
  onFileSelect?: (path: string) => void;
}

const GitPage: Component<GitPageProps> = (props) => {
  const [view, setView] = createSignal<GitView>("status");
  const [conflictFile, setConflictFile] = createSignal<string | null>(null);

  return (
    <div class="git-page" style={{ display: props.active ? "flex" : "none" }}>
      <div class="git-page-tabs">
        <button
          class={`git-page-tab ${view() === "status" ? "git-page-tab-active" : ""}`}
          onClick={() => setView("status")}
        >
          Status
        </button>
        <button
          class={`git-page-tab ${view() === "graph" ? "git-page-tab-active" : ""}`}
          onClick={() => setView("graph")}
        >
          Commit Graph
        </button>
        <button
          class={`git-page-tab ${view() === "log" ? "git-page-tab-active" : ""}`}
          onClick={() => setView("log")}
        >
          Log
        </button>
      </div>
      <div class="git-page-content">
        <div style={{ display: view() === "status" ? "contents" : "none" }}>
          <GitPanel
            workspaceRoot={props.workspaceRoot ?? null}
            onFileSelect={props.onFileSelect}
            onResolveConflict={(filePath) => setConflictFile(filePath)}
          />
        </div>
        <div style={{ display: view() === "graph" ? "contents" : "none" }}>
          <GitGraph
            active={props.active && view() === "graph"}
            workspaceRoot={props.workspaceRoot}
          />
        </div>
        <div style={{ display: view() === "log" ? "contents" : "none" }}>
          <GitLog
            active={props.active && view() === "log"}
            workspaceRoot={props.workspaceRoot}
          />
        </div>
      </div>
      <Show when={conflictFile() && props.workspaceRoot}>
        <ConflictResolver
          filePath={conflictFile()!}
          workspaceRoot={props.workspaceRoot!}
          onResolved={() => setConflictFile(null)}
          onCancel={() => setConflictFile(null)}
        />
      </Show>
    </div>
  );
};

// Simple log view — canvas-rendered git log
import { gitLogGraph } from "../lib/ipc";
import type { GitCommitNode } from "../lib/ipc";

const GitLog: Component<{ active: boolean; workspaceRoot?: string }> = (props) => {
  const { store } = useBuster();
  const palette = () => store.palette;
  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let animId: number;
  let needsRedraw = true;

  const [commits, setCommits] = createSignal<GitCommitNode[]>([]);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [hoverIdx, setHoverIdx] = createSignal(-1);

  const ROW_H = 28;

  function scheduleRedraw() { needsRedraw = true; scheduleRender(); }

  async function loadCommits() {
    if (!props.workspaceRoot) return;
    try {
      const data = await gitLogGraph(props.workspaceRoot, 200);
      setCommits(data);
      scheduleRedraw();
    } catch {}
  }

  function scheduleRender() {
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(render);
  }

  function render() {
    if (!props.active || !canvasRef || !containerRef || !needsRedraw) {
      return;
    }
    needsRedraw = false;

    const dpr = window.devicePixelRatio || 1;
    const w = containerRef.clientWidth;
    const h = containerRef.clientHeight;
    canvasRef.width = w * dpr;
    canvasRef.height = h * dpr;
    const ctx = canvasRef.getContext("2d", { alpha: false })!;
    ctx.scale(dpr, dpr);

    const p = palette();

    ctx.fillStyle = p.editorBg;
    ctx.fillRect(0, 0, w, h);

    const nodes = commits();
    if (nodes.length === 0) {
      ctx.font = '16px "Courier New", Courier, monospace';
      ctx.fillStyle = p.textMuted;
      ctx.textAlign = "center";
      ctx.fillText("No commits", w / 2, h / 2);
    } else {

    const scroll = scrollTop();
    const firstRow = Math.floor(scroll / ROW_H);
    const visRows = Math.ceil(h / ROW_H) + 1;
    const lastRow = Math.min(firstRow + visRows, nodes.length);
    const offsetY = -(scroll % ROW_H);

    for (let i = firstRow; i < lastRow; i++) {
      const node = nodes[i];
      const y = (i - firstRow) * ROW_H + offsetY;
      const isHover = hoverIdx() === i;

      if (isHover) {
        ctx.fillStyle = p.currentLine;
        ctx.fillRect(0, y, w, ROW_H);
      }

      // Row separator
      ctx.strokeStyle = p.border;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y + ROW_H);
      ctx.lineTo(w, y + ROW_H);
      ctx.stroke();

      const textY = y + ROW_H / 2;

      // Hash
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.fillStyle = p.accent;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(node.short_hash, 12, textY);

      // Message
      ctx.font = '13px "Courier New", Courier, monospace';
      ctx.fillStyle = isHover ? p.text : p.textDim;
      const msgX = 90;
      const maxMsg = w - msgX - 260;
      let msg = node.message;
      const msgFont = '13px "Courier New", Courier, monospace';
      while (measureTextWidth(msg, msgFont) > maxMsg && msg.length > 10) {
        msg = msg.slice(0, -4) + "...";
      }
      ctx.fillText(msg, msgX, textY);

      // Refs
      if (node.refs.length > 0) {
        let rx = msgX + measureTextWidth(msg, msgFont) + 8;
        const refFont = '10px "Courier New", Courier, monospace';
        ctx.font = refFont;
        for (const ref of node.refs) {
          const clean = ref.replace("HEAD -> ", "");
          const lw = measureTextWidth(clean, refFont) + 8;
          const isHead = ref.includes("HEAD");
          ctx.fillStyle = isHead ? p.accent : p.surface0;
          ctx.fillRect(rx, textY - 7, lw, 14);
          ctx.fillStyle = isHead ? p.editorBg : p.textDim;
          ctx.fillText(clean, rx + 4, textY);
          rx += lw + 3;
        }
      }

      // Author
      ctx.font = '12px "Courier New", Courier, monospace';
      ctx.fillStyle = p.textMuted;
      ctx.textAlign = "right";
      ctx.fillText(node.author, w - 120, textY);

      // Date
      ctx.fillStyle = p.surface2;
      ctx.fillText(node.date, w - 10, textY);
    }
    } // end else (has commits)
  }

  function handleScroll(e: WheelEvent) {
    e.preventDefault();
    const max = Math.max(0, commits().length * ROW_H - (containerRef?.clientHeight || 600));
    setScrollTop(Math.max(0, Math.min(scrollTop() + e.deltaY, max)));
    scheduleRedraw();
  }

  function handleMouseMove(e: MouseEvent) {
    if (!containerRef) return;
    const rect = containerRef.getBoundingClientRect();
    const y = e.clientY - rect.top + scrollTop();
    const idx = Math.floor(y / ROW_H);
    setHoverIdx(idx >= 0 && idx < commits().length ? idx : -1);
    scheduleRedraw();
  }

  // Reload commits when becoming active
  createEffect(on(
    () => props.active,
    (active) => {
      if (active) {
        loadCommits();
      }
    }
  ));

  onMount(() => {
    if (props.active) loadCommits();

    onCleanup(() => {
      cancelAnimationFrame(animId);
    });
  });

  return (
    <div
      ref={containerRef}
      class="git-log-view"
      style={{ display: props.active ? "block" : "none" }}
      onWheel={handleScroll}
      onMouseMove={handleMouseMove}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
};

export default GitPage;
