import { Component, For, Show, onCleanup, createSignal } from "solid-js";
import type { AppSettings } from "../lib/ipc";
import { useBuster } from "../lib/buster-context";
import { DEFAULT_KEYBINDINGS } from "../lib/app-commands";
import { importVSCodeTheme, type ThemeEffects } from "../lib/theme";
import { showError, showSuccess } from "../lib/notify";
import { BLOG_THEMES } from "../lib/blog-themes";

interface SettingsPanelProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

// --- Unified setting item ---

type SettingsItem =
  | { id: string; type: "toggle"; key: keyof AppSettings; label: string; description: string }
  | { id: string; type: "number"; key: keyof AppSettings; label: string; description: string; min: number; max: number; step: number }
  | { id: string; type: "theme" }
  | { id: string; type: "effect"; key: keyof AppSettings; label: string; description: string }
  | { id: string; type: "blog_theme" }
;

// Color/visual settings first, then text/editor settings, then agent settings
const SETTINGS_ITEMS: SettingsItem[] = [
  // Color & Visual
  { id: "theme", type: "theme" },
  { id: "effect_cursor_glow", type: "effect", key: "effect_cursor_glow", label: "Cursor Glow", description: "Soft bloom around the text cursor" },
  { id: "effect_vignette", type: "effect", key: "effect_vignette", label: "Vignette", description: "Darken the edges of the editor" },
  { id: "effect_grain", type: "effect", key: "effect_grain", label: "Film Grain", description: "Subtle noise texture overlay" },
  { id: "minimap", type: "toggle", key: "minimap", label: "Minimap", description: "Show a minimap preview of the file" },
  { id: "blog_theme", type: "blog_theme" },
  // Text & Editor
  { id: "font_size", type: "number", key: "font_size", label: "Editor Font Size", description: "Font size for the code editor and terminal", min: 10, max: 32, step: 1 },
  { id: "tab_size", type: "number", key: "tab_size", label: "Tab Size", description: "Number of spaces per tab stop", min: 1, max: 8, step: 1 },
  { id: "word_wrap", type: "toggle", key: "word_wrap", label: "Word Wrap", description: "Wrap long lines to fit the editor width" },
  { id: "line_numbers", type: "toggle", key: "line_numbers", label: "Line Numbers", description: "Show line numbers in the gutter" },
  { id: "autocomplete", type: "toggle", key: "autocomplete", label: "Autocomplete", description: "Suggest words as you type (Ctrl+Space to trigger)" },
  { id: "ui_zoom", type: "number", key: "ui_zoom", label: "UI Zoom", description: "Scale the entire interface (Cmd+/Cmd-)", min: 50, max: 200, step: 10 },
];

// --- Canvas checkbox component ---
function mountCanvasCheckbox(canvas: HTMLCanvasElement, checked: boolean) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const size = 20;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  ctx.scale(dpr, dpr);
  drawCheckbox(ctx, size, checked);
}

function drawCheckbox(ctx: CanvasRenderingContext2D, size: number, checked: boolean) {
  ctx.clearRect(0, 0, size, size);
  const style = getComputedStyle(document.documentElement);
  const border = style.getPropertyValue("--border").trim() || "#45475a";
  const accent = style.getPropertyValue("--accent").trim() || "#89b4fa";
  const text = style.getPropertyValue("--text").trim() || "#cdd6f4";
  const surface = style.getPropertyValue("--bg-surface1").trim() || "#313244";

  ctx.fillStyle = checked ? accent : surface;
  ctx.fillRect(1, 1, size - 2, size - 2);
  ctx.strokeStyle = checked ? accent : border;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(1, 1, size - 2, size - 2);

  if (checked) {
    ctx.strokeStyle = text;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(5, 10);
    ctx.lineTo(8.5, 14);
    ctx.lineTo(15, 6);
    ctx.stroke();
  }
}

// --- Screen shake ---
function triggerQuake(canvas: HTMLCanvasElement) {
  const row = canvas.closest(".settings-row") as HTMLElement | null;
  if (!row) return;
  row.classList.remove("quake");
  void row.offsetWidth;
  row.classList.add("quake");
  row.addEventListener("animationend", () => row.classList.remove("quake"), { once: true });
}

// --- Component ---

const SettingsPanel: Component<SettingsPanelProps> = (props) => {
  const { store } = useBuster();
  const palette = () => store.palette;
  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    props.onChange({ ...props.settings, [key]: value });
  }

  const themeHue = () => props.settings.theme_hue ?? -1;
  const themeMode = () => props.settings.theme_mode || "dark";

  // Reusable checkbox renderer
  function Checkbox(p: { checked: boolean; onToggle: () => void }) {
    return (
      <canvas
        class="settings-checkbox"
        width="20"
        height="20"
        ref={(el) => {
          requestAnimationFrame(() => mountCanvasCheckbox(el, p.checked));
          let prev = p.checked;
          const interval = setInterval(() => {
            if (p.checked !== prev) { prev = p.checked; mountCanvasCheckbox(el, p.checked); }
          }, 60);
          onCleanup(() => clearInterval(interval));
        }}
        onClick={(e) => {
          p.onToggle();
          triggerQuake(e.currentTarget as HTMLCanvasElement);
        }}
      />
    );
  }

  function renderItem(item: SettingsItem) {
    switch (item.type) {
      case "toggle":
        return (
          <div class="settings-row-content">
            <div class="settings-info">
              <span class="settings-label">{item.label}</span>
              <span class="settings-desc">{item.description}</span>
            </div>
            <Checkbox
              checked={!!props.settings[item.key]}
              onToggle={() => update(item.key, !props.settings[item.key])}
            />
          </div>
        );
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
                    ...Object.values(palette().syntax).filter((_, i) => i % 3 === 0),
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
      case "effect": {
        const val = () => (props.settings[item.key] as number) ?? 0;
        return (
          <div class="settings-row-content">
            <div class="settings-info">
              <span class="settings-label">{item.label}</span>
              <span class="settings-desc">{item.description}</span>
            </div>
            <div class="settings-hue-controls">
              <input
                type="range"
                class="settings-effect-slider"
                min="0"
                max="100"
                step="5"
                value={val()}
                onInput={(e) => update(item.key, parseInt(e.currentTarget.value))}
              />
              <span class="settings-hue-value">{val() > 0 ? `${val()}%` : "off"}</span>
            </div>
          </div>
        );
      }
      case "blog_theme": {
        const current = () => props.settings.blog_theme || "normal";
        return (
          <div class="settings-row-content">
            <div class="settings-info">
              <span class="settings-label">Blog Mode Theme</span>
              <span class="settings-desc">Visual style when previewing markdown files</span>
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

  return (
    <div class="settings-tab">
      <div class="settings-header">
        <h1 class="settings-title">Settings</h1>
      </div>
      <div class="settings-body">
        <For each={SETTINGS_ITEMS}>
          {(item) => (
            <div class="settings-row">
              {renderItem(item)}
            </div>
          )}
        </For>

        <div class="settings-section-divider" />
        <h2 class="settings-section-title">Keyboard Shortcuts</h2>

        <For each={keybindingEntries()}>
          {(entry) => (
            <div class="settings-row keybinding-row">
              <div class="keybinding-label">{entry.label}</div>
              <div class="keybinding-value">
                <Show when={editingKey() === entry.id} fallback={
                  <button
                    class={`keybinding-btn${entry.isCustom ? " keybinding-custom" : ""}`}
                    onClick={() => startRecording(entry.id)}
                    title="Click to rebind"
                  >
                    {formatHotkey(entry.currentKey)}
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
          )}
        </For>
      </div>
    </div>
  );
};

export default SettingsPanel;
