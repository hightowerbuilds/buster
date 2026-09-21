import { describe, expect, it } from "vitest";
import type { AppSettings } from "./ipc";
import { resolveEditorSettings } from "./editor-settings";

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    word_wrap: true,
    font_size: 14,
    font_family: "JetBrains Mono, Menlo, Monaco, Consolas, monospace",
    tab_size: 4,
    use_spaces: true,
    minimap: false,
    line_numbers: true,
    cursor_blink: true,
    autocomplete: true,
    ui_zoom: 100,
    recent_folders: [],
    theme_mode: "dark",
    theme_hue: -1,
    effect_cursor_glow: 0,
    effect_vignette: 0,
    effect_grain: 0,
    keybindings: {},
    syntax_colors: {},
    format_on_save: false,
    auto_save: false,
    auto_save_delay_ms: 1500,
    language_settings: {},
    blog_theme: "normal",
    show_indent_guides: true,
    show_whitespace: false,
    terminal_font_family: "",
    terminal_shell: "",
    terminal_bell_mode: "visual",
    terminal_scrollback_rows: 10_000,
    ai_completion_enabled: false,
    ai_provider: "ollama",
    ai_api_key: "",
    ai_model: "claude-haiku-4-5-20250514",
    ai_local_model: "gemma3:4b",
    ai_ollama_url: "http://localhost:11434",
    ai_stop_on_newline: true,
    ai_debounce_local_ms: 1500,
    ai_debounce_cloud_ms: 500,
    ai_min_prefix_chars: 3,
    ai_cache_enabled: true,
    ai_cache_size: 24,
    ai_disabled_languages: [],
    ai_token_budget_monthly: 0,
    ...overrides,
  };
}

describe("resolveEditorSettings", () => {
  it("uses global editor settings when no language override exists", () => {
    expect(resolveEditorSettings(settings({ tab_size: 2, auto_save: true }), "/tmp/app.ts")).toMatchObject({
      languageId: "typescript",
      tab_size: 2,
      auto_save: true,
    });
  });

  it("applies language-specific overrides for matching file paths", () => {
    expect(resolveEditorSettings(settings({
      tab_size: 4,
      use_spaces: true,
      format_on_save: false,
      language_settings: {
        rust: {
          tab_size: 2,
          use_spaces: false,
          format_on_save: true,
        },
      },
    }), "/tmp/main.rs")).toMatchObject({
      languageId: "rust",
      tab_size: 2,
      use_spaces: false,
      format_on_save: true,
    });
  });

  it("clamps tiny auto-save delays", () => {
    expect(resolveEditorSettings(settings({
      auto_save_delay_ms: 100,
      language_settings: { javascript: { auto_save_delay_ms: 50 } },
    }), "/tmp/app.js").auto_save_delay_ms).toBe(250);
  });
});
