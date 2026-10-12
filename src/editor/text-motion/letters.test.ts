import { describe, expect, it } from "vitest";
import { graphemes, matchLetters } from "./letters";

describe("matchLetters", () => {
  it("pairs every letter of an exact match", () => {
    expect(matchLetters(graphemes("lantern"), graphemes("lantern"))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("ignores case and drops inflection the headword lacks", () => {
    expect(matchLetters(graphemes("Lanterns"), graphemes("lantern"))).toEqual([0, 1, 2, 3, 4, 5, 6, -1]);
  });

  it("matches across accents and leaves missing headword letters unpaired", () => {
    expect(matchLetters(graphemes("cafe"), graphemes("café"))).toEqual([0, 1, 2, 3]);
    expect(matchLetters(graphemes("ran"), graphemes("run"))).toEqual([0, -1, 2]);
  });

  it("keeps combined graphemes whole", () => {
    expect(graphemes("café")).toEqual(["c", "a", "f", "é"]);
  });
});
