import { type Component, type JSX, For, Show } from "solid-js";
import { useBuster } from "../lib/buster-context";
import type { Tab } from "../lib/tab-types";
import { showError } from "../lib/notify";
import WritingLayoutControls from "./WritingLayoutControls";
import WritingToolbar from "./WritingToolbar";

/**
 * The writing area: a tab bar above, one tab's content here.
 *
 * Splitting was removed in favour of plain tabs. One pane still backs the
 * layout internally because formatting, selection, appearance and AI review
 * all target a pane; every tab is shown in that single pane.
 */
interface PanelLayoutProps { renderPanel: (tab: Tab, active: boolean) => JSX.Element }

const PanelLayout: Component<PanelLayoutProps> = props => {
  const { store, actions, search, formatting } = useBuster();
  const state = () => store.paneWorkspace;
  const activeTab = () => store.tabs.find(tab => tab.id === store.activeTabId);

  function safely(run: () => unknown) {
    try { run(); } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
  }

  return <div class="writing-workspace">
    <WritingToolbar requestPortal={target => safely(() => {
      if (target && JSON.stringify(formatting.capture(target.paneId)) !== JSON.stringify(target))
        throw new Error("Your writing selection changed. Return to the note and open AI search again.");
      search.open(target?.paneId ?? state().activePaneId);
    })} />
    <div class="writing-toolbar" role="toolbar" aria-label="Writing">
      <WritingLayoutControls />
      <details class="pane-shortcuts"><summary>Shortcuts</summary><div>
        <p>⌘W: close the open note or terminal</p>
        <p>Select text for Copy / Paste · ⌘⇧Space: focus or reopen selection actions · Escape: dismiss</p>
        <button onClick={() => actions.createKeybindingsTab()}>Customize bindings</button>
      </div></details>
    </div>
    <div class="pane-viewport">
      {/* One container per tab, kept mounted so editors and shells survive a switch. */}
      <For each={store.tabs.map(tab => tab.id)}>{tabId => {
        const tab = () => store.tabs.find(item => item.id === tabId)!;
        const active = () => tabId === store.activeTabId;
        return <div class="writing-pane-content" style={{ display: active() ? undefined : "none" }}>
          {props.renderPanel(tab(), active())}
        </div>;
      }}</For>
      <Show when={!activeTab()}>
        <div class="empty-writing-pane">
          <h2>Space to write</h2>
          <p>Start a note, or open one from the file explorer.</p>
          <button onClick={() => actions.createNewFile()}>New note</button>
          <button onClick={() => actions.createTerminalTab()}>New terminal</button>
        </div>
      </Show>
    </div>
  </div>;
};
export default PanelLayout;
