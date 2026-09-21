import { afterEach, expect, it, vi } from "vitest";
import { focusTabPanel, focusSidebarPrimary } from "./focus-service";

afterEach(() => vi.unstubAllGlobals());

it("ignores deferred focus for a pane superseded before the next frame", () => {
  const frames: FrameRequestCallback[] = [];
  const first = { focus: vi.fn() }, second = { focus: vi.fn() };
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("document", {
    activeElement: null,
    querySelectorAll: () => [
      { dataset: { tabPanelId: "first" }, querySelector: () => first },
      { dataset: { tabPanelId: "second" }, querySelector: () => second },
    ],
  });
  focusTabPanel("first");
  focusTabPanel("second");
  frames.forEach(callback => callback(0));
  expect(first.focus).not.toHaveBeenCalled();
  expect(second.focus).toHaveBeenCalledOnce();
});

it("lets a later sidebar request supersede queued editor focus", () => {
  const frames: FrameRequestCallback[] = [];
  const editor = { focus: vi.fn() }, sidebar = { focus: vi.fn() };
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("document", {
    activeElement: null,
    querySelectorAll: () => [{ dataset: { tabPanelId: "draft" }, querySelector: () => editor }],
    querySelector: () => sidebar,
  });
  focusTabPanel("draft");
  focusSidebarPrimary();
  frames.forEach(callback => callback(0));
  expect(editor.focus).not.toHaveBeenCalled();
  expect(sidebar.focus).toHaveBeenCalledOnce();
});
