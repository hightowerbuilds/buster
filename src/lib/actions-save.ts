import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import type { EngineMap } from "./buster-context";
import type { Tab } from "./tab-types";
import type { EditorEngine } from "../editor/engine";
import { basename } from "buster-path";
import { writeFile, lspDidChange, lspDidSave, lspFormatDocument } from "./ipc";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { showError, showSuccess } from "./notify";
import { setRefreshDir } from "../ui/SidebarTree";
import { resolveEditorSettings } from "./editor-settings";
import { applyTextEdits } from "../editor/apply-text-edits";
import { formatJsonEngine } from "../editor/json-format";

export function createSaveActions(
  store: BusterStoreState,
  setStore: SetStoreFunction<BusterStoreState>,
  engines: EngineMap,
  activeTab: () => Tab | undefined,
  addRecentFile: (path: string, name: string) => void,
  fetchDiffHunks: (tabId: string, filePath: string) => Promise<void>,
  loadFileContent: (path: string) => Promise<{ content: string; fileName: string; filePath: string }>,
  refreshGitBranch: (root: string) => Promise<void>,
) {
  const savingTabs = new Set<string>();

  async function writeFileSmart(path: string, content: string): Promise<void> {
    const root = store.workspaceRoot;
    if (root && path.startsWith(root)) {
      await writeFile(path, content);
    } else {
      await writeTextFile(path, content);
    }
  }

  async function syncLspDocument(savePath: string, engine: EditorEngine) {
    try {
      await lspDidChange(savePath, engine.getText(), engine.editSeq());
      engine.takeEditDeltas();
    } catch {
      // Some file types have no running LSP server. Saving should still proceed.
    }
  }

  async function formatBeforeSave(tab: Tab, engine: EditorEngine, savePath: string) {
    const editorSettings = resolveEditorSettings(store.settings, savePath);
    if (!editorSettings.format_on_save) return;

    try {
      if (editorSettings.languageId === "json") {
        const indent = editorSettings.use_spaces ? " ".repeat(editorSettings.tab_size) : "\t";
        formatJsonEngine(engine, indent);
        await syncLspDocument(savePath, engine);
        return;
      }

      await syncLspDocument(savePath, engine);
      const edits = await lspFormatDocument(savePath, editorSettings.tab_size, editorSettings.use_spaces);
      const fileEdits = edits.filter(edit => edit.file_path === savePath);
      if (applyTextEdits(engine, fileEdits)) {
        await syncLspDocument(savePath, engine);
      }
    } catch (error) {
      console.warn(`Format on save failed for ${tab.name}:`, error);
    }
  }

  async function doSave(tab: Tab, engine: EditorEngine, savePath: string, options: { silent?: boolean } = {}): Promise<void> {
    await formatBeforeSave(tab, engine, savePath);

    const lines = engine.lines();
    const trimmed = lines.map(l => l.trimEnd());
    const needsTrim = lines.some((l, i) => l !== trimmed[i]);
    if (needsTrim) {
      const cursor = engine.cursor();
      engine.loadText(trimmed.join("\n"));
      engine.setCursor({ line: cursor.line, col: Math.min(cursor.col, trimmed[cursor.line]?.length ?? 0) });
    }
    await syncLspDocument(savePath, engine);
    const text = engine.getText();
    await writeFileSmart(savePath, text);
    engine.markClean();

    const fileName = basename(savePath);
    setStore("tabs", store.tabs.map(t =>
      t.id === tab.id ? { ...t, path: savePath, name: fileName, dirty: false } : t
    ));

    lspDidSave(savePath).catch(e => console.warn("LSP didSave failed:", e));
    addRecentFile(savePath, fileName);
    fetchDiffHunks(tab.id, savePath);
    if (!options.silent) showSuccess("Saved");
  }

  async function saveTab(tabId: string, options: { silent?: boolean; requirePath?: boolean } = {}) {
    if (savingTabs.has(tabId)) return;

    const tab = store.tabs.find(t => t.id === tabId);
    if (!tab || tab.type !== "file") return;
    const engine = engines.get(tab.id);
    if (!engine) return;

    let savePath = tab.path;
    if (!savePath) {
      if (options.requirePath) return;
      const { save } = await import("@tauri-apps/plugin-dialog");
      const chosen = await save({
        title: "Save File",
        defaultPath: tab.name.startsWith("Untitled") ? undefined : tab.name,
      });
      if (!chosen) return;
      savePath = chosen;
    }

    savingTabs.add(tabId);
    try {
      await doSave(tab, engine, savePath, options);
    } finally {
      savingTabs.delete(tabId);
    }
  }

  async function handleSave() {
    const tab = activeTab();
    if (!tab || tab.type !== "file") return;
    const engine = engines.get(tab.id);
    if (!engine) return;

    try {
      await saveTab(tab.id);
    } catch { showError("Failed to save"); }
  }

  async function handleSaveAs() {
    const tab = activeTab();
    if (!tab || tab.type !== "file") return;
    const engine = engines.get(tab.id);
    if (!engine) return;

    const { save } = await import("@tauri-apps/plugin-dialog");
    const chosen = await save({
      title: "Save As",
      defaultPath: tab.path || tab.name,
    });
    if (!chosen) return;

    try {
      await doSave(tab, engine, chosen);
    } catch { showError("Failed to save"); }
  }

  async function handleSync() {
    if (store.syncing) return;
    setStore("syncing", true);
    try {
      const root = store.workspaceRoot;
      if (root) await refreshGitBranch(root);
      if (root) setRefreshDir(root);

      for (const tab of store.tabs) {
        if (tab.type !== "file" || !tab.path) continue;
        const engine = engines.get(tab.id);
        if (!engine || engine.dirty()) continue;
        try {
          const { content } = await loadFileContent(tab.path);
          if (content !== engine.getText()) engine.loadText(content);
        } catch {
          showError(`Failed to sync ${tab.name}`);
        }
        fetchDiffHunks(tab.id, tab.path);
      }
      showSuccess("Synced");
    } catch { showError("Sync failed"); }
    finally { setStore("syncing", false); }
  }

  return { writeFileSmart, handleSave, handleSaveAs, handleSync, saveTab };
}
