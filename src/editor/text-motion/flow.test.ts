import { beforeAll, describe, expect, it } from "vitest";
import type { FlowRun, MeasureText, Opening } from "./flow";

// Every character is 10px wide, so line breaks are predictable.
const measure: MeasureText = text => text.length * 10;
let flowAroundOpening: typeof import("./flow").flowAroundOpening;

beforeAll(async () => {
  globalThis.OffscreenCanvas = class {
    getContext() { return { font: "", measureText: (text: string) => ({ width: text.length * 10 }) }; }
  } as unknown as typeof OffscreenCanvas;
  ({ flowAroundOpening } = await import("./flow"));
});

const runs = (text: string): FlowRun[] => [{ text, font: "16px Lato" }];
const rowsOf = (words: { text: string; row: number }[]) =>
  words.reduce<string[][]>((rows, word) => { (rows[word.row] ??= []).push(word.text); return rows; }, []);

describe("flowAroundOpening", () => {
  it("lays text in full-width rows when there is no opening", () => {
    const { words, rows } = flowAroundOpening(runs("aa bb cc dd ee"), 80, null, 30, measure);
    expect(rowsOf(words)).toEqual([["aa", "bb", "cc"], ["dd", "ee"]]);
    expect(rows).toBe(2);
    expect(words.slice(0, 3).map(word => word.x)).toEqual([0, 30, 60]);
  });

  it("parts rows around the opening into a left and a right span", () => {
    const opening: Opening = { left: 50, right: 150, top: 0, rows: 2 };
    const { words } = flowAroundOpening(runs("aa bb cc dd ee ff gg hh ii jj"), 200, opening, 30, measure);
    const inOpening = words.filter(word => word.row < 2 && word.x + word.text.length * 10 > 50 && word.x < 150);
    expect(inOpening).toEqual([]);
    // "aa bb" fills the 50px left span exactly; "cc dd" fills the right span after the opening.
    expect(words.filter(word => word.row === 0).map(word => [word.text, word.x])).toEqual([["aa", 0], ["bb", 30], ["cc", 150], ["dd", 180]]);
  });

  it("leaves a span empty when it is narrower than the minimum", () => {
    const opening: Opening = { left: 10, right: 120, top: 0, rows: 1 };
    const { words } = flowAroundOpening(runs("aa bb cc"), 200, opening, 30, measure);
    expect(words.filter(word => word.row === 0).every(word => word.x >= 120)).toBe(true);
  });

  it("reserves the opening's rows even when the text ends first", () => {
    const { words, rows } = flowAroundOpening(runs("aa"), 200, { left: 60, right: 140, top: 0, rows: 3 }, 30, measure);
    expect(words).toHaveLength(1);
    expect(rows).toBe(3);
  });

  it("keeps each word's run so mixed-font runs map back to their source", () => {
    const { words } = flowAroundOpening(
      [{ text: "plain ", font: "16px Lato" }, { text: "bold", font: "700 16px Lato" }, { text: " tail", font: "16px Lato" }],
      400, null, 30, measure);
    expect(words.map(word => [word.text, word.run])).toEqual([["plain", 0], ["bold", 1], ["tail", 2]]);
  });

  it("returns no words for whitespace-only input", () => {
    expect(flowAroundOpening(runs("   "), 200, null, 30, measure).words).toEqual([]);
  });
});
