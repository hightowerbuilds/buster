import { describe, expect, it } from "vitest";
import { minimapLeft, minimapScrollTarget } from "./render-minimap";

describe("minimap geometry", () => {
  it("places the minimap against the right edge before the scrollbar", () => {
    expect(minimapLeft(800)).toBe(724);
  });

  it("maps a click in the minimap to a centered scroll target", () => {
    const target = minimapScrollTarget(300, 1000, 600, 20);

    expect(target).toBe(9700);
  });

  it("clamps top clicks to the start of the document", () => {
    const target = minimapScrollTarget(0, 1000, 600, 20);

    expect(target).toBe(0);
  });

  it("clamps bottom clicks to the last viewport", () => {
    const target = minimapScrollTarget(600, 1000, 600, 20);

    expect(target).toBe(19400);
  });
});
