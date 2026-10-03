// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createRoot, createSignal, createEffect, onCleanup } from "solid-js";
import { createPanelRenderer, type PanelRendererDeps } from "./PanelRenderer";
import type { Tab } from "../lib/tab-types";

const hooks = vi.hoisted(() => ({ disposed: vi.fn(), active: vi.fn() }));
vi.mock("../lib/panel-definitions", () => ({}));
vi.mock("../lib/panel-registry", () => ({ getPanel: () => ({ render: (tab: Tab, active: () => boolean) => {
  createEffect(() => hooks.active(tab.id, active()));
  onCleanup(() => hooks.disposed(tab.id));
  return document.createElement("div");
} }) }));

it("keeps inactive tab roots alive and disposes closed roots exactly once", () => {
  hooks.disposed.mockClear();
  let finish!: () => void;
  let setTabs!: (tabs: Tab[]) => void;
  const a: Tab = { id: "a", name: "Review", path: "", type: "writing-review", dirty: false };
  const b: Tab = { ...a, id: "b" };
  let renderer!: ReturnType<typeof createPanelRenderer>;
  let original: unknown;
  createRoot(dispose => {
    finish = dispose;
    const [tabs, update] = createSignal([a, b]); setTabs = update;
    renderer = createPanelRenderer({ tabs, activeTabId: () => "a", switchToTab: vi.fn() } as unknown as PanelRendererDeps);
    original = renderer.renderPanel(a, true);
    renderer.renderPanel(b, false);
  });
  expect(renderer.renderPanel(a, false)).toBe(original);
  renderer.renderPanel(b, true);
  expect(hooks.active).toHaveBeenCalledWith("b", true);
  expect(hooks.disposed).not.toHaveBeenCalled();
  setTabs([b]);
  expect(hooks.disposed).toHaveBeenCalledExactlyOnceWith("a");
  finish();
  expect(hooks.disposed.mock.calls).toEqual([["a"], ["b"]]);
});

it("activates a clicked pane without replacing the control that received focus", () => {
  const activateTab = vi.fn(), switchToTab = vi.fn();
  let finish!: () => void;
  let host!: HTMLElement;
  const tab: Tab = { id: "settings_tab", name: "Settings", path: "", type: "settings", dirty: false };
  createRoot(dispose => {
    finish = dispose;
    const renderer = createPanelRenderer({ tabs: () => [tab], activeTabId: () => "note", switchToTab, activateTab } as unknown as PanelRendererDeps);
    host = renderer.renderPanel(tab, false) as HTMLElement;
  });
  document.body.append(host);
  host.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(activateTab).toHaveBeenCalledWith("settings_tab"); expect(switchToTab).not.toHaveBeenCalled();
  finish(); host.remove();
});
