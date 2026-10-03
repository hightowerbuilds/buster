// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundBudget, createBackgroundPlayback } from "./background-playback";

afterEach(() => vi.restoreAllMocks());
describe("background playback budget", () => {
  it("ignores isolated delays but reduces detail and eventually pauses sustained slow frames", () => {
    const budget = new BackgroundBudget();
    for (let n = 0; n < 100; n++) budget.observe(n % 12 === 0 ? 200 : 34);
    expect(budget.level).toBe(0);
    for (let n = 0; n < 60; n++) budget.observe(80);
    expect(budget.paused).toBe(true);
  });
  it("allows recovery at a lower resolution and excludes gaps after visibility changes", () => {
    const budget = new BackgroundBudget();
    for (let n = 0; n < 17; n++) budget.observe(80);
    expect(budget.scale).toBe(0.5);
    budget.resetWindow();
    budget.observe(30_000);
    for (let n = 0; n < 100; n++) budget.observe(34);
    expect(budget.level).toBe(1);
  });
  it("caps drawing, suspends hidden views, respects reduced motion and cleans up", () => {
    const motion = new EventTarget() as EventTarget & { matches: boolean };
    motion.matches = false;
    vi.stubGlobal("matchMedia", () => motion);
    let resized!: () => void;
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect = disconnect; });
    let next: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { next = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => { next = undefined; });
    const canvas = document.createElement("canvas");
    let width = 1000;
    Object.defineProperties(canvas, { clientWidth: { get: () => width }, clientHeight: { value: 600 } });
    const renderer = { draw: vi.fn(), contextLost: false };
    const playback = createBackgroundPlayback(canvas, renderer, {
      scale: 0.5, animate: () => true, notice: vi.fn(),
      uniforms: time => ({ width: 1, height: 1, time, strength: 1, accent: [1, 1, 1, 1], paper: [0, 0, 0, 1], ink: [1, 1, 1, 1] }),
    });
    const step = (time: number) => { const callback = next; next = undefined; callback?.(time); };
    playback.reset();
    step(100); step(116); step(134);
    expect(renderer.draw).toHaveBeenCalledTimes(2);
    width = 0; resized();
    expect(next).toBeUndefined();
    width = 1000; resized();
    expect(next).toBeDefined();
    motion.matches = true; motion.dispatchEvent(new Event("change"));
    expect(next).toBeUndefined();
    expect(renderer.draw).toHaveBeenLastCalledWith(expect.objectContaining({ time: 4, width: 500, height: 300 }));
    playback.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
    motion.matches = false; motion.dispatchEvent(new Event("change"));
    expect(next).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
