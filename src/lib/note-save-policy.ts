import type { AppSettings } from "./ipc";
import { isMarkdownPath } from "../editor/writing-viewport";
import { isNotesPath } from "./notes-storage";
import { resolveEditorSettings } from "./editor-settings";

/** Notes always autosave; legacy code-file preferences remain compatible. */
export function autoSaveDelay(settings: AppSettings, path: string, notesRoot: string | null): number | null {
  if (!path) return null;
  if (isMarkdownPath(path) || isNotesPath(path, notesRoot)) return 500;
  const legacy = resolveEditorSettings(settings, path);
  return legacy.auto_save ? legacy.auto_save_delay_ms : null;
}
