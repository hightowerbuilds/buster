import { describe, expect, it } from "vitest";
import { LIVELY, SETTLE, isSettled, spring, stepSpring } from "./spring";

function run(target: number, config = LIVELY, frames = 240) {
  const s = spring(0, target);
  let peak = 0;
  for (let i = 0; i < frames && !isSettled(s); i++) {
    stepSpring(s, 1 / 60, config);
    peak = Math.max(peak, s.value);
  }
  return { s, peak };
}

describe("springs", () => {
  it("settles exactly on the target", () => {
    const { s } = run(120);
    expect(isSettled(s)).toBe(true);
    expect(s.value).toBe(120);
    expect(s.velocity).toBe(0);
  });

  it("overshoots when lively, so motion reads as springy", () => {
    expect(run(100).peak).toBeGreaterThan(100);
  });

  it("returns exactly to the origin", () => {
    const s = spring(37.5, 0);
    for (let i = 0; i < 240 && !isSettled(s); i++) stepSpring(s, 1 / 60, SETTLE);
    expect(s.value).toBe(0);
  });

  it("stays stable across a long frame", () => {
    const s = spring(0, 50);
    stepSpring(s, 0.5, LIVELY);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Math.abs(s.value - 50)).toBeLessThan(50);
  });
});
