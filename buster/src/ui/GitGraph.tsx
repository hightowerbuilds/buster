import { Component, createSignal, createEffect, on, onMount, onCleanup } from "solid-js";
import { gitLogGraph } from "../lib/ipc";
import type { GitCommitNode } from "../lib/ipc";
import { useBuster } from "../lib/buster-context";
import type { ThemePalette } from "../lib/theme";
import { measureTextWidth } from "../editor/text-measure";

interface GitGraphProps {
  active: boolean;
  workspaceRoot?: string;
}

// Derive lane colors from the active palette
function getLaneColors(p: ThemePalette): string[] {
  return [
    p.accent,                           // primary accent
    p.syntax.string || p.accent2,       // string color
    p.accent2,                          // secondary accent
    p.warning,                          // warm tone
    p.syntax.keyword || p.accent,       // keyword color
    p.info,                             // cool tone
    p.syntax.function || p.accent,      // function color
    p.error,                            // red/warm
    p.cursor,                           // cursor color
    p.cursorAlt,                        // alt cursor
  ];
}

const NODE_RADIUS = 5;
const ROW_HEIGHT = 32;
const LANE_WIDTH = 20;
const GRAPH_LEFT = 16;
const TEXT_LEFT_PAD = 16;
const FONT = '13px "JetBrains Mono", monospace';
const LABEL_FONT = '11px "Courier New", Courier, monospace';

const GitGraph: Component<GitGraphProps> = (props) => {
  const { store } = useBuster();
  const palette = () => store.palette;
  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let needsRedraw = true;
  let animId: number;

  const [commits, setCommits] = createSignal<GitCommitNode[]>([]);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [canvasWidth, setCanvasWidth] = createSignal(800);
  const [canvasHeight, setCanvasHeight] = createSignal(600);
  const [hoverIdx, setHoverIdx] = createSignal(-1);

  function scheduleRedraw() { needsRedraw = true; scheduleRender(); }

  // Assign each commit to a lane (column) for the graph visualization
  function computeLanes(nodes: GitCommitNode[]): { lane: number; maxLane: number }[] {
    const hashToIdx = new Map<string, number>();
    nodes.forEach((n, i) => hashToIdx.set(n.short_hash, i));

    const lanes: number[] = new Array(nodes.length).fill(0);
    const activeLanes: (string | null)[] = []; // which hash occupies each lane

    let maxLane = 0;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const hash = node.short_hash;

      // Find if this commit is already in an active lane (as a parent target)
      let myLane = activeLanes.indexOf(hash);
      if (myLane === -1) {
        // New branch — find first empty lane or add a new one
        myLane = activeLanes.indexOf(null);
        if (myLane === -1) {
          myLane = activeLanes.length;
          activeLanes.push(null);
        }
      }

      lanes[i] = myLane;
      activeLanes[myLane] = null; // This commit consumes the lane

      // Assign parents to lanes
      for (let p = 0; p < node.parents.length; p++) {
        const parent = node.parents[p];
        const existingLane = activeLanes.indexOf(parent);
        if (existingLane !== -1) {
          // Parent already has a lane — it'll merge
          continue;
        }
        if (p === 0) {
          // First parent takes this lane (straight line)
          activeLanes[myLane] = parent;
        } else {
          // Additional parents (merge sources) get new lanes
          let freeLane = activeLanes.indexOf(null);
          if (freeLane === -1) {
            freeLane = activeLanes.length;
            activeLanes.push(null);
          }
          activeLanes[freeLane] = parent;
        }
      }

      maxLane = Math.max(maxLane, ...lanes.slice(0, i + 1));
    }

    // Trim trailing empty lanes
    while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
      activeLanes.pop();
    }

    return lanes.map((lane) => ({ lane, maxLane }));
  }

  function scheduleRender() {
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(render);
  }

  function render() {
    if (!props.active || !canvasRef || !containerRef || !needsRedraw) {
      return; // Don't schedule another frame — scheduleRender will kick us when needed
    }
    needsRedraw = false;

    const dpr = window.devicePixelRatio || 1;
    const w = canvasWidth();
    const h = canvasHeight();
    canvasRef.width = w * dpr;
    canvasRef.height = h * dpr;
    const ctx = canvasRef.getContext("2d", { alpha: false })!;
    ctx.scale(dpr, dpr);

    // Current palette
    const p = palette();
    const laneColors = getLaneColors(p);

    // Background
    ctx.fillStyle = p.editorBg;
    ctx.fillRect(0, 0, w, h);

    const nodes = commits();
    if (nodes.length === 0) {
      ctx.font = '16px "Courier New", Courier, monospace';
      ctx.fillStyle = p.textMuted;
      ctx.textAlign = "center";
      ctx.fillText("No commits yet", w / 2, h / 2);
    }

    if (nodes.length > 0) {
    const laneData = computeLanes(nodes);
    const maxLane = Math.max(0, ...laneData.map((l) => l.lane));
    const graphWidth = GRAPH_LEFT + (maxLane + 2) * LANE_WIDTH;
    const textX = graphWidth + TEXT_LEFT_PAD;
    const scroll = scrollTop();
    const firstRow = Math.floor(scroll / ROW_HEIGHT);
    const visibleRows = Math.ceil(h / ROW_HEIGHT) + 1;
    const lastRow = Math.min(firstRow + visibleRows, nodes.length);
    const offsetY = -(scroll % ROW_HEIGHT);

    // Build parent lookup for drawing connections
    const hashToRow = new Map<string, number>();
    nodes.forEach((n, i) => hashToRow.set(n.short_hash, i));

    // --- Draw connections first (behind nodes) ---
    ctx.lineWidth = 2;
    for (let i = firstRow; i < lastRow; i++) {
      const node = nodes[i];
      const lane = laneData[i].lane;
      const y = (i - firstRow) * ROW_HEIGHT + offsetY + ROW_HEIGHT / 2;
      const x = GRAPH_LEFT + lane * LANE_WIDTH + LANE_WIDTH / 2;
      const color = laneColors[lane % laneColors.length];

      for (const parentHash of node.parents) {
        const parentRow = hashToRow.get(parentHash);
        if (parentRow === undefined) continue;

        const parentLane = laneData[parentRow]?.lane ?? lane;
        const parentColor = laneColors[parentLane % laneColors.length];
        const py = (parentRow - firstRow) * ROW_HEIGHT + offsetY + ROW_HEIGHT / 2;
        const px = GRAPH_LEFT + parentLane * LANE_WIDTH + LANE_WIDTH / 2;

        // Only draw if at least partially visible
        if (Math.max(y, py) < -ROW_HEIGHT || Math.min(y, py) > h + ROW_HEIGHT) continue;

        ctx.strokeStyle = parentRow === i + 1 && lane === parentLane
          ? color // straight line — same color
          : parentColor; // merge/branch — parent's color
        ctx.beginPath();

        if (lane === parentLane) {
          // Straight vertical line
          ctx.moveTo(x, y);
          ctx.lineTo(px, py);
        } else {
          // Curved connection for merges/branches
          ctx.moveTo(x, y);
          ctx.bezierCurveTo(x, y + ROW_HEIGHT * 0.7, px, py - ROW_HEIGHT * 0.7, px, py);
        }
        ctx.stroke();
      }
    }

    // --- Draw nodes and text ---
    for (let i = firstRow; i < lastRow; i++) {
      const node = nodes[i];
      const lane = laneData[i].lane;
      const y = (i - firstRow) * ROW_HEIGHT + offsetY + ROW_HEIGHT / 2;
      const x = GRAPH_LEFT + lane * LANE_WIDTH + LANE_WIDTH / 2;
      const color = laneColors[lane % laneColors.length];
      const isHover = hoverIdx() === i;

      // Hover highlight
      if (isHover) {
        ctx.fillStyle = p.currentLine;
        ctx.fillRect(0, (i - firstRow) * ROW_HEIGHT + offsetY, w, ROW_HEIGHT);
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(x, y, node.is_merge ? NODE_RADIUS + 2 : NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Merge node — hollow center
      if (node.is_merge) {
        ctx.beginPath();
        ctx.arc(x, y, NODE_RADIUS - 1, 0, Math.PI * 2);
        ctx.fillStyle = p.editorBg;
        ctx.fill();
      }

      // Ref labels (branch/tag names)
      let labelX = textX;
      ctx.font = LABEL_FONT;
      for (const ref of node.refs) {
        const cleanRef = ref.replace("HEAD -> ", "");
        const labelW = measureTextWidth(cleanRef, LABEL_FONT) + 10;
        const isHead = ref.includes("HEAD");

        // Label background
        ctx.fillStyle = isHead ? p.accent : p.surface0;
        ctx.fillRect(labelX, y - 8, labelW, 16);

        // Label text
        ctx.fillStyle = isHead ? p.editorBg : p.text;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(cleanRef, labelX + 5, y);

        labelX += labelW + 4;
      }

      // Commit message
      ctx.font = FONT;
      ctx.fillStyle = isHover ? p.text : p.textDim;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const msgX = node.refs.length > 0 ? labelX + 4 : textX;
      const maxMsgW = w - msgX - 220;
      let msg = node.message;
      while (measureTextWidth(msg, FONT) > maxMsgW && msg.length > 10) {
        msg = msg.slice(0, -4) + "...";
      }
      ctx.fillText(msg, msgX, y);

      // Hash
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.fillStyle = p.textMuted;
      ctx.textAlign = "right";
      ctx.fillText(node.short_hash, w - 120, y);

      // Date
      ctx.font = LABEL_FONT;
      ctx.fillStyle = p.surface2;
      ctx.fillText(node.date, w - 10, y);
    }

    // --- Header ---
    ctx.fillStyle = p.gutterBg;
    ctx.fillRect(0, 0, w, 28);
    ctx.font = '12px "Courier New", Courier, monospace';
    ctx.fillStyle = p.textMuted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("COMMIT GRAPH", 12, 14);
    ctx.textAlign = "right";
    ctx.fillText(`${nodes.length} commits`, w - 12, 14);

    // Separator
    ctx.strokeStyle = p.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 28);
    ctx.lineTo(w, 28);
    ctx.stroke();
    } // end if nodes.length > 0
  }

  async function loadCommits() {
    if (!props.workspaceRoot) return;
    try {
      const data = await gitLogGraph(props.workspaceRoot, 200);
      setCommits(data);
      scheduleRedraw();
    } catch (err) {
      console.error("Failed to load git log:", err);
    }
  }

  function handleScroll(e: WheelEvent) {
    e.preventDefault();
    const totalHeight = commits().length * ROW_HEIGHT + 28;
    const maxScroll = Math.max(0, totalHeight - canvasHeight());
    setScrollTop(Math.max(0, Math.min(scrollTop() + e.deltaY, maxScroll)));
    scheduleRedraw();
  }

  function handleMouseMove(e: MouseEvent) {
    if (!containerRef) return;
    const rect = containerRef.getBoundingClientRect();
    const y = e.clientY - rect.top + scrollTop() - 28;
    const idx = Math.floor(y / ROW_HEIGHT);
    setHoverIdx(idx >= 0 && idx < commits().length ? idx : -1);
    scheduleRedraw();
  }

  function handleResize() {
    if (!containerRef) return;
    setCanvasWidth(containerRef.clientWidth);
    setCanvasHeight(containerRef.clientHeight);
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
    if (!containerRef) return;
    handleResize();
    const obs = new ResizeObserver(handleResize);
    obs.observe(containerRef);

    if (props.active) loadCommits();

    onCleanup(() => {
      cancelAnimationFrame(animId);
      obs.disconnect();
    });
  });

  return (
    <div
      ref={containerRef}
      class="git-graph"
      style={{ display: props.active ? "block" : "none" }}
      onWheel={handleScroll}
      onMouseMove={handleMouseMove}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
};

export default GitGraph;
