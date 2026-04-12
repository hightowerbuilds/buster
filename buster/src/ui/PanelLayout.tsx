import { Component, For, Show, JSX } from "solid-js";
import { createStore } from "solid-js/store";
import type { PanelCount } from "../lib/panel-count";
import type { Tab } from "../lib/tab-types";
import {
  createPanelLayoutTree,
  normalizedSplitSizes,
  type PanelLayoutNode,
  type PanelSplitNode,
} from "./panel-layout-tree";

interface PanelLayoutProps {
  panelCount: PanelCount;
  tabs: Tab[];
  activeTabId: string | null;
  renderPanel: (tab: Tab, isActive: boolean) => JSX.Element;
  welcome: JSX.Element;
}

const DIVIDER_SIZE = 4;
const MIN_PANEL_PERCENT = 12;

function Divider(props: {
  direction: "horizontal" | "vertical";
  onDrag: (delta: number) => void;
}) {
  let startPos = 0;

  function onPointerDown(e: PointerEvent) {
    e.preventDefault();
    startPos = props.direction === "horizontal" ? e.clientX : e.clientY;
    document.body.style.userSelect = "none";
    document.body.style.cursor = props.direction === "horizontal" ? "col-resize" : "row-resize";

    const onMove = (ev: PointerEvent) => {
      const current = props.direction === "horizontal" ? ev.clientX : ev.clientY;
      const delta = current - startPos;
      if (delta !== 0) {
        props.onDrag(delta);
        startPos = current;
      }
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  return (
    <div
      class={`divider divider-${props.direction}`}
      onPointerDown={onPointerDown}
    />
  );
}

const PanelLayout: Component<PanelLayoutProps> = (props) => {
  const [splitSizes, setSplitSizes] = createStore<Record<string, number[]>>({});

  function activeTabId() {
    return props.activeTabId ?? props.tabs[0]?.id ?? null;
  }

  function groupedTabs(): Tab[] {
    return props.tabs.slice(0, props.panelCount);
  }

  function activeInGroup(): boolean {
    const current = activeTabId();
    if (!current || props.panelCount === 1 || props.tabs.length === 0) return true;
    return groupedTabs().some((tab) => tab.id === current);
  }

  function visibleTabs(): Tab[] {
    if (props.tabs.length === 0) return [];
    if (!activeInGroup()) {
      const active = props.tabs.find((tab) => tab.id === activeTabId());
      return active ? [active] : [];
    }
    return props.tabs.slice(0, props.panelCount);
  }

  function effectivePanelCount(): PanelCount {
    if (!activeInGroup()) return 1;
    const count = visibleTabs().length;
    if (count <= 1) return 1;
    return Math.min(props.panelCount, count) as PanelCount;
  }

  function resizeSplit(
    path: string,
    split: PanelSplitNode,
    dividerIndex: number,
    delta: number,
    containerSize: number,
  ) {
    const availableSize = Math.max(1, containerSize - DIVIDER_SIZE * (split.children.length - 1));
    const deltaPercent = (delta / availableSize) * 100;
    const nextSizes = (splitSizes[path] ?? normalizedSplitSizes(split)).slice();
    const leading = nextSizes[dividerIndex]!;
    const trailing = nextSizes[dividerIndex + 1]!;
    const nextLeading = leading + deltaPercent;
    const nextTrailing = trailing - deltaPercent;

    if (nextLeading < MIN_PANEL_PERCENT || nextTrailing < MIN_PANEL_PERCENT) return;

    nextSizes[dividerIndex] = nextLeading;
    nextSizes[dividerIndex + 1] = nextTrailing;
    setSplitSizes(path, nextSizes);
  }

  function renderLeaf(tab: Tab | undefined): JSX.Element {
    if (!tab) {
      return <div class="panel panel-frame panel-empty" />;
    }

    const active = () => tab.id === activeTabId();

    return (
      <div class="panel panel-frame">
        <div class="panel-label">{tab.name}</div>
        <div class="panel-content">
          {props.renderPanel(tab, active())}
        </div>
      </div>
    );
  }

  function renderNode(node: PanelLayoutNode, path: string): JSX.Element {
    if (node.kind === "leaf") {
      return renderLeaf(visibleTabs()[node.tabIndex]);
    }

    let splitRef: HTMLDivElement | undefined;
    const sizes = () => splitSizes[path] ?? normalizedSplitSizes(node);

    return (
      <div
        ref={splitRef}
        class={`panel-split panel-split-${node.direction}`}
      >
        <For each={node.children}>
          {(child, index) => (
            <>
              <Show when={index() > 0}>
                <Divider
                  direction={node.direction === "row" ? "horizontal" : "vertical"}
                  onDrag={(delta) => {
                    const size = node.direction === "row"
                      ? splitRef?.clientWidth ?? 0
                      : splitRef?.clientHeight ?? 0;
                    if (size <= 0) return;
                    resizeSplit(path, node, index() - 1, delta, size);
                  }}
                />
              </Show>
              <div
                class="panel-split-child"
                style={{ flex: `${sizes()[index()] ?? 1} 1 0` }}
              >
                {renderNode(child, `${path}.${index()}`)}
              </div>
            </>
          )}
        </For>
      </div>
    );
  }

  return (
    <div class="panel-layout" data-panel-count={effectivePanelCount()}>
      <Show when={props.tabs.length === 0}>{props.welcome}</Show>

      <Show when={props.tabs.length > 0 && effectivePanelCount() === 1}>
        <For each={props.tabs}>
          {(tab) => (
            <div
              class="panel panel-full"
              style={{ display: tab.id === activeTabId() ? undefined : "none" }}
            >
              {props.renderPanel(tab, tab.id === activeTabId())}
            </div>
          )}
        </For>
      </Show>

      <Show when={props.tabs.length > 0 && effectivePanelCount() > 1}>
        {renderNode(createPanelLayoutTree(effectivePanelCount()), "root")}
      </Show>
    </div>
  );
};

export default PanelLayout;
