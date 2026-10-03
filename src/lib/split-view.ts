export type SplitSide = "left" | "right";

export interface SplitView {
  leftTabId: string;
  rightTabId: string;
  ratio: number;
}

export function clampSplitRatio(ratio: number): number {
  return Number.isFinite(ratio) ? Math.min(0.75, Math.max(0.25, ratio)) : 0.5;
}

export function splitSide(view: SplitView, tabId: string | null): SplitSide | null {
  return view.leftTabId === tabId ? "left" : view.rightTabId === tabId ? "right" : null;
}

/** Invalid or unavailable pairs fall back to a single tab without losing notes. */
export function restoreSplitView(value: unknown, tabIds: Set<string>): SplitView | null {
  if (!value || typeof value !== "object") return null;
  const view = value as Partial<SplitView>;
  if (typeof view.leftTabId !== "string" || typeof view.rightTabId !== "string"
    || view.leftTabId === view.rightTabId || !tabIds.has(view.leftTabId) || !tabIds.has(view.rightTabId)) return null;
  return { leftTabId: view.leftTabId, rightTabId: view.rightTabId,
    ratio: clampSplitRatio(typeof view.ratio === "number" ? view.ratio : 0.5) };
}
