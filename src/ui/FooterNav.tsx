import { Show } from "solid-js";
import { useBuster } from "../lib/buster-context";
import "../styles/footer-nav.css";

export default function FooterNav() {
  const { store, setStore, actions } = useBuster();
  const activeType = () => actions.activeTab()?.type;
  function openTerminal() {
    const terminal = store.tabs.find(tab => tab.type === "terminal");
    if (terminal) actions.switchToTab(terminal.id);
    else actions.createTerminalTab();
  }
  return <nav class="footer-nav" aria-label="Workspace navigation">
    <button classList={{ active: activeType() === "terminal" }} onClick={openTerminal}>Terminal</button>
    <button classList={{ active: activeType() === "settings" }} onClick={actions.createSettingsTab}>Settings</button>
    <button title="Create a new Markdown note" onClick={() => {
      if (store.notesRoot) setStore("workspaceRoot", store.notesRoot);
      actions.createNewFile();
    }}>Notes <span aria-hidden="true">+</span></button>
    <Show when={store.notesStorageWarning} fallback={
      <span class="footer-storage" title={store.notesDesktopLink ?? store.notesRoot ?? undefined}>
        {store.notesDesktopLink ? `Desktop / ${store.notesDesktopLink.split(/[\\/]/).pop()}` : ""}
      </span>
    }><span class="footer-storage warning" role="alert">{store.notesStorageWarning}</span></Show>
  </nav>;
}
