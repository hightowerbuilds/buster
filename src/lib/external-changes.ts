import type { EditorEngine } from "../editor/engine";
import type { Tab } from "./tab-types";
import type { ExternalChangeResult } from "../ui/ExternalChangeDialog";

interface Conflict { tabId: string; path: string; name: string; text: string }

/** Keep every unresolved conflict protected from autosave while showing one dialog at a time. */
export function createExternalChanges(deps: {
  tab(id: string): Tab | undefined;
  engine(id: string): EditorEngine | undefined;
  present(conflict: Conflict | undefined): void;
  loaded(id: string): void;
}) {
  const pending = new Map<string, Conflict>();
  function sync() {
    for (const [id, conflict] of pending) {
      if (deps.tab(id)?.path !== conflict.path) pending.delete(id);
    }
    deps.present(pending.values().next().value);
  }
  return {
    sync,
    has: (id: string) => pending.has(id) && pending.get(id)?.path === deps.tab(id)?.path,
    receive(tabId: string, name: string, text: string) {
      const tab = deps.tab(tabId);
      if (!tab) return;
      pending.set(tabId, { tabId, path: tab.path, name, text });
      sync();
    },
    resolve(result: ExternalChangeResult) {
      // Resolve the displayed entry, never advance to another target before applying the choice.
      const conflict = pending.values().next().value as Conflict | undefined;
      if (!conflict) return;
      if (result === "load-disk" && deps.tab(conflict.tabId)?.path === conflict.path) {
        const engine = deps.engine(conflict.tabId);
        if (!engine) return;
        engine.beginUndoGroup();
        try {
          engine.replaceDocument(conflict.text.replace(/\r\n/g, "\n"), engine.sel() ?? { anchor: engine.cursor(), head: engine.cursor() });
        } finally { engine.endUndoGroup(); }
        engine.markClean();
        deps.loaded(conflict.tabId);
      }
      pending.delete(conflict.tabId);
      sync();
    },
  };
}
