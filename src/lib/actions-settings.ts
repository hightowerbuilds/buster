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
  let saveQueue = Promise.resolve();
  function updateSettings(newSettings: AppSettings) {
    setStore("settings", newSettings);
    const snapshot = JSON.parse(JSON.stringify(newSettings)) as AppSettings;
    saveQueue = saveQueue.then(() => saveSettingsIpc(snapshot)).catch(error => showError(`Settings were not saved: ${String(error)}`));
    document.documentElement.style.fontSize = `${newSettings.ui_zoom}%`;
    rebuildPalette(newSettings);
  }

  async function initSettings() {
    try {
      const s = await loadSettingsIpc();
      setStore("settings", s);
      if (s.ai_credential_error) showError(s.ai_credential_error);
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
