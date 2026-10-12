import { describe, expect, it } from "vitest";
import { formatDuration, passageStats, wordUses } from "./stats";

describe("passageStats", () => {
  it("counts words, characters, and sentences", () => {
    expect(passageStats("The brass lantern swung. It creaked in the wind!")).toEqual({
      words: 9, characters: 48, charactersNoSpaces: 40, sentences: 2, readingSeconds: 2,
    });
  });

  it("ignores punctuation as words and counts at least one second", () => {
    const stats = passageStats("well — then, “yes”");
    expect(stats.words).toBe(3);
    expect(stats.readingSeconds).toBe(1);
  });
});

describe("formatDuration", () => {
  it("reads naturally", () => {
    expect(formatDuration(4)).toBe("4 sec");
    expect(formatDuration(72)).toBe("1 min 12 sec");
    expect(formatDuration(180)).toBe("3 min");
  });
});

describe("wordUses", () => {
  it("counts each selected word in the selection and the whole note, ignoring case", () => {
    const note = "The tide turned. The tide tables said the tide was late, and the crew agreed.";
    expect(wordUses("the tide tables, and The", note)).toEqual([
      { word: "the", inSelection: 2, inNote: 4 },
      { word: "tide", inSelection: 1, inNote: 3 },
      { word: "tables", inSelection: 1, inNote: 1 },
      { word: "and", inSelection: 1, inNote: 1 },
    ]);
  });
});
