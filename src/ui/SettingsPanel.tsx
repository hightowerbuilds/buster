import BackgroundGallery from "./BackgroundGallery";
import { Component, For, Show, createSignal, createUniqueId } from "solid-js";
import type { AppSettings } from "../lib/ipc";
import { useBuster } from "../lib/buster-context";
import { DEFAULT_KEYBINDINGS } from "../lib/app-commands";
import { findKeybindingConflicts, normalizeHotkey } from "../lib/keybinding-conflicts";
import { importVSCodeTheme, type ThemeEffects } from "../lib/theme";
import { showError, showSuccess } from "../lib/notify";
import { BLOG_THEMES } from "../lib/blog-themes";

interface SettingsPanelProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

// --- Unified setting item ---

type SettingsItem =
  | { id: string; type: "number"; key: keyof AppSettings; label: string; description: string; min: number; max: number; step: number }
  | { id: string; type: "theme" | "blog_theme" };

const SETTINGS_TABS = ["Appearances", "Hotkeys"] as const;
type SettingsTab = typeof SETTINGS_TABS[number];

const SETTINGS_SECTIONS: { title: string; description?: string; items: SettingsItem[] }[] = [
  { title: "Appearance", items: [
    { id: "theme", type: "theme" },
    { id: "ui_zoom", type: "number", key: "ui_zoom", label: "Interface Size", description: "Make the whole app larger or smaller", min: 50, max: 200, step: 10 },
  ] },
  { title: "Writing", description: "Markdown notes save automatically after you pause typing, wherever they are stored.", items: [
    { id: "blog_theme", type: "blog_theme" },
    { id: "font_size", type: "number", key: "font_size", label: "Text Size", description: "Default text size for notes and shells; note appearance overrides can change it", min: 10, max: 32, step: 1 },
  ] },
];

const WRITING_SHORTCUT_LABELS: Record<string, string> = {
  "file.newFile": "New Note", "file.save": "Save", "file.saveAs": "Save As", "file.closeTab": "Close Tab",
  "file.openFolder": "Open Folder", "file.print": "Print",
  "view.commandPalette": "Find a Command or Document", "view.showCommands": "Show Commands",
  "view.settings": "Settings", "view.keybindings": "Keyboard Shortcuts", "view.toggleSidebar": "Show / Hide File Explorer",
  "editor.find": "Find in Note", "editor.zoomIn": "Increase Interface Size", "editor.zoomOut": "Decrease Interface Size",
  "editor.zoomReset": "Reset Interface Size", "view.focusNextRegion": "Focus Next Area", "view.focusPrevRegion": "Focus Previous Area",
};
const writingShortcut = (id: string) => id in WRITING_SHORTCUT_LABELS || id.startsWith("tabs.");

// --- Component ---

const SettingsPanel: Component<SettingsPanelProps> = (props) => {
  const { store } = useBuster();
  const palette = () => store.palette;
  const [activeTab, setActiveTab] = createSignal<SettingsTab>("Appearances");
  const tabId = createUniqueId();
  let body!: HTMLDivElement;
  function selectTab(tab: SettingsTab, focus = false) {
    setEditingKey(null);
    setActiveTab(tab);
    if (body) body.scrollTop = 0;
    if (focus) document.getElementById(`${tabId}-${tab}`)?.focus();
  }
  function moveTab(event: KeyboardEvent) {
    const index = SETTINGS_TABS.indexOf(activeTab());
    const next = event.key === "ArrowRight" ? (index + 1) % SETTINGS_TABS.length
      : event.key === "ArrowLeft" ? (index + SETTINGS_TABS.length - 1) % SETTINGS_TABS.length
      : event.key === "Home" ? 0 : event.key === "End" ? SETTINGS_TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); event.stopPropagation();
    selectTab(SETTINGS_TABS[next], true);
  }
  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    props.onChange({ ...props.settings, [key]: value });
  }

  const themeHue = () => props.settings.theme_hue ?? -1;
  const themeMode = () => props.settings.theme_mode || "dark";

  function renderItem(item: SettingsItem) {
    switch (item.type) {
      case "number":
        return (
          <div class="settings-row-content">
            <div class="settings-info">
              <span class="settings-label">{item.label}</span>
              <span class="settings-desc">{item.description}</span>
            </div>
            <div class="settings-number">
              <button
                class="settings-num-btn"
                onClick={() => {
                  const v = (props.settings[item.key] as number) - item.step;
                  if (v >= item.min) update(item.key, v);
                }}
              >-</button>
              <span class="settings-num-value">{props.settings[item.key] as number}</span>
              <button
                class="settings-num-btn"
                onClick={() => {
                  const v = (props.settings[item.key] as number) + item.step;
                  if (v <= item.max) update(item.key, v);
                }}
              >+</button>
            </div>
          </div>
        );
      case "theme":
        return (
          <div class="settings-row-content settings-theme-content">
            <div class="settings-row-inner">
              <div class="settings-info">
                <span class="settings-label">Color Scheme</span>
                <span class="settings-desc">Dark, Light, or custom</span>
              </div>
              <div class="settings-theme-btns">
                <button
                  class={`settings-theme-btn ${themeMode() === "dark" ? "settings-theme-btn-active" : ""}`}
                  onClick={() => { update("theme_mode", "dark"); update("theme_hue", -1); }}
                >Dark</button>
                <button
                  class={`settings-theme-btn ${themeMode() === "light" ? "settings-theme-btn-active" : ""}`}
                  onClick={() => { update("theme_mode", "light"); update("theme_hue", -1); }}
                >Light</button>
                <button
                  class={`settings-theme-btn ${themeMode() === "custom" ? "settings-theme-btn-active" : ""}`}
                  onClick={() => { update("theme_mode", "custom"); update("theme_hue", themeHue() >= 0 ? themeHue() : 200); }}
                >Custom</button>
                <button
                  class={`settings-theme-btn ${themeMode() === "imported" ? "settings-theme-btn-active" : ""}`}
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".json";
                    input.onchange = () => {
                      const file = input.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        try {
                          const json = JSON.parse(reader.result as string);
                          localStorage.setItem("buster-imported-theme", reader.result as string);
                          const fx: ThemeEffects = {
                            bgGlow: props.settings.effect_cursor_glow ?? 0,
                            cursorGlow: props.settings.effect_cursor_glow ?? 0,
                            vignette: props.settings.effect_vignette ?? 0,
                            grain: props.settings.effect_grain ?? 0,
                          };
                          importVSCodeTheme(json, fx);
                          update("theme_mode", "imported");
                          showSuccess("Theme imported");
                        } catch {
                          showError("Invalid theme file");
                        }
                      };
                      reader.readAsText(file);
                    };
                    input.click();
                  }}
                >Import</button>
              </div>
            </div>
            <Show when={themeMode() === "custom"}>
              <div class="settings-hue-row">
                <div class="settings-theme-preview">
                  <For each={[
                    palette().editorBg,
                    palette().surface0,
                    palette().border,
                    palette().textMuted,
                    palette().textDim,
                    palette().text,
                    palette().accent,
                    palette().accent2,
                    palette().cursor,
                  ].slice(0, 14)}>
                    {(color) => (
                      <div class="settings-swatch" style={{ background: color }} />
                    )}
                  </For>
                </div>
                <div class="settings-hue-controls">
                  <input
                    type="range"
                    class="settings-hue-slider"
                    min="0"
                    max="360"
                    step="1"
                    value={themeHue() >= 0 ? themeHue() : 200}
                    onInput={(e) => update("theme_hue", parseInt(e.currentTarget.value))}
                  />
                  <span class="settings-hue-value">{themeHue() >= 0 ? `${themeHue()}°` : "200°"}</span>
                </div>
              </div>
            </Show>
          </div>
        );
      case "blog_theme": {
        const current = () => props.settings.blog_theme || "normal";
        return (
          <div class="settings-row-content">
            <div class="settings-info">
              <span class="settings-label">Writing Style</span>
              <span class="settings-desc">Typography and styling for your notes</span>
            </div>
            <div class="settings-theme-btns">
              <For each={[...BLOG_THEMES]}>
                {(t) => (
                  <button
                    class={`settings-theme-btn ${current() === t.id ? "settings-theme-btn-active" : ""}`}
                    onClick={() => update("blog_theme", t.id)}
                  >{t.label}</button>
                )}
              </For>
            </div>
          </div>
        );
      }

    }
  }

  // ── Keybinding editor ──
  const [editingKey, setEditingKey] = createSignal<string | null>(null);
  const [recordedKey, setRecordedKey] = createSignal("");

  const userBindings = () => props.settings.keybindings ?? {};

  function formatHotkey(hotkey: string): string {
    return hotkey
      .replace(/Mod\+/g, navigator.platform.startsWith("Mac") ? "Cmd+" : "Ctrl+")
      .replace(/\+/g, " + ");
  }

  function formatCommandLabel(commandId: string): string {
    if (WRITING_SHORTCUT_LABELS[commandId]) return WRITING_SHORTCUT_LABELS[commandId];
    const tabMatch = commandId.match(/^tabs\.(\d+)$/);
    if (tabMatch) return `Go to Tab ${tabMatch[1]}`;
    if (commandId === "tabs.prev") return "Go to Previous Tab";
    if (commandId === "tabs.next") return "Go to Next Tab";
    return commandId.replace(/\./g, ": ").replace(/([A-Z])/g, " $1").trim();
  }

  function startRecording(commandId: string) {
    setEditingKey(commandId);
    setRecordedKey("");
  }

  function handleKeyRecord(e: KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { setEditingKey(null); return; }
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;

    const parts: string[] = [];
    if (e.metaKey) parts.push("Mod");
    else if (e.ctrlKey) parts.push("Mod");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");

    let key = e.key;
    if (key === " ") key = "Space";
    else if (key.length === 1) key = key.toLowerCase();
    parts.push(key);

    const combo = parts.join("+");
    setRecordedKey(combo);

    const commandId = editingKey()!;
    const newBindings = { ...userBindings(), [commandId]: combo };
    props.onChange({ ...props.settings, keybindings: newBindings });
    setEditingKey(null);
  }

  function resetBinding(commandId: string) {
    const newBindings = { ...userBindings() };
    delete newBindings[commandId];
    props.onChange({ ...props.settings, keybindings: newBindings });
  }

  const keybindingEntries = () => {
    return Object.entries(DEFAULT_KEYBINDINGS).map(([id, defaultKey]) => ({
      id,
      label: formatCommandLabel(id),
      defaultKey,
      currentKey: userBindings()[id] ?? defaultKey,
      isCustom: !!userBindings()[id],
    }));
  };

  const keybindingConflicts = () => findKeybindingConflicts(keybindingEntries());

  const conflictByCommand = () => {
    const map = new Map<string, { hotkey: string; labels: string[] }>();
    for (const conflict of keybindingConflicts()) {
      for (const commandId of conflict.commandIds) {
        map.set(commandId, { hotkey: conflict.hotkey, labels: conflict.labels });
      }
    }
    return map;
  };

  function conflictMessage(commandId: string): string | null {
    const conflict = conflictByCommand().get(commandId);
    if (!conflict) return null;
    const others = conflict.labels.filter((label) => label !== formatCommandLabel(commandId));
    return `${formatHotkey(conflict.hotkey)} also used by ${others.join(", ")}`;
  }

  return (
    <div class="settings-tab">
      <div class="settings-subtabs" role="tablist" aria-label="Settings categories">
        <For each={SETTINGS_TABS}>{tab => <button type="button" role="tab"
          id={`${tabId}-${tab}`} aria-controls={`${tabId}-panel`} aria-selected={activeTab() === tab}
          tabIndex={activeTab() === tab ? 0 : -1} onClick={() => selectTab(tab)} onKeyDown={moveTab}>
          {tab}
        </button>}</For>
      </div>
      <div ref={body} class="settings-body" role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${activeTab()}`} tabindex="0">
        <For each={activeTab() === "Appearances" ? SETTINGS_SECTIONS : []}>{section => <section aria-label={section.title}>
          <h2 class="settings-section-title">{section.title}</h2>
          <Show when={section.description}><p class="settings-section-description">{section.description}</p></Show>
          <For each={section.items}>{item => <div class="settings-row">{renderItem(item)}</div>}</For>
          <div class="settings-section-divider" />
        </section>}</For>
        <Show when={activeTab() === "Appearances"}><BackgroundGallery /></Show>
        <Show when={activeTab() === "Hotkeys"}>
        <h2 class="settings-section-title">Keyboard Shortcuts</h2>
        <Show when={keybindingConflicts().length > 0}>
          <div class="keybinding-conflict-summary">
            {keybindingConflicts().length} shortcut conflict{keybindingConflicts().length === 1 ? "" : "s"} detected
          </div>
        </Show>

        <For each={keybindingEntries().filter(entry => writingShortcut(entry.id))}>
          {(entry) => {
            const conflict = () => conflictMessage(entry.id);
            return (
            <div class={`settings-row keybinding-row${conflict() ? " keybinding-row-conflict" : ""}`}>
              <div class="keybinding-label">
                <span>{entry.label}</span>
                <Show when={conflict()}>
                  <span class="keybinding-conflict-text">{conflict()}</span>
                </Show>
              </div>
              <div class="keybinding-value">
                <Show when={editingKey() === entry.id} fallback={
                  <button
                    class={`keybinding-btn${entry.isCustom ? " keybinding-custom" : ""}${conflict() ? " keybinding-conflict" : ""}`}
                    onClick={() => startRecording(entry.id)}
                    title="Click to rebind"
                  >
                    {formatHotkey(normalizeHotkey(entry.currentKey))}
                  </button>
                }>
                  <input
                    class="keybinding-input"
                    placeholder="Press keys..."
                    value={recordedKey() ? formatHotkey(recordedKey()) : ""}
                    onKeyDown={handleKeyRecord}
                    ref={(el) => requestAnimationFrame(() => el.focus())}
                    onBlur={() => setEditingKey(null)}
                    readonly
                  />
                </Show>
                <Show when={entry.isCustom}>
                  <button
                    class="keybinding-reset"
                    onClick={() => resetBinding(entry.id)}
                    title={`Reset to default (${formatHotkey(entry.defaultKey)})`}
                  >
                    x
                  </button>
                </Show>
              </div>
            </div>
          )}}
        </For>
        </Show>
      </div>
    </div>
  );
};

export default SettingsPanel;
