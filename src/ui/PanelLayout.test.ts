// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createComponent } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import PanelLayout from "./PanelLayout";
import FooterNav from "./FooterNav";
import { createTabActions } from "../lib/actions-tabs";
import type { BusterContextValue, EngineMap } from "../lib/buster-context";
import type { BusterStoreState } from "../lib/store-types";

let context: BusterContextValue;
vi.mock("../lib/buster-context", () => ({ useBuster: () => context }));
vi.mock("./WritingToolbar", () => ({ default: () => {
  const toolbar = document.createElement("div"); toolbar.setAttribute("role", "toolbar"); return toolbar;
} }));
vi.mock("./WelcomeAscii", () => ({ default: () => null }));
vi.mock("../lib/notify", () => ({ showError: vi.fn() }));
vi.mock("./SidebarTree", () => ({ setRefreshDir: vi.fn() }));
vi.mock("../lib/ipc", () => ({}));
let dispose: () => void;
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(0); return 1; });
  const [store, setStore] = createStore({ activeTabId: null, splitView: null, tabs: [], notesRoot: null,
    fileTabCounter: 0, fileTexts: {}, scrollPositions: {}, diffHunksMap: {}, lspLanguages: [],
  } as unknown as BusterStoreState);
  const engines = { get: () => undefined, delete: vi.fn() } as unknown as EngineMap;
  const tabs = createTabActions(store, setStore, engines, { value: "" }, vi.fn());
  context = { store, setStore, actions: { ...tabs, activeTab: () => store.tabs.find(t => t.id === store.activeTabId) },
    backgrounds: { selected: () => undefined } } as unknown as BusterContextValue;
  const root = document.createElement("div"); document.body.append(root);
  const nodes = new Map<string, HTMLInputElement>();
  dispose = render(() => [createComponent(PanelLayout, { renderPanel: tab => {
    if (!nodes.has(tab.id)) { const node = document.createElement("input"); node.dataset.testTab = tab.id; nodes.set(tab.id, node); }
    return nodes.get(tab.id)!;
  } }), createComponent(FooterNav, {})], root);
});
afterEach(() => { dispose(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const click = (text: string) => [...document.querySelectorAll("button")].find(b => b.textContent === text)!.click();
const visible = () => [...document.querySelectorAll<HTMLElement>(".tab-content")].filter(el => el.style.display !== "none");

describe("tab workspace", () => {
  it("shows only welcome and footer when empty and returns there on final close", () => {
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    expect(document.querySelector(".welcome-screen")).not.toBeNull();
    expect([...document.querySelectorAll(".footer-nav button")].map(el => el.textContent)).toEqual(["New Note", "Settings"]);
    click("New Note");
    expect(document.querySelector(".welcome-screen")).toBeNull();
    expect(document.querySelector('[role="toolbar"]')).not.toBeNull();
    context.actions.handleTabClose(context.store.activeTabId!);
    expect(document.querySelector(".welcome-screen")).not.toBeNull();
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe("New Note");
    expect(document.querySelector(".writing-pane-header, .empty-writing-pane, .pane-count, .writing-divider")).toBeNull();
  });
  it("creates more than six tabs, displays one, and preserves inactive hosts on switch and reorder", () => {
    click("New Note");
    const first = context.store.activeTabId!;
    const input = document.querySelector<HTMLInputElement>(`[data-test-tab="${first}"]`)!; input.value = "draft state";
    for (let i = 0; i < 7; i++) click("New Note");
    click("Settings");
    expect(context.store.tabs).toHaveLength(9);
    expect(visible()).toHaveLength(1);
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    context.actions.switchToTab(first); context.actions.reorderTabs(0, 8);
    expect(visible()).toHaveLength(1);
    expect(visible()[0].querySelector("input")).toBe(input);
    expect(input.value).toBe("draft state");
    expect(document.querySelector('[role="toolbar"]')).not.toBeNull();
  });
  it("keeps Settings a single tab without note toolbars", () => {
    click("New Note"); const note = context.store.activeTabId!;
    click("Settings"); click("Settings");
    expect(context.store.tabs).toHaveLength(2);
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    context.actions.switchToTab(note);
    expect(document.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("Writing appearance");
    expect(document.body.textContent).not.toContain("Stop effects");
  });

  it("shows two notes, retains their DOM state, and swaps only the selected pane", () => {
    click("New Note"); const first = context.store.activeTabId!;
    const input = document.querySelector<HTMLInputElement>(`[data-test-tab="${first}"]`)!;
    input.value = "draft state"; input.setSelectionRange(2, 5);
    click("New Note"); const second = context.store.activeTabId!;
    click("New Note"); const third = context.store.activeTabId!;
    context.actions.switchToTab(first); context.actions.openTabAlongside(second);
    expect(visible()).toHaveLength(2);
    expect(document.querySelectorAll('.tab-content[aria-hidden="false"]')).toHaveLength(2);
    expect(document.querySelectorAll(".tab-content.is-active")).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>(`[data-test-tab="${first}"]`)).toBe(input);
    input.focus();
    expect(context.store.activeTabId).toBe(first);
    expect(input.selectionStart).toBe(2); expect(input.selectionEnd).toBe(5);
    const select = document.querySelector<HTMLSelectElement>('[aria-label="Left pane tab"]')!;
    select.value = third; select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(context.store.splitView).toMatchObject({ leftTabId: third, rightTabId: second });
    context.actions.closeSplitView(first); // Invalid hidden keep request falls back to the visible left pane.
    expect(visible()).toHaveLength(1);
    context.actions.switchToTab(first);
    expect(visible()[0].querySelector("input")).toBe(input); expect(input.value).toBe("draft state");
  });

  it("shows Settings beside a note, resizes with the keyboard, and expands either pane", () => {
    click("New Note"); const note = context.store.activeTabId!;
    click("Settings"); context.actions.switchToTab(note); context.actions.openTabAlongside("settings_tab");
    expect(visible().map(el => el.id)).toEqual([`content-${note}`, "content-settings_tab"]);
    const divider = document.querySelector<HTMLElement>('[role="separator"]')!;
    divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(context.store.splitView?.ratio).toBe(0.52);
    expect(divider.getAttribute("aria-valuenow")).toBe("52");
    expect(visible()[1].style.left).toBe("52%");
    divider.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(context.store.splitView?.ratio).toBe(0.5);
    document.querySelector<HTMLButtonElement>('[aria-label="Expand Settings"]')!.click();
    expect(visible().map(el => el.id)).toEqual(["content-settings_tab"]);
    expect(document.querySelector('[role="separator"]')).toBeNull();
    expect(context.store.tabs).toHaveLength(2);
  });
});
