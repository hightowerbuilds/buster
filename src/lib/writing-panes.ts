/** Stable pane layout. Documents/terminals retain their tab IDs and lifetimes. */
export type PaneDirection = "left" | "right" | "up" | "down";
export type PaneNode = { kind: "pane"; id: string } | {
  kind: "split"; id: string; axis: "row" | "column"; ratio: number; first: PaneNode; second: PaneNode;
};
export interface WritingPane { id: string; tabId: string | null }
export interface PaneWorkspace {
  version: 1; layout: PaneNode; panes: WritingPane[]; activePaneId: string; zoomedPaneId: string | null;
}
export const MAX_PANES = 6;
export const PANE_GAP = 5;
export const MIN_PANE_WIDTH = 240;
export const MIN_PANE_HEIGHT = 180;
export interface PaneRect { id: string; x: number; y: number; width: number; height: number }
export interface PaneDivider extends PaneRect { axis: "row" | "column"; span: number; minRatio: number; maxRatio: number }
const id = () => crypto.randomUUID();
export function newPaneWorkspace(tabId: string | null = null): PaneWorkspace {
  const paneId = id();
  return { version: 1, layout: { kind: "pane", id: paneId }, panes: [{ id: paneId, tabId }], activePaneId: paneId, zoomedPaneId: null };
}
export function paneMinimum(node: PaneNode): { width: number; height: number } {
  if (node.kind === "pane") return { width: MIN_PANE_WIDTH, height: MIN_PANE_HEIGHT };
  const a = paneMinimum(node.first), b = paneMinimum(node.second);
  return node.axis === "row" ? { width: a.width + b.width + PANE_GAP, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height + PANE_GAP };
}
export function paneGeometry(layout: PaneNode, width: number, height: number) {
  const panes: PaneRect[] = [], dividers: PaneDivider[] = [];
  const minimum = paneMinimum(layout);
  const visit = (node: PaneNode, rect: Omit<PaneRect, "id">) => {
    if (node.kind === "pane") { panes.push({ id: node.id, ...rect }); return; }
    const row = node.axis === "row";
    const span = (row ? rect.width : rect.height) - PANE_GAP;
    const a = paneMinimum(node.first), b = paneMinimum(node.second);
    const minRatio = (row ? a.width : a.height) / span;
    const maxRatio = 1 - (row ? b.width : b.height) / span;
    const ratio = Math.max(minRatio, Math.min(maxRatio, node.ratio));
    const firstSpan = span * ratio;
    dividers.push({ id: node.id, axis: node.axis, span, minRatio, maxRatio,
      x: rect.x + (row ? firstSpan : 0), y: rect.y + (row ? 0 : firstSpan),
      width: row ? PANE_GAP : rect.width, height: row ? rect.height : PANE_GAP });
    visit(node.first, { ...rect, width: row ? firstSpan : rect.width, height: row ? rect.height : firstSpan });
    visit(node.second, { x: rect.x + (row ? firstSpan + PANE_GAP : 0), y: rect.y + (row ? 0 : firstSpan + PANE_GAP),
      width: row ? span - firstSpan : rect.width, height: row ? rect.height : span - firstSpan });
  };
  visit(layout, { x: 0, y: 0, width: Math.max(width, minimum.width), height: Math.max(height, minimum.height) });
  return { panes, dividers, minimum };
}
function mapNode(node: PaneNode, replace: (node: PaneNode) => PaneNode): PaneNode {
  const next = replace(node);
  if (next !== node || node.kind === "pane") return next;
  return { ...node, first: mapNode(node.first, replace), second: mapNode(node.second, replace) };
}
export function requirePane(workspace: PaneWorkspace, paneId: string): WritingPane {
  const pane = workspace.panes.find(p => p.id === paneId);
  if (!pane) throw new Error("Pane no longer exists.");
  return pane;
}
export function showTabInPane(workspace: PaneWorkspace, tabId: string, paneId = workspace.activePaneId): PaneWorkspace {
  requirePane(workspace, paneId);
  // One live view per document in this first increment. Focus its existing pane.
  const existing = workspace.panes.find(p => p.tabId === tabId);
  const target = existing?.id ?? paneId;
  return { ...workspace, activePaneId: target, zoomedPaneId: workspace.zoomedPaneId ? target : null,
    panes: existing ? workspace.panes : workspace.panes.map(p => p.id === target ? { ...p, tabId } : p) };
}
export function splitWritingPane(workspace: PaneWorkspace, direction: PaneDirection, paneId = workspace.activePaneId): PaneWorkspace {
  requirePane(workspace, paneId);
  if (workspace.panes.length >= MAX_PANES) throw new Error(`The workspace supports up to ${MAX_PANES} panes.`);
  const nextId = id();
  const before = direction === "left" || direction === "up";
  const newLeaf: PaneNode = { kind: "pane", id: nextId };
  return { ...workspace, activePaneId: nextId, zoomedPaneId: null,
    panes: [...workspace.panes, { id: nextId, tabId: null }],
    layout: mapNode(workspace.layout, node => node.kind === "pane" && node.id === paneId
      ? { kind: "split", id: id(), axis: direction === "left" || direction === "right" ? "row" : "column",
        ratio: 0.5, first: before ? newLeaf : node, second: before ? node : newLeaf } : node) };
}
export function closeWritingPane(workspace: PaneWorkspace, paneId: string): PaneWorkspace {
  requirePane(workspace, paneId);
  if (workspace.panes.length === 1) return { ...workspace, panes: [{ id: paneId, tabId: null }], zoomedPaneId: null };
  const remove = (node: PaneNode): PaneNode | null => {
    if (node.kind === "pane") return node.id === paneId ? null : node;
    const first = remove(node.first), second = remove(node.second);
    return !first ? second : !second ? first : { ...node, first, second };
  };
  const panes = workspace.panes.filter(p => p.id !== paneId);
  return { ...workspace, panes, layout: remove(workspace.layout)!, zoomedPaneId: null,
    activePaneId: workspace.activePaneId === paneId ? panes[0].id : workspace.activePaneId };
}
export function resizePaneSplit(workspace: PaneWorkspace, splitId: string, ratio: number): PaneWorkspace {
  if (!Number.isFinite(ratio)) throw new Error("Resize ratio must be finite.");
  let found = false;
  const layout = mapNode(workspace.layout, node => {
    if (node.kind !== "split" || node.id !== splitId) return node;
    found = true;
    return { ...node, ratio: Math.max(0.1, Math.min(0.9, ratio)) };
  });
  if (!found) throw new Error("Split no longer exists.");
  return { ...workspace, layout };
}
export function adjacentPane(workspace: PaneWorkspace, direction: PaneDirection): string | null {
  const rects = paneGeometry(workspace.layout, 1200, 800).panes;
  const active = rects.find(r => r.id === workspace.activePaneId)!;
  const cx = active.x + active.width / 2, cy = active.y + active.height / 2;
  const candidates = rects.filter(r => r.id !== active.id).map(r => {
    const dx = r.x + r.width / 2 - cx, dy = r.y + r.height / 2 - cy;
    const primary = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    return { id: r.id, primary, score: primary + cross * 2 };
  }).filter(r => r.primary > 0).sort((a, b) => a.score - b.score);
  return candidates[0]?.id ?? null;
}
export function resizeActivePane(workspace: PaneWorkspace, direction: PaneDirection, amount = 0.05): PaneWorkspace {
  const contains = (node: PaneNode): boolean => node.kind === "pane" ? node.id === workspace.activePaneId : contains(node.first) || contains(node.second);
  const row = direction === "left" || direction === "right";
  const before = direction === "left" || direction === "up";
  const find = (node: PaneNode): string | null => {
    if (node.kind === "pane") return null;
    const inFirst = contains(node.first);
    const nested = find(inFirst ? node.first : node.second);
    if (nested) return nested;
    return node.axis === (row ? "row" : "column") && inFirst !== before ? node.id : null;
  };
  const splitId = find(workspace.layout);
  if (!splitId) return workspace;
  let ratio = 0.5;
  mapNode(workspace.layout, n => { if (n.kind === "split" && n.id === splitId) ratio = n.ratio; return n; });
  return resizePaneSplit(workspace, splitId, ratio + (before ? -amount : amount));
}
/** Validate persisted layout before publishing it; unavailable documents become empty panes. */
export function restorePaneWorkspace(value: unknown, tabIds: Set<string>, activeTabId: string | null): PaneWorkspace {
  if (value == null) return newPaneWorkspace(activeTabId);
  const fail = (): never => { throw new Error("Invalid saved pane layout; session preserved."); };
  if (typeof value !== "object") return fail();
  const state = value as PaneWorkspace;
  if (state.version !== 1 || !Array.isArray(state.panes) || !state.panes.length || state.panes.length > MAX_PANES) return fail();
  const safeId = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length < 150 && !["__proto__", "constructor", "prototype"].includes(s);
  const ids = new Set<string>(), tabs = new Set<string>();
  const panes = state.panes.map(p => {
    if (!p || !safeId(p.id) || ids.has(p.id) || (p.tabId !== null && !safeId(p.tabId))) return fail();
    ids.add(p.id);
    if (p.tabId && tabs.has(p.tabId)) return fail();
    if (p.tabId) tabs.add(p.tabId);
    return { id: p.id, tabId: p.tabId && tabIds.has(p.tabId) ? p.tabId : null };
  });
  const seen = new Set<string>(), leaves = new Set<string>();
  const visit = (n: PaneNode, depth: number): PaneNode => {
    if (!n || depth > MAX_PANES || !safeId(n.id) || seen.has(n.id)) return fail();
    seen.add(n.id);
    if (n.kind === "pane") { if (!ids.has(n.id)) return fail(); leaves.add(n.id); return { kind: "pane", id: n.id }; }
    if (n.kind !== "split" || !["row", "column"].includes(n.axis) || !Number.isFinite(n.ratio) || n.ratio < 0.1 || n.ratio > 0.9) return fail();
    return { kind: "split", id: n.id, axis: n.axis, ratio: n.ratio, first: visit(n.first, depth + 1), second: visit(n.second, depth + 1) };
  };
  const layout = visit(state.layout, 0);
  if (leaves.size !== ids.size || !ids.has(state.activePaneId) || (state.zoomedPaneId !== null && state.zoomedPaneId !== state.activePaneId)) return fail();
  return { version: 1, layout, panes, activePaneId: state.activePaneId, zoomedPaneId: state.zoomedPaneId };
}
