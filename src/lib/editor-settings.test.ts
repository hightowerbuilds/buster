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
    line_numbers: true,
    cursor_blink: true,
    ui_zoom: 100,
    recent_folders: [],
    theme_mode: "dark",
    theme_hue: -1,
    effect_cursor_glow: 0,
    effect_vignette: 0,
    effect_grain: 0,
    keybindings: {},
    syntax_colors: {},
    auto_save: false,
    auto_save_delay_ms: 1500,
    language_settings: {},
    blog_theme: "normal",
    show_indent_guides: true,
    show_whitespace: false,
    ai_provider: "claude",
    spread_motion: "calm",
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
      language_settings: {
        rust: {
          tab_size: 2,
          use_spaces: false,
        },
      },
    }), "/tmp/main.rs")).toMatchObject({
      languageId: "rust",
      tab_size: 2,
      use_spaces: false,
    });
  });

  it("clamps tiny auto-save delays", () => {
    expect(resolveEditorSettings(settings({
      auto_save_delay_ms: 100,
      language_settings: { javascript: { auto_save_delay_ms: 50 } },
    }), "/tmp/app.js").auto_save_delay_ms).toBe(250);
  });
});
