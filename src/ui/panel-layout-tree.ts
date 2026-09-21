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

export function leaf(tabIndex: number): PanelLeafNode {
  return { kind: "leaf", tabIndex };
}

export function split(
  direction: PanelSplitDirection,
  children: PanelLayoutNode[],
  sizes?: number[],
): PanelSplitNode {
  return { kind: "split", direction, children, sizes };
}

/** Default layouts used by the layout picker previews. */
export function createPanelLayoutTree(count: number): PanelLayoutNode {
  const size = Math.max(1, Math.min(6, Math.round(Number.isFinite(count) ? count : 1)));
  if (size === 1) return leaf(0);
  if (size <= 3) return split("row", Array.from({ length: size }, (_, index) => leaf(index)));
  const topCount = Math.ceil(size / 2);
  return split("column", [
    split("row", Array.from({ length: topCount }, (_, index) => leaf(index))),
    split("row", Array.from({ length: size - topCount }, (_, index) => leaf(topCount + index))),
  ]);
}

/** Count the number of leaves in the tree. */
export function countLeaves(node: PanelLayoutNode): number {
  if (node.kind === "leaf") return 1;
  return node.children.reduce((sum, child) => sum + countLeaves(child), 0);
}

/**
 * Split a leaf node in the tree, replacing it with a split containing
 * the original leaf and a new leaf.
 * Returns a new tree (immutable).
 */
export function splitLeaf(
  node: PanelLayoutNode,
  targetIndex: number,
  direction: PanelSplitDirection,
  newIndex: number,
): PanelLayoutNode {
  if (node.kind === "leaf") {
    if (node.tabIndex === targetIndex) {
      return split(direction, [leaf(targetIndex), leaf(newIndex)]);
    }
    return node;
  }

  // If this split has the same direction, and the target leaf is a direct child,
  // just add the new leaf next to it instead of nesting
  if (node.direction === direction) {
    const idx = node.children.findIndex(
      (c) => c.kind === "leaf" && c.tabIndex === targetIndex,
    );
    if (idx >= 0) {
      const newChildren = [...node.children];
      newChildren.splice(idx + 1, 0, leaf(newIndex));
      return split(direction, newChildren);
    }
  }

  // Recurse into children
  return split(
    node.direction,
    node.children.map((child) => splitLeaf(child, targetIndex, direction, newIndex)),
    node.sizes,
  );
}

/**
 * Remove a leaf from the tree.
 * If a split node ends up with only one child, unwrap it.
 * Returns null if the tree is empty after removal.
 */
export function removeLeaf(
  node: PanelLayoutNode,
  targetIndex: number,
): PanelLayoutNode | null {
  if (node.kind === "leaf") {
    return node.tabIndex === targetIndex ? null : node;
  }

  const newChildren = node.children
    .map((child) => removeLeaf(child, targetIndex))
    .filter((child): child is PanelLayoutNode => child !== null);

  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];
  return split(node.direction, newChildren);
}

/** Shift all tabIndex values above `removedIdx` down by 1. */
export function reindexAfterRemoval(node: PanelLayoutNode, removedIdx: number): PanelLayoutNode {
  if (node.kind === "leaf") {
    if (node.tabIndex > removedIdx) return leaf(node.tabIndex - 1);
    return node;
  }
  return split(node.direction, node.children.map((c) => reindexAfterRemoval(c, removedIdx)));
}

/** Collect all tab indices in the tree in order. */
export function collectTabIndices(node: PanelLayoutNode): number[] {
  if (node.kind === "leaf") return [node.tabIndex];
  return node.children.flatMap(collectTabIndices);
}

// ── Layout rect computation ─────────────────────────────────

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
