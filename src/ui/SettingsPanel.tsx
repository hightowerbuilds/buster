import { Component, For, Show, onCleanup, createSignal } from "solid-js";
import type { AppSettings } from "../lib/ipc";
import { useBuster } from "../lib/buster-context";
import { DEFAULT_KEYBINDINGS } from "../lib/app-commands";
import { findKeybindingConflicts, normalizeHotkey } from "../lib/keybinding-conflicts";
import { importVSCodeTheme, type ThemeEffects } from "../lib/theme";
import { showError, showSuccess } from "../lib/notify";
import { BLOG_THEMES } from "../lib/blog-themes";
import { LANGUAGE_DEFINITIONS } from "../editor/language-registry";
import type { EditorLanguageSettings } from "../lib/ipc";
import { DEFAULT_FONT_FAMILY } from "../editor/text-measure";
import { EDITABLE_SYNTAX_KEYS } from "../lib/theme";

interface SettingsPanelProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

// --- Unified setting item ---

type SettingsItem =
  | { id: string; type: "toggle"; key: keyof AppSettings; label: string; description: string }
  | { id: string; type: "number"; key: keyof AppSettings; label: string; description: string; min: number; max: number; step: number }
  | { id: string; type: "theme" }
  | { id: string; type: "font_family" }
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
  { id: "font_family", type: "font_family" },
  { id: "tab_size", type: "number", key: "tab_size", label: "Tab Size", description: "Number of spaces per tab stop", min: 1, max: 8, step: 1 },
  { id: "use_spaces", type: "toggle", key: "use_spaces", label: "Insert Spaces", description: "Indent with spaces instead of tab characters" },
  { id: "word_wrap", type: "toggle", key: "word_wrap", label: "Word Wrap", description: "Wrap long lines to fit the editor width" },
  { id: "format_on_save", type: "toggle", key: "format_on_save", label: "Format On Save", description: "Run LSP document formatting before saving files" },
  { id: "auto_save", type: "toggle", key: "auto_save", label: "Auto Save", description: "Automatically save dirty files after editing pauses" },
  { id: "auto_save_delay_ms", type: "number", key: "auto_save_delay_ms", label: "Auto Save Delay", description: "Milliseconds to wait after the last edit before saving", min: 500, max: 10000, step: 500 },
  { id: "line_numbers", type: "toggle", key: "line_numbers", label: "Line Numbers", description: "Show line numbers in the gutter" },
  { id: "autocomplete", type: "toggle", key: "autocomplete", label: "Autocomplete", description: "Suggest words as you type (Ctrl+Space to trigger)" },
  { id: "ui_zoom", type: "number", key: "ui_zoom", label: "UI Zoom", description: "Scale the entire interface (Cmd+/Cmd-)", min: 50, max: 200, step: 10 },
];

const LANGUAGE_SETTING_OPTIONS = LANGUAGE_DEFINITIONS
  .filter((language) => ["javascript", "typescript", "rust", "python", "go", "html", "css", "json", "markdown"].includes(language.id))
  .map((language) => ({ id: language.id, name: language.name }));

const FONT_PRESETS = [
  DEFAULT_FONT_FAMILY,
  "Menlo, Monaco, Consolas, monospace",
  "SF Mono, Menlo, Monaco, Consolas, monospace",
  "Fira Code, JetBrains Mono, monospace",
  "Cascadia Code, JetBrains Mono, monospace",
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

  const [selectedLanguage, setSelectedLanguage] = createSignal("typescript");

  function selectedLanguageOverride(): EditorLanguageSettings {
    return props.settings.language_settings?.[selectedLanguage()] ?? {};
  }

  function updateLanguageOverride<K extends keyof EditorLanguageSettings>(
    key: K,
    value: EditorLanguageSettings[K] | undefined,
  ) {
    const languageId = selectedLanguage();
    const languageSettings = { ...(props.settings.language_settings ?? {}) };
    const next = { ...(languageSettings[languageId] ?? {}) };

    if (value === undefined || value === null) delete next[key];
    else next[key] = value;

    if (Object.keys(next).length === 0) delete languageSettings[languageId];
    else languageSettings[languageId] = next;

    props.onChange({ ...props.settings, language_settings: languageSettings });
  }

  function activeOverrideCount(languageId: string): number {
    return Object.keys(props.settings.language_settings?.[languageId] ?? {}).length;
  }

  function OverrideButton(p: { active: boolean; label: string; onClick: () => void }) {
    return (
      <button
        class={`settings-theme-btn ${p.active ? "settings-theme-btn-active" : ""}`}
        onClick={p.onClick}
      >
        {p.label}
      </button>
    );
  }

  function renderBooleanOverride(
    key: keyof Pick<EditorLanguageSettings, "use_spaces" | "word_wrap" | "format_on_save" | "auto_save">,
    label: string,
    inheritLabel: string,
    trueLabel: string,
    falseLabel: string,
  ) {
    const current = () => selectedLanguageOverride()[key];
    return (
      <div class="language-override-row">
        <span>{label}</span>
        <div class="settings-theme-btns">
          <OverrideButton active={current() === undefined} label={`Inherit ${inheritLabel}`} onClick={() => updateLanguageOverride(key, undefined)} />
          <OverrideButton active={current() === true} label={trueLabel} onClick={() => updateLanguageOverride(key, true)} />
          <OverrideButton active={current() === false} label={falseLabel} onClick={() => updateLanguageOverride(key, false)} />
        </div>
      </div>
    );
  }

  function renderNumberOverride(
    key: keyof Pick<EditorLanguageSettings, "tab_size" | "auto_save_delay_ms">,
    label: string,
    inheritLabel: string,
    options: number[],
    suffix = "",
  ) {
    const current = () => selectedLanguageOverride()[key];
    return (
      <div class="language-override-row">
        <span>{label}</span>
        <div class="settings-theme-btns">
          <OverrideButton active={current() === undefined} label={`Inherit ${inheritLabel}`} onClick={() => updateLanguageOverride(key, undefined)} />
          <For each={options}>
            {(value) => (
              <OverrideButton
                active={current() === value}
                label={`${value}${suffix}`}
                onClick={() => updateLanguageOverride(key, value)}
              />
            )}
          </For>
        </div>
      </div>
    );
  }

  const themeHue = () => props.settings.theme_hue ?? -1;
  const themeMode = () => props.settings.theme_mode || "dark";

  function updateSyntaxColor(key: string, color: string | null) {
    const syntaxColors = { ...(props.settings.syntax_colors ?? {}) };
    if (!color) delete syntaxColors[key];
    else syntaxColors[key] = color;
    props.onChange({ ...props.settings, syntax_colors: syntaxColors });
  }

  function colorInputValue(color: string): string {
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#ffffff";
  }

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
      case "font_family": {
        const current = () => props.settings.font_family || DEFAULT_FONT_FAMILY;
        return (
          <div class="settings-row-content settings-font-content">
            <div class="settings-info">
              <span class="settings-label">Font Family</span>
              <span class="settings-desc">Monospace stack used by editor and terminal canvases</span>
            </div>
            <div class="settings-font-controls">
              <input
                class="settings-font-input"
                value={current()}
                spellcheck={false}
                onChange={(e) => update("font_family", e.currentTarget.value || DEFAULT_FONT_FAMILY)}
              />
              <div class="settings-font-presets">
                <For each={FONT_PRESETS}>
                  {(font) => (
                    <button
                      class={`settings-theme-btn ${current() === font ? "settings-theme-btn-active" : ""}`}
                      onClick={() => update("font_family", font)}
                    >
                      {font.split(",")[0]}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>
        );
      }
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
        <h2 class="settings-section-title">Syntax Token Colors</h2>
        <div class="settings-token-colors">
          <For each={[...EDITABLE_SYNTAX_KEYS]}>
            {(key) => {
              const value = () => colorInputValue(props.settings.syntax_colors?.[key] ?? palette().syntax[key] ?? palette().syntaxDefault);
              const isCustom = () => !!props.settings.syntax_colors?.[key];
              return (
                <div class="settings-token-row">
                  <span>{key}</span>
                  <input
                    type="color"
                    value={value()}
                    onInput={(e) => updateSyntaxColor(key, e.currentTarget.value)}
                    aria-label={`${key} color`}
                  />
                  <button
                    class="settings-token-reset"
                    disabled={!isCustom()}
                    onClick={() => updateSyntaxColor(key, null)}
                  >
                    reset
                  </button>
                </div>
              );
            }}
          </For>
        </div>

        <div class="settings-section-divider" />
        <h2 class="settings-section-title">Language Overrides</h2>
        <div class="settings-language-overrides">
          <div class="settings-language-list">
            <For each={LANGUAGE_SETTING_OPTIONS}>
              {(language) => (
                <button
                  class={`settings-language-btn ${selectedLanguage() === language.id ? "settings-language-btn-active" : ""}`}
                  onClick={() => setSelectedLanguage(language.id)}
                >
                  <span>{language.name}</span>
                  <Show when={activeOverrideCount(language.id) > 0}>
                    <small>{activeOverrideCount(language.id)}</small>
                  </Show>
                </button>
              )}
            </For>
          </div>
          <div class="settings-language-controls">
            {renderNumberOverride("tab_size", "Tab Size", `${props.settings.tab_size}`, [2, 4, 8])}
            {renderBooleanOverride("use_spaces", "Indent", props.settings.use_spaces ? "spaces" : "tabs", "Spaces", "Tabs")}
            {renderBooleanOverride("word_wrap", "Word Wrap", props.settings.word_wrap ? "on" : "off", "On", "Off")}
            {renderBooleanOverride("format_on_save", "Format On Save", props.settings.format_on_save ? "on" : "off", "On", "Off")}
            {renderBooleanOverride("auto_save", "Auto Save", props.settings.auto_save ? "on" : "off", "On", "Off")}
            {renderNumberOverride("auto_save_delay_ms", "Auto Save Delay", `${props.settings.auto_save_delay_ms}ms`, [500, 1500, 3000, 5000], "ms")}
          </div>
        </div>

        <div class="settings-section-divider" />
        <h2 class="settings-section-title">Keyboard Shortcuts</h2>
        <Show when={keybindingConflicts().length > 0}>
          <div class="keybinding-conflict-summary">
            {keybindingConflicts().length} shortcut conflict{keybindingConflicts().length === 1 ? "" : "s"} detected
          </div>
        </Show>

        <For each={keybindingEntries()}>
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
      </div>
    </div>
  );
};

export default SettingsPanel;
