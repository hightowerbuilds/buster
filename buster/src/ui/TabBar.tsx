import { Component, For, createSignal } from "solid-js";
import type { Tab } from "../lib/tab-types";

interface TabBarProps {
  tabs: Tab[];
  activeTab: string | null;
  groupedTabIds?: Set<string>;
  onSelect: (id: string) => void;
  onActivate?: (id: string) => void;
  onClose: (id: string) => void;
  onNewTerminal: () => void;
  onReorder?: (fromIdx: number, toIdx: number) => void;
}

const DRAG_THRESHOLD = 5;

const TabBar: Component<TabBarProps> = (props) => {
  const [dragIdx, setDragIdx] = createSignal<number | null>(null);
  const [dropIdx, setDropIdx] = createSignal<number | null>(null);
  const [ghostStyle, setGhostStyle] = createSignal<{ left: number; top: number; name: string } | null>(null);

  let startX = 0;
  let dragging = false;
  let dragTabIdx = -1;

  function handlePointerDown(idx: number, e: PointerEvent) {
    startX = e.clientX;
    dragTabIdx = idx;
    dragging = false;

    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - startX) > DRAG_THRESHOLD) {
        dragging = true;
        setDragIdx(dragTabIdx);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }
      if (dragging) {
        setGhostStyle({
          left: ev.clientX,
          top: ev.clientY - 10,
          name: props.tabs[dragTabIdx]?.name ?? "",
        });

        // Find which tab we're hovering over
        const tabEls = document.querySelectorAll(".tab");
        for (let i = 0; i < tabEls.length; i++) {
          const rect = tabEls[i].getBoundingClientRect();
          if (ev.clientX >= rect.left && ev.clientX <= rect.right) {
            setDropIdx(i);
            break;
          }
        }
      }
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";

      if (dragging && dragIdx() !== null && dropIdx() !== null && dragIdx() !== dropIdx()) {
        props.onReorder?.(dragIdx()!, dropIdx()!);
      }

      setDragIdx(null);
      setDropIdx(null);
      setGhostStyle(null);
      dragging = false;
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  function handleTabKeyDown(e: KeyboardEvent, idx: number) {
    const count = props.tabs.length;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = (idx + 1) % count;
      props.onSelect(props.tabs[next].id);
      focusTab(next);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = (idx - 1 + count) % count;
      props.onSelect(props.tabs[prev].id);
      focusTab(prev);
    } else if (e.key === "Home") {
      e.preventDefault();
      props.onSelect(props.tabs[0].id);
      focusTab(0);
    } else if (e.key === "End") {
      e.preventDefault();
      props.onSelect(props.tabs[count - 1].id);
      focusTab(count - 1);
    }
  }

  function focusTab(idx: number) {
    const tabs = document.querySelectorAll<HTMLElement>('.tab[role="tab"]');
    tabs[idx]?.focus();
  }

  return (
    <div class="tab-bar">
      <div class="tab-list" role="tablist" aria-label="Open tabs">
        <For each={props.tabs}>
          {(tab, idx) => (
            <div
              class={`tab ${tab.id === props.activeTab ? "tab-active" : ""} ${props.groupedTabIds?.has(tab.id) ? "tab-grouped" : ""} ${tab.type === "terminal" ? "tab-terminal" : ""} ${tab.type === "settings" ? "tab-settings" : ""} ${tab.type === "git" ? "tab-git" : ""} ${dragIdx() === idx() ? "tab-dragging" : ""} ${dropIdx() === idx() && dragIdx() !== idx() ? "tab-drop-target" : ""}`}
              role="tab"
              aria-selected={tab.id === props.activeTab}
              aria-label={`${tab.name}${tab.dirty ? " (unsaved)" : ""}`}
              tabIndex={tab.id === props.activeTab ? 0 : -1}
              onClick={() => (props.onActivate ?? props.onSelect)(tab.id)}
              onPointerDown={(e) => handlePointerDown(idx(), e)}
              onKeyDown={(e) => handleTabKeyDown(e, idx())}
            >
              <span class="tab-icon">{tab.type === "terminal" ? ">" : tab.type === "settings" ? "~" : tab.type === "git" ? "&" : tab.type === "legend" ? "?" : tab.type === "github" ? "@" : tab.type === "explorer" ? "/" : "#"}</span>
              <span class="tab-name">
                {tab.dirty ? "\u2022 " : ""}
                {tab.name}
              </span>
              <button
                class="tab-close"
                tabIndex={-1}
                aria-label={`Close ${tab.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onClose(tab.id);
                }}
              >
                x
              </button>
            </div>
          )}
        </For>
      </div>
      <button
        class="tab-new-terminal"
        onClick={props.onNewTerminal}
        title="New terminal (Ctrl+`)"
      >
        +
      </button>

      {/* Floating drag ghost */}
      {ghostStyle() && (
        <div
          class="tab-ghost"
          style={{
            left: `${ghostStyle()!.left}px`,
            top: `${ghostStyle()!.top}px`,
          }}
        >
          {ghostStyle()!.name}
        </div>
      )}
    </div>
  );
};

export default TabBar;
