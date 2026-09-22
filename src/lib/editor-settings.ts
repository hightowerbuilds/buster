import type { AppSettings } from "./ipc";

export interface EffectiveEditorSettings {
  tab_size: number;
  use_spaces: boolean;
  word_wrap: boolean;
  auto_save: boolean;
  auto_save_delay_ms: number;
}

const MIN_AUTO_SAVE_DELAY_MS = 250;

/** Editor settings with defaults filled in for unset or out-of-range values. */
export function resolveEditorSettings(settings: AppSettings): EffectiveEditorSettings {
  return {
    tab_size: settings.tab_size || 4,
    use_spaces: settings.use_spaces !== false,
    word_wrap: settings.word_wrap,
    auto_save: settings.auto_save,
    auto_save_delay_ms: Math.max(MIN_AUTO_SAVE_DELAY_MS, settings.auto_save_delay_ms || 1500),
  };
}
