import { Component, For, Show, createMemo } from "solid-js";
import type { AppSettings } from "../lib/ipc";
import { DEFAULT_KEYBINDINGS, resolveHotkey } from "../lib/app-commands";
import { registry } from "../lib/command-registry";
import { findKeybindingConflicts, normalizeHotkey } from "../lib/keybinding-conflicts";

interface KeybindingsPanelProps {
  settings: AppSettings;
}

interface ShortcutEntry {
  id: string;
  label: string;
  category: string;
  currentKey: string;
  isCustom: boolean;
}

function formatHotkey(hotkey: string): string {
  return hotkey
    .split(" ")
    .map((part) => part
      .replace(/Mod\+/g, navigator.platform.startsWith("Mac") ? "Cmd+" : "Ctrl+")
      .replace(/\+/g, " + "))
    .join(", ");
}

function formatCommandLabel(commandId: string): string {
  const tabMatch = commandId.match(/^tabs\.(\d+)$/);
  if (tabMatch) return `Go to Tab ${tabMatch[1]}`;
  if (commandId === "tabs.prev") return "Go to Previous Tab";
  if (commandId === "tabs.next") return "Go to Next Tab";
  return commandId.replace(/\./g, ": ").replace(/([A-Z])/g, " $1").trim();
}

const CATEGORY_ORDER = ["File", "Editor", "View", "Terminal", "Git", "Browser", "Tabs"];

const KeybindingsPanel: Component<KeybindingsPanelProps> = (props) => {
  const entries = createMemo<ShortcutEntry[]>(() => {
    const commands = new Map(registry.getAll().map((command) => [command.id, command]));
    return Object.entries(DEFAULT_KEYBINDINGS)
      .map(([id, defaultKey]) => {
        const command = commands.get(id);
        return {
          id,
          label: command?.label ?? formatCommandLabel(id),
          category: command?.category ?? "Other",
          currentKey: resolveHotkey(id, props.settings.keybindings) ?? defaultKey,
          isCustom: !!props.settings.keybindings?.[id],
        };
      })
      .sort((a, b) => {
        const categoryDiff =
          (CATEGORY_ORDER.indexOf(a.category) === -1 ? 999 : CATEGORY_ORDER.indexOf(a.category)) -
          (CATEGORY_ORDER.indexOf(b.category) === -1 ? 999 : CATEGORY_ORDER.indexOf(b.category));
        if (categoryDiff !== 0) return categoryDiff;
        return a.label.localeCompare(b.label);
      });
  });

  const conflicts = createMemo(() => findKeybindingConflicts(entries()));
  const conflictIds = createMemo(() => new Set(conflicts().flatMap((conflict) => conflict.commandIds)));
  const categories = createMemo(() => {
    const grouped = new Map<string, ShortcutEntry[]>();
    for (const entry of entries()) {
      const list = grouped.get(entry.category) ?? [];
      list.push(entry);
      grouped.set(entry.category, list);
    }
    return Array.from(grouped.entries()).map(([category, items]) => ({ category, items }));
  });

  return (
    <div class="keybindings-panel">
      <div class="keybindings-header">
        <h2>Keyboard Shortcuts</h2>
        <div class="keybindings-chord">Cmd+K, Cmd+S</div>
      </div>
      <Show when={conflicts().length > 0}>
        <div class="keybindings-warning">
          {conflicts().length} conflict{conflicts().length === 1 ? "" : "s"} detected in current bindings
        </div>
      </Show>
      <div class="keybindings-list">
        <For each={categories()}>
          {(group) => (
            <section class="keybindings-section">
              <h3>{group.category}</h3>
              <For each={group.items}>
                {(entry) => (
                  <div class={`keybindings-item${conflictIds().has(entry.id) ? " keybindings-item-conflict" : ""}`}>
                    <div class="keybindings-command">
                      <span>{entry.label}</span>
                      <Show when={entry.isCustom}>
                        <small>custom</small>
                      </Show>
                    </div>
                    <kbd>{formatHotkey(normalizeHotkey(entry.currentKey))}</kbd>
                  </div>
                )}
              </For>
            </section>
          )}
        </For>
      </div>
    </div>
  );
};

export default KeybindingsPanel;
