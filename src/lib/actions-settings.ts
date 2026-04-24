import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import type { AppSettings } from "./ipc";
import { loadSettings as loadSettingsIpc, saveSettings as saveSettingsIpc } from "./ipc";
import { showError } from "./notify";

const RECENT_FILES_KEY = "buster-recent-files";
const MAX_RECENT_FILES = 20;

export function createSettingsActions(
  store: BusterStoreState,
  setStore: SetStoreFunction<BusterStoreState>,
  rebuildPalette: (s: AppSettings) => void,
) {
  function updateSettings(newSettings: AppSettings) {
    setStore("settings", newSettings);
    saveSettingsIpc(newSettings).catch(() => showError("Failed to save settings"));
    document.documentElement.style.fontSize = `${newSettings.ui_zoom}%`;
    rebuildPalette(newSettings);
  }

  async function initSettings() {
    try {
      const s = await loadSettingsIpc();
      setStore("settings", s);
      document.documentElement.style.fontSize = `${s.ui_zoom}%`;
      rebuildPalette(s);
    } catch (e) { console.warn("Failed to load settings:", e); }
  }

  function addRecentFile(path: string, name: string) {
    const filtered = store.recentFiles.filter(f => f.path !== path);
    const next = [{ path, name }, ...filtered].slice(0, MAX_RECENT_FILES);
    setStore("recentFiles", next);
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next));
  }

  return { updateSettings, initSettings, addRecentFile };
}
