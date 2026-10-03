import { Show } from "solid-js";
import { useBuster } from "../lib/buster-context";
import { showError } from "../lib/notify";
import "../styles/footer-nav.css";

export default function FooterNav() {
  const { store, setStore, actions } = useBuster();
  const activeType = () => actions.activeTab()?.type;
  function newNote() {
    try {
      if (store.notesRoot) setStore("workspaceRoot", store.notesRoot);
      actions.createNewFile();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }
  return <nav class="footer-nav" aria-label="Workspace navigation">
    <button data-new-tab="note" title="Create a new Markdown note tab" onClick={newNote}>New Note</button>
    <button classList={{ active: activeType() === "settings" }} onClick={actions.createSettingsTab}>Settings</button>
    <Show when={store.notesStorageWarning} fallback={
      <span class="footer-storage" title={store.notesDesktopLink ?? store.notesRoot ?? undefined}>
        {store.notesDesktopLink ? `Desktop / ${store.notesDesktopLink.split(/[\\/]/).pop()}` : ""}
      </span>
    }><span class="footer-storage warning" role="alert">{store.notesStorageWarning}</span></Show>
  </nav>;
}
