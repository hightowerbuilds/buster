import { describe, expect, it } from "vitest";
import type { AppSettings } from "../lib/ipc";
import {
  buildAiCompletionContext,
  makeAiCompletionCacheKey,
  shouldRequestAiCompletion,
} from "./editor-ghost-text";

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
    ai_completion_enabled: true,
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

describe("AI ghost text helpers", () => {
  it("builds bounded prefix and suffix context around the cursor", () => {
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`);
    const context = buildAiCompletionContext(lines, 60, 4);

    expect(context.prefix.startsWith("line 10")).toBe(true);
    expect(context.prefix.endsWith("line")).toBe(true);
    expect(context.suffix.startsWith(" 60")).toBe(true);
    expect(context.suffix.endsWith("line 70")).toBe(true);
  });

  it("skips disabled languages and short prefixes", () => {
    expect(shouldRequestAiCompletion(settings(), "/tmp/app.ts", "typescript", "co")).toBe(false);
    expect(shouldRequestAiCompletion(settings({ ai_disabled_languages: ["markdown"] }), "/tmp/a.md", "markdown", "content")).toBe(false);
    expect(shouldRequestAiCompletion(settings(), "/tmp/app.ts", "typescript", "const")).toBe(true);
  });

  it("includes provider model cursor and context in the cache key", () => {
    const first = makeAiCompletionCacheKey({
      provider: "ollama",
      model: "gemma3:4b",
      filePath: "/tmp/app.ts",
      languageId: "typescript",
      line: 1,
      col: 2,
      prefix: "const",
      suffix: "",
    });
    const second = makeAiCompletionCacheKey({
      provider: "ollama",
      model: "gemma3:4b",
      filePath: "/tmp/app.ts",
      languageId: "typescript",
      line: 1,
      col: 3,
      prefix: "const",
      suffix: "",
    });

    expect(first).not.toEqual(second);
  });
});
