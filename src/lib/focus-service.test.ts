import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusTabPanel } from "./focus-service";

let panels: ReturnType<typeof panel>[];
let microtasks: Array<() => void>;
let frames: FrameRequestCallback[];
let focused: unknown;
function panel(id: string, visible = true) {
  const input = { isConnected: true, getClientRects: () => visible ? [{}] : [],
    focus: vi.fn(() => { focused = input; }) };
  return { dataset: { tabPanelId: id }, querySelector: () => input, input };
}
beforeEach(() => {
  panels = []; microtasks = []; frames = []; focused = { tagName: "BUTTON" };
  vi.stubGlobal("document", { querySelectorAll: () => panels, get activeElement() { return focused; } });
  vi.stubGlobal("queueMicrotask", (fn: () => void) => microtasks.push(fn));
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => frames.push(fn));
});
afterEach(() => vi.unstubAllGlobals());

describe("note focus handoff", () => {
  it("focuses a mounted editor before the next key event, without waiting for paint", () => {
    const note = panel("new-note"); panels.push(note);
    focusTabPanel("new-note");
    expect(focused).toBe(note.input);
    expect(note.input.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(frames).toHaveLength(0);
    expect(microtasks).toHaveLength(0);
  });
  it("finishes a batched note mount in a microtask instead of leaving focus on the button", () => {
    focusTabPanel("new-note");
    const note = panel("new-note"); panels.push(note);
    microtasks.shift()!();
    expect(focused).toBe(note.input);
    expect(frames).toHaveLength(0);
  });
  it("does not steal focus back when the user switches to another panel", () => {
    focusTabPanel("new-note");
    const settings = panel("settings"); panels.push(settings);
    focusTabPanel("settings");
    const note = panel("new-note"); panels.push(note);
    microtasks.shift()!();
    expect(focused).toBe(settings.input);
    expect(note.input.focus).not.toHaveBeenCalled();
  });
  it("uses one frame fallback only when the new panel is still unavailable", () => {
    focusTabPanel("new-note"); microtasks.shift()!();
    expect(frames).toHaveLength(1);
    const note = panel("new-note"); panels.push(note);
    frames.shift()!(0);
    expect(focused).toBe(note.input);
  });
});
