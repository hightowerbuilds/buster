import { describe, expect, it } from "vitest";
import { countWords, wordCountLabel } from "./word-count";

describe("countWords", () => {
  it("counts words and ignores Markdown syntax and punctuation", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\n ")).toBe(0);
    expect(countWords("# Up With It\n\n- **bold** item\n> quoted *words*")).toBe(7);
    expect(countWords("What is risk? What is it to ride the bull?")).toBe(10);
  });

  it("keeps contractions, hyphenated words and numbers whole", () => {
    expect(countWords("It's a well-known fact, don’t you think? 2026 was 42.")).toBe(10);
  });

  it("counts accented and non-Latin words", () => {
    expect(countWords("café naïve Москва")).toBe(3);
  });
});

describe("wordCountLabel", () => {
  it("uses singular and plural forms and shows selections", () => {
    expect(wordCountLabel(1)).toBe("1 word");
    expect(wordCountLabel(1234)).toBe(`${(1234).toLocaleString()} words`);
    expect(wordCountLabel(340, 12)).toBe("12 of 340 words");
    expect(wordCountLabel(340, 0)).toBe("340 words");
  });
});
