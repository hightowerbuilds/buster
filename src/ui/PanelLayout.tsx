import { type Component, type JSX, For, Show, onCleanup } from "solid-js";
import { useBuster } from "../lib/buster-context";
import { splitSide } from "../lib/split-view";
import type { Tab } from "../lib/tab-types";
import WritingToolbar from "./WritingToolbar";
import WelcomeScreen from "./WelcomeScreen";
import ShaderBackground from "./ShaderBackground";

interface PanelLayoutProps { renderPanel: (tab: Tab, active: boolean) => JSX.Element }
/** Stable tab hosts preserve editors and shell sessions while inactive. */
const PanelLayout: Component<PanelLayoutProps> = props => {
  const { store, actions, backgrounds } = useBuster();
  let viewport!: HTMLDivElement;
  let stopResize: (() => void) | undefined;
  onCleanup(() => stopResize?.());
  const visibleTab = (id: string) => store.splitView
    ? !!splitSide(store.splitView, id) : store.activeTabId === id;
  const activeNote = () => store.tabs.find(tab => tab.id === store.activeTabId)?.type === "file";
  const showBackground = () => !!backgrounds.selected() && store.tabs.some(tab => visibleTab(tab.id) && tab.type === "file");
  function startResize(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    stopResize?.();
    const bounds = viewport.getBoundingClientRect();
    if (!bounds.width) return;
    const pointerId = event.pointerId;
    const cursor = document.body.style.cursor, userSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (e: PointerEvent) => {
      if (e.pointerId === pointerId) actions.setSplitRatio((e.clientX - bounds.left) / bounds.width);
    };
    const end = (e: PointerEvent) => { if (e.pointerId === pointerId) stopResize?.(); };
    stopResize = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", stopResize!);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
      stopResize = undefined;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", stopResize);
  }
  return <div class="writing-workspace" classList={{ "has-shader-background": showBackground() }}>
    <Show when={activeNote()}>
      <WritingToolbar />
    </Show>
    <div class="tab-viewport" ref={viewport} classList={{ "is-split": !!store.splitView }}>
      <Show when={showBackground()}><ShaderBackground /></Show>
      <Show when={store.tabs.length === 0}><WelcomeScreen /></Show>
      <For each={store.tabs.map(tab => tab.id)}>{tabId => {
        const tab = () => store.tabs.find(tab => tab.id === tabId)!;
        const active = () => store.activeTabId === tabId;
        const side = () => store.splitView ? splitSide(store.splitView, tabId) : null;
        const otherTabId = () => side() === "left" ? store.splitView?.rightTabId : store.splitView?.leftTabId;
        return <div class="tab-content" classList={{ "is-active": active(), "is-split-pane": !!side() }}
          id={`content-${tabId}`} role="tabpanel" aria-labelledby={`tab-${tabId}`}
          data-pane={side() ?? undefined}
          style={{ display: visibleTab(tabId) ? undefined : "none",
            left: side() === "right" ? `${store.splitView!.ratio * 100}%` : "0",
            right: side() === "left" ? `${(1 - store.splitView!.ratio) * 100}%` : "0" }}
          aria-hidden={!visibleTab(tabId)}
          onPointerDown={() => { if (!active()) actions.switchToTab(tabId, { focus: false }); }}
          onFocusIn={() => { if (!active()) actions.switchToTab(tabId, { focus: false }); }}>
          <Show when={side()}>
            <div class="split-pane-header">
              <select aria-label={`${side() === "left" ? "Left" : "Right"} pane tab`} value={tabId}
                onChange={event => actions.switchToTab(event.currentTarget.value, { pane: side()!, focus: true })}>
                <For each={store.tabs.filter(t => t.id !== otherTabId())}>{t => <option value={t.id}>{t.name}</option>}</For>
              </select>
              <button aria-label={`Expand ${tab().name}`} title="Show only this tab"
                onClick={() => actions.closeSplitView(tabId)}>↗</button>
              <button aria-label={`Close ${tab().name}`} title="Close tab"
                onClick={() => actions.handleTabClose(tabId)}>×</button>
            </div>
          </Show>
          {props.renderPanel(tab(), active())}
        </div>;
      }}</For>
      <Show when={store.splitView}>
        <div class="split-view-divider" role="separator" tabindex="0" aria-label="Resize panes"
          aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75}
          aria-valuenow={Math.round((store.splitView?.ratio ?? 0.5) * 100)}
          style={{ left: `${(store.splitView?.ratio ?? 0.5) * 100}%` }}
          onPointerDown={startResize} onDblClick={() => actions.setSplitRatio(0.5)}
          onKeyDown={event => {
            const delta = event.shiftKey ? 0.1 : 0.02;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              actions.setSplitRatio((store.splitView?.ratio ?? 0.5) + (event.key === "ArrowLeft" ? -delta : delta));
            } else if (event.key === "Home") { event.preventDefault(); actions.setSplitRatio(0.5); }
          }} />
      </Show>
    </div>
  </div>;
};
export default PanelLayout;
