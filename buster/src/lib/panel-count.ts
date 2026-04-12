export const PANEL_COUNTS = [1, 2, 3, 4, 5, 6] as const;

export type PanelCount = (typeof PANEL_COUNTS)[number];

const LEGACY_LAYOUTS: Record<string, PanelCount> = {
  tabs: 1,
  columns: 2,
  trio: 3,
  grid: 4,
  quint: 5,
  restack: 5,
  hq: 6,
  g1: 1,
  g2: 2,
  g3: 3,
  g4: 4,
  g5: 5,
  g6: 6,
};

export function clampPanelCount(value: number): PanelCount {
  const rounded = Math.round(Number.isFinite(value) ? value : 1);
  return Math.max(1, Math.min(6, rounded)) as PanelCount;
}

export function parsePanelCount(value: unknown): PanelCount {
  if (typeof value === "number") return clampPanelCount(value);
  if (typeof value !== "string") return 1;

  const normalized = value.trim().toLowerCase();
  const mapped = LEGACY_LAYOUTS[normalized];
  if (mapped) return mapped;

  const match = normalized.match(/^g?([1-6])$/);
  if (match) return clampPanelCount(Number(match[1]));

  return 1;
}

export function serializePanelCount(count: PanelCount): string {
  return `g${count}`;
}

export function panelLabel(count: PanelCount): string {
  return `g${count}`;
}

export function panelDescription(count: PanelCount): string {
  switch (count) {
    case 1:
      return "Single panel";
    case 2:
      return "Two columns";
    case 3:
      return "Trio";
    case 4:
      return "Grid";
    case 5:
      return "Five panels";
    case 6:
      return "Six panels";
    default:
      return "Single panel";
  }
}

export function autoDemotePanelCount(current: PanelCount, tabCount: number): PanelCount {
  const next = clampPanelCount(tabCount);
  return next < current ? next : current;
}
