import { type Component, type JSX, For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useBuster } from "../lib/buster-context";
import { MAX_PANES, paneGeometry, type PaneDirection, type PaneDivider, type PaneRect, type PaneNode } from "../lib/writing-panes";
import type { Tab } from "../lib/tab-types";
import { showError } from "../lib/notify";

interface PanelLayoutProps { renderPanel: (tab: Tab, active: boolean) => JSX.Element }
const PanelLayout: Component<PanelLayoutProps> = props => {
  const { store, actions } = useBuster();
  const state = () => store.paneWorkspace;
  const [size, setSize] = createSignal({ width: 1000, height: 600 });
  const [direction, setDirection] = createSignal<PaneDirection>("right");
  const [content, setContent] = createSignal<"note" | "terminal" | "empty">("note");
  let viewport!: HTMLDivElement;
  let endDrag: (() => void) | undefined;
  const geometry = createMemo(() => paneGeometry(state().layout, size().width, size().height));
  const displayed = createMemo(() => state().zoomedPaneId
    ? [{ id: state().zoomedPaneId!, x: 0, y: 0, width: Math.max(240, size().width), height: Math.max(180, size().height) }]
    : geometry().panes);
  const rect = (paneId: string) => displayed().find(r => r.id === paneId);
  const paneTab = (paneId: string) => store.tabs.find(t => t.id === state().panes.find(p => p.id === paneId)?.tabId);
  const position = (r: PaneRect | undefined, header = false): JSX.CSSProperties => ({
    position: "absolute", display: r ? undefined : "none", left: `${r?.x ?? 0}px`, top: `${(r?.y ?? 0) + (header ? 0 : 34)}px`,
    width: `${r?.width ?? 0}px`, height: header ? "34px" : `${Math.max(0, (r?.height ?? 0) - 34)}px`,
  });
  function safely(run: () => unknown) { try { run(); } catch (e) { showError(e instanceof Error ? e.message : String(e)); } }
  function split() { safely(() => actions.panes.splitPane(direction(), content())); }
  onMount(() => {
    const measure = () => setSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    const observer = new ResizeObserver(measure); observer.observe(viewport); measure();
    onCleanup(() => observer.disconnect());
  });
  onCleanup(() => endDrag?.());
  function drag(event: MouseEvent, divider: PaneDivider) {
    if (event.button !== 0) return;
    event.preventDefault();
    endDrag?.();
    const start = divider.axis === "row" ? event.clientX : event.clientY;
    const nodeRatio = () => {
      const find = (n: PaneNode): number | null =>
        n.kind === "pane" ? null : n.id === divider.id ? n.ratio : find(n.first) ?? find(n.second);
      return find(state().layout) ?? 0.5;
    };
    const initial = Math.max(divider.minRatio, Math.min(divider.maxRatio, nodeRatio()));
    const previousSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const move = (e: MouseEvent) => {
      const delta = (divider.axis === "row" ? e.clientX : e.clientY) - start;
      actions.panes.resizeSplit(divider.id, Math.max(divider.minRatio, Math.min(divider.maxRatio, initial + delta / divider.span)));
    };
    endDrag = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", endDrag!);
      window.removeEventListener("blur", endDrag!);
      document.body.style.userSelect = previousSelect; endDrag = undefined; };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", endDrag);
    window.addEventListener("blur", endDrag);
  }
  return <div class="writing-workspace">
    <div class="writing-toolbar" role="toolbar" aria-label="Writing panes">
      <button onClick={() => actions.createNewFile()}>+ New note</button>
      <select aria-label="Split direction" value={direction()} onChange={e => setDirection(e.currentTarget.value as PaneDirection)}>
        <option value="right">Right</option><option value="left">Left</option><option value="down">Below</option><option value="up">Above</option>
      </select>
      <select aria-label="New pane content" value={content()} onChange={e => setContent(e.currentTarget.value as "note" | "terminal" | "empty")}>
        <option value="note">New note</option><option value="terminal">Terminal</option><option value="empty">Empty pane</option>
      </select>
      <button disabled={state().panes.length >= MAX_PANES} onClick={split}>Split</button>
      <button onClick={() => actions.panes.zoomPane()}>{state().zoomedPaneId ? "Restore panes" : "Maximize"}</button>
      <select aria-label="Swap active pane with" value="" onChange={e => { if (e.currentTarget.value) actions.panes.swapPanes(state().activePaneId, e.currentTarget.value); e.currentTarget.value = ""; }}>
        <option value="">Swap with…</option>
        <For each={state().panes.filter(p => p.id !== state().activePaneId)}>{p => <option value={p.id}>{paneTab(p.id)?.name ?? "Empty pane"}</option>}</For>
      </select>
      <details class="pane-shortcuts"><summary>Shortcuts</summary><div>
        <p>⌘D: split right · ⌘⇧D: split below</p><p>⌘⌥ arrows: focus pane · ⌘⌥⇧ arrows: grow pane</p>
        <p>⌘⇧Enter: maximize / restore · ⌘⇧W: close pane</p>
        <p>⌘W: close document or terminal · Ctrl+`: app commands</p>
        <p>Select text for Copy / Paste · ⌘⇧Space: focus or reopen selection actions · Escape: dismiss</p>
        <button onClick={() => actions.createKeybindingsTab()}>Customize bindings</button>
        <p>Up to six panes. Closing a pane keeps its note or shell in the tab bar.</p>
      </div></details>
      <span class="pane-count">{state().panes.length}/{MAX_PANES}</span>
    </div>
    <div class="pane-viewport" ref={viewport}>
      <div class="pane-stage" style={{ width: `${Math.max(size().width, state().zoomedPaneId ? 240 : geometry().minimum.width)}px`, height: `${Math.max(size().height, state().zoomedPaneId ? 180 : geometry().minimum.height)}px` }}>
        <For each={state().panes.map(p => p.id)}>{paneId => <>
          <div class="writing-pane-header" classList={{ "is-active": state().activePaneId === paneId }} style={position(rect(paneId), true)} data-pane-id={paneId}>
            <button class="pane-name" title="Focus pane" onClick={() => actions.panes.focusPane(paneId)}>{paneTab(paneId)?.dirty ? "● " : ""}{paneTab(paneId)?.name ?? "Empty pane"}</button>
            <select aria-label={`Choose content for pane ${state().panes.findIndex(p => p.id === paneId) + 1}`} value="" onChange={e => {
              const value = e.currentTarget.value;
              if (value === "new-note" || value === "new-terminal") {
                actions.panes.focusPane(paneId); value === "new-note" ? actions.createNewFile() : actions.createTerminalTab();
              } else if (value) actions.panes.showDocument(value, paneId);
              e.currentTarget.value = "";
            }}><option value="">Open…</option><option value="new-note">New note</option><option value="new-terminal">New terminal</option>
              <For each={store.tabs}>{t => <option value={t.id}>{t.name}{t.dirty ? " ●" : ""}</option>}</For>
            </select>
            <button title="Close pane; keep its content open" aria-label="Close pane" onClick={() => actions.panes.closePane(paneId)}>×</button>
          </div>
          <Show when={!paneTab(paneId)}><div class="empty-writing-pane" style={position(rect(paneId))}>
            <h2>Space to write</h2><p>Start a note, open a document from the tab bar, or bring in a terminal.</p>
            <button onClick={() => { actions.panes.focusPane(paneId); actions.createNewFile(); }}>+ New note</button>
            <button onClick={() => { actions.panes.focusPane(paneId); actions.createTerminalTab(); }}>Open terminal</button>
          </div></Show>
        </>}</For>
        {/* Stable tab containers survive every split, swap, resize and zoom. */}
        <For each={store.tabs.map(t => t.id)}>{tabId => {
          const tab = () => store.tabs.find(t => t.id === tabId)!;
          const pane = () => state().panes.find(p => p.tabId === tabId);
          const active = () => pane()?.id === state().activePaneId;
          return <div class="writing-pane-content" classList={{ "is-active": active() }} style={position(pane() ? rect(pane()!.id) : undefined)}
            onPointerDown={() => { if (!active() && pane()) actions.panes.focusPane(pane()!.id); }}>
            {props.renderPanel(tab(), active())}
          </div>;
        }}</For>
        <Show when={!state().zoomedPaneId}><For each={geometry().dividers.map(d => d.id)}>{id => {
          const divider = () => geometry().dividers.find(d => d.id === id)!;
          return <div class={`writing-divider ${divider().axis}`} role="separator" aria-orientation={divider().axis === "row" ? "vertical" : "horizontal"}
            style={{ position: "absolute", left: `${divider().x}px`, top: `${divider().y}px`, width: `${divider().width}px`, height: `${divider().height}px` }}
            onMouseDown={e => drag(e, divider())} />;
        }}</For></Show>
      </div>
    </div>
  </div>;
};
export default PanelLayout;
