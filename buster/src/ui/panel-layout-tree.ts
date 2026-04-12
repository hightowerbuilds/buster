import type { PanelCount } from "../lib/panel-count";

export type PanelLayoutNode = PanelLeafNode | PanelSplitNode;
export type PanelSplitDirection = "row" | "column";

export interface PanelLeafNode {
  kind: "leaf";
  tabIndex: number;
}

export interface PanelSplitNode {
  kind: "split";
  direction: PanelSplitDirection;
  children: PanelLayoutNode[];
  sizes?: number[];
}

export interface PanelRect {
  tabIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function leaf(tabIndex: number): PanelLeafNode {
  return { kind: "leaf", tabIndex };
}

function split(
  direction: PanelSplitDirection,
  children: PanelLayoutNode[],
  sizes?: number[],
): PanelSplitNode {
  return { kind: "split", direction, children, sizes };
}

export function createPanelLayoutTree(count: PanelCount): PanelLayoutNode {
  switch (count) {
    case 1:
      return leaf(0);
    case 2:
      return split("row", [leaf(0), leaf(1)]);
    case 3:
      return split("row", [leaf(0), split("column", [leaf(1), leaf(2)])], [60, 40]);
    case 4:
      return split("column", [
        split("row", [leaf(0), leaf(1)]),
        split("row", [leaf(2), leaf(3)]),
      ]);
    case 5:
      return split("row", [
        leaf(0),
        split("column", [
          split("row", [leaf(1), leaf(2)]),
          split("row", [leaf(3), leaf(4)]),
        ]),
      ], [36, 64]);
    case 6:
      return split("column", [
        split("row", [leaf(0), leaf(1), leaf(2)]),
        split("row", [leaf(3), leaf(4), leaf(5)]),
      ]);
    default:
      return leaf(0);
  }
}

export function normalizedSplitSizes(node: Pick<PanelSplitNode, "children" | "sizes">): number[] {
  const childCount = node.children.length;
  if (childCount === 0) return [];

  const provided = node.sizes;
  if (provided && provided.length === childCount) {
    const total = provided.reduce((sum, size) => sum + Math.max(size, 0), 0);
    if (total > 0) return provided.map((size) => (Math.max(size, 0) / total) * 100);
  }

  return Array.from({ length: childCount }, () => 100 / childCount);
}

export function collectPanelRects(
  node: PanelLayoutNode,
  bounds: RectBounds,
  gap: number = 0,
): PanelRect[] {
  if (node.kind === "leaf") {
    return [{ tabIndex: node.tabIndex, ...bounds }];
  }

  const rects: PanelRect[] = [];
  const sizes = normalizedSplitSizes(node);
  const horizontal = node.direction === "row";
  const totalGap = gap * Math.max(0, node.children.length - 1);
  const available = Math.max(
    0,
    (horizontal ? bounds.width : bounds.height) - totalGap,
  );

  let offset = horizontal ? bounds.x : bounds.y;
  let remaining = available;

  node.children.forEach((child, index) => {
    const isLast = index === node.children.length - 1;
    const span = isLast ? remaining : (available * sizes[index]!) / 100;
    const childBounds: RectBounds = horizontal
      ? { x: offset, y: bounds.y, width: span, height: bounds.height }
      : { x: bounds.x, y: offset, width: bounds.width, height: span };

    rects.push(...collectPanelRects(child, childBounds, gap));

    offset += span + gap;
    remaining -= span;
  });

  return rects;
}
