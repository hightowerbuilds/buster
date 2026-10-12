import { describe, expect, it } from "vitest";
import { markedSentence, sentenceAround, spellingFrom, SENTENCE_WINDOW } from "./spelling";

describe("sentenceAround", () => {
  const line = "First one here. Their going to the store tomorrow! Last bit.";
  const at = line.indexOf("Their");

  it("finds the sentence holding the word, trimmed", () => {
    const context = sentenceAround(line, at, at + 5);
    expect(context.sentence).toBe("Their going to the store tomorrow!");
    expect(context.start).toBe(at);
    expect(context.word).toBe(0);
    expect(markedSentence(context, "Their")).toBe("⟦Their⟧ going to the store tomorrow!");
  });

  it("marks a word in the middle", () => {
    const from = line.indexOf("store");
    const context = sentenceAround(line, from, from + 5);
    expect(markedSentence(context, "store")).toBe("Their going to the ⟦store⟧ tomorrow!");
  });

  it("cuts a very long sentence to a window around the word", () => {
    const long = `${"word ".repeat(400)}target ${"more ".repeat(400)}`;
    const from = long.indexOf("target");
    const context = sentenceAround(long, from, from + 6);
    expect(context.sentence.length).toBeLessThanOrEqual(SENTENCE_WINDOW);
    expect(context.sentence.slice(context.word, context.word + 6)).toBe("target");
  });
});

describe("spellingFrom", () => {
  const line = "Their going to the stor tomorrow and they buys bread.";
  const from = line.indexOf("stor");
  const context = sentenceAround(line, from, from + 4);

  it("keeps clean suggestions and grammar quoted from the sentence", () => {
    const result = spellingFrom({
      misspelled: true,
      suggestions: ["store", " store ", "stor", "story", "a whole long sentence that is not a word", "⟦stork⟧"],
      grammar: [
        { excerpt: "Their going", replacement: "They're going", explanation: "“Their” is possessive; use “they're” for “they are”." },
        { excerpt: "they buy bread", replacement: "they buy bread", explanation: "Unchanged." },
        { excerpt: "not in the sentence", replacement: "x", explanation: "Invented." },
        { excerpt: "they buys", replacement: "they buy", explanation: "Plural subjects take “buy”." },
      ],
    }, "stor", context);
    expect(result.misspelled).toBe(true);
    expect(result.suggestions).toEqual(["store", "story", "stork"]);
    expect(result.grammar.map(issue => [issue.excerpt, issue.replacement, issue.at])).toEqual([
      ["Their going", "They're going", 0],
      ["they buys", "they buy", context.sentence.indexOf("they buys")],
    ]);
  });

  it("drops suggestions for a word spelled correctly", () => {
    expect(spellingFrom({ misspelled: false, suggestions: ["stir"], grammar: [] }, "stor", context))
      .toEqual({ misspelled: false, suggestions: [], grammar: [] });
  });

  it("reads a JSON reply in text and rejects one without a verdict", () => {
    expect(spellingFrom('```json\n{"misspelled": true, "suggestions": ["store"], "grammar": []}\n```', "stor", context).suggestions).toEqual(["store"]);
    expect(() => spellingFrom({ suggestions: ["store"] }, "stor", context)).toThrow(/spelled correctly/);
    expect(() => spellingFrom("no idea", "stor", context)).toThrow();
  });
});
