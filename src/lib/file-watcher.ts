import { listen } from "@tauri-apps/api/event";
import { readFile } from "./ipc";
import { showToast } from "../ui/CanvasToasts";
import type { EditorEngine } from "../editor/engine";
import type { Tab } from "./tab-types";

interface FileWatcherDeps {
  getTabs: () => Tab[];
  getEngine: (tabId: string) => EditorEngine | undefined;
  showConflictDialog: (tabId: string, fileName: string, diskContent: string) => void;
}

export async function setupFileWatcher(deps: FileWatcherDeps): Promise<() => void> {
  const revisions = new Map<string, number>();
  let disposed = false;
  const unlisten = await listen<{ path: string }>("file-changed-externally", async (event) => {
    const changedPath = event.payload.path;
    const revision = (revisions.get(changedPath) ?? 0) + 1;
    revisions.set(changedPath, revision);
    if (!deps.getTabs().some(t => t.type === "file" && t.path === changedPath)) return;

    // Read updated content from disk
    let diskContent: string;
    try {
      const file = await readFile(changedPath);
      diskContent = file.content;
    } catch {
      return; // File may have been deleted
    }

    if (disposed || revisions.get(changedPath) !== revision) return;
    // Resolve current targets after the read: tabs may close, Save As, or change
    // while IPC is pending. Every view of the same file needs the notification.
    for (const tab of deps.getTabs().filter(t => t.type === "file" && t.path === changedPath)) {
      const engine = deps.getEngine(tab.id);
      if (!engine || diskContent === engine.getText()) continue;
      if (engine.dirty()) {
        deps.showConflictDialog(tab.id, tab.name, diskContent);
      } else {
        engine.loadText(diskContent);
        showToast(`Reloaded: ${tab.name}`, "info");
      }
    }
  });

  return () => { disposed = true; revisions.clear(); unlisten(); };
}
