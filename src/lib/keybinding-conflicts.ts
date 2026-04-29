export interface KeybindingEntryLike {
  id: string;
  label: string;
  currentKey: string;
}

export interface KeybindingConflict {
  hotkey: string;
  commandIds: string[];
  labels: string[];
}

const MODIFIER_ORDER = ["Mod", "Ctrl", "Shift", "Alt", "Meta"];

function canonicalPart(part: string): string {
  const trimmed = part.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "cmd" || lower === "command" || lower === "ctrl" || lower === "control") return "Mod";
  if (lower === "mod") return "Mod";
  if (lower === "shift") return "Shift";
  if (lower === "alt" || lower === "option") return "Alt";
  if (lower === "meta") return "Meta";
  if (lower === "space") return "Space";
  if (lower === "esc") return "Escape";
  return trimmed.length === 1 ? trimmed.toLowerCase() : trimmed;
}

export function normalizeHotkey(hotkey: string): string {
  return hotkey
    .trim()
    .split(/\s+/)
    .map(normalizeHotkeyStroke)
    .filter(Boolean)
    .join(" ");
}

function normalizeHotkeyStroke(stroke: string): string {
  const parts = stroke
    .split("+")
    .map(canonicalPart)
    .filter(Boolean);
  if (parts.length === 0) return "";

  const modifiers = parts.filter((part) => MODIFIER_ORDER.includes(part));
  const key = parts.find((part) => !MODIFIER_ORDER.includes(part)) ?? "";
  const uniqueModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier));
  return [...uniqueModifiers, key].filter(Boolean).join("+");
}

export function findKeybindingConflicts(entries: KeybindingEntryLike[]): KeybindingConflict[] {
  const groups = new Map<string, KeybindingEntryLike[]>();
  for (const entry of entries) {
    const normalized = normalizeHotkey(entry.currentKey);
    if (!normalized) continue;
    const list = groups.get(normalized) ?? [];
    list.push(entry);
    groups.set(normalized, list);
  }

  return Array.from(groups.entries())
    .filter(([, entries]) => entries.length > 1)
    .map(([hotkey, entries]) => ({
      hotkey,
      commandIds: entries.map((entry) => entry.id),
      labels: entries.map((entry) => entry.label),
    }));
}
