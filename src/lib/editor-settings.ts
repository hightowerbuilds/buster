import { inferLanguageId } from "../editor/language-registry";
import type { AppSettings, EditorLanguageSettings } from "./ipc";

export interface EffectiveEditorSettings {
  languageId: string | null;
  tab_size: number;
  use_spaces: boolean;
  word_wrap: boolean;
  format_on_save: boolean;
  auto_save: boolean;
  auto_save_delay_ms: number;
}

const MIN_AUTO_SAVE_DELAY_MS = 250;

function numberOverride(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function boolOverride(value: boolean | null | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function languageSettingsForPath(
  settings: AppSettings,
  filePath: string | null,
): { languageId: string | null; override: EditorLanguageSettings } {
  const languageId = inferLanguageId(filePath);
  return {
    languageId,
    override: languageId ? settings.language_settings?.[languageId] ?? {} : {},
  };
}

export function resolveEditorSettings(
  settings: AppSettings,
  filePath: string | null,
): EffectiveEditorSettings {
  const { languageId, override } = languageSettingsForPath(settings, filePath);
  const delay = numberOverride(override.auto_save_delay_ms, settings.auto_save_delay_ms || 1500);

  return {
    languageId,
    tab_size: numberOverride(override.tab_size, settings.tab_size || 4),
    use_spaces: boolOverride(override.use_spaces, settings.use_spaces !== false),
    word_wrap: boolOverride(override.word_wrap, settings.word_wrap),
    format_on_save: boolOverride(override.format_on_save, settings.format_on_save),
    auto_save: boolOverride(override.auto_save, settings.auto_save),
    auto_save_delay_ms: Math.max(MIN_AUTO_SAVE_DELAY_MS, delay),
  };
}
