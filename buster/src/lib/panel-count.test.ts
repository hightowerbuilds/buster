import { describe, expect, it } from "vitest";

import {
  autoDemotePanelCount,
  clampPanelCount,
  panelDescription,
  panelLabel,
  parsePanelCount,
  serializePanelCount,
} from "./panel-count";

describe("panel-count", () => {
  it("parses both g-count tokens and legacy layout names", () => {
    expect(parsePanelCount("g1")).toBe(1);
    expect(parsePanelCount("g6")).toBe(6);
    expect(parsePanelCount("tabs")).toBe(1);
    expect(parsePanelCount("columns")).toBe(2);
    expect(parsePanelCount("trio")).toBe(3);
    expect(parsePanelCount("grid")).toBe(4);
    expect(parsePanelCount("quint")).toBe(5);
    expect(parsePanelCount("restack")).toBe(5);
    expect(parsePanelCount("hq")).toBe(6);
  });

  it("serializes and labels counts consistently", () => {
    expect(serializePanelCount(1)).toBe("g1");
    expect(serializePanelCount(6)).toBe("g6");
    expect(panelLabel(4)).toBe("g4");
    expect(panelDescription(2)).toBe("Two columns");
  });

  it("clamps out-of-range counts into the supported g1-g6 range", () => {
    expect(clampPanelCount(0)).toBe(1);
    expect(clampPanelCount(2.4)).toBe(2);
    expect(clampPanelCount(8)).toBe(6);
  });

  it("demotes panel counts as tabs are closed", () => {
    expect(autoDemotePanelCount(6, 5)).toBe(5);
    expect(autoDemotePanelCount(5, 4)).toBe(4);
    expect(autoDemotePanelCount(4, 3)).toBe(3);
    expect(autoDemotePanelCount(3, 2)).toBe(2);
    expect(autoDemotePanelCount(2, 1)).toBe(1);
  });

  it("never auto-promotes when more tabs exist than the current count", () => {
    expect(autoDemotePanelCount(1, 6)).toBe(1);
    expect(autoDemotePanelCount(2, 5)).toBe(2);
    expect(autoDemotePanelCount(4, 6)).toBe(4);
  });
});
