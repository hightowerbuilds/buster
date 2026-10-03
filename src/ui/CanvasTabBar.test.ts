// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createComponent, createSignal } from "solid-js";
import { render, insert } from "solid-js/web";
import CanvasTabBar from "./CanvasTabBar";
import { focusTabPanel } from "../lib/focus-service";

vi.mock("../lib/buster-context", () => ({ useBuster: () => ({ store: { palette: {} } }) }));
vi.mock("./ContextMenu", () => ({ default: () => null }));
vi.mock("./canvas-chrome", () => ({ CHROME_FONT: "sans-serif", CHROME_MONO: "monospace", default: (props: any) => {
  const node = document.createElement("div");
  node.tabIndex = props.tabIndex;
  node.setAttribute("role", props.role);
  node.addEventListener("keydown", props.onKeyDown);
  insert(node, () => props.children);
  return node;
} }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it("keeps repeated arrow navigation in the tab list and enters content explicitly", async () => {
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const [active, setActive] = createSignal("a");
  const tabs = ["a", "b", "c"].map(id => ({ id, name: id, path: "", type: "file" as const, dirty: false }));
  const root = document.createElement("div"); document.body.append(root);
  const panel = document.createElement("div"); panel.dataset.tabPanelId = "b";
  const input = document.createElement("textarea");
  input.getClientRects = () => [{}] as unknown as DOMRectList;
  panel.append(input); document.body.append(panel);
  dispose = render(() => createComponent(CanvasTabBar, { tabs, get activeTab() { return active(); },
    onSelect: id => { setActive(id); focusTabPanel(id); }, onClose: vi.fn(),
  }), root);
  const list = root.querySelector<HTMLElement>('[role="tablist"]')!;
  const key = (key: string) => list.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  list.focus(); key("ArrowRight");
  expect(active()).toBe("b"); expect(document.activeElement).toBe(list);
  key("ArrowRight"); await Promise.resolve();
  expect(active()).toBe("c"); expect(document.activeElement).toBe(list);
  key("Home"); expect(active()).toBe("a");
  key("End"); expect(active()).toBe("c");
  key("ArrowLeft"); key("Enter");
  expect(active()).toBe("b"); expect(document.activeElement).toBe(input);
  expect(root.querySelector('#tab-b')?.getAttribute("aria-selected")).toBe("true");
});
