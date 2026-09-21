import { expect, it } from "vitest";
import { wordSelectionBounds } from "./word-selection";
it("selects Unicode words, combining marks, spaces, and punctuation", () => {
  const text = "A cafe\u0301 世界!";
  expect(wordSelectionBounds(text, 5)).toEqual({ start: 2, end: 7 });
  expect(wordSelectionBounds(text, 9)).toEqual({ start: 8, end: 10 });
  expect(wordSelectionBounds(text, 10)).toEqual({ start: 10, end: 11 });
  expect(wordSelectionBounds("a   b", 2)).toEqual({ start: 1, end: 4 });
});
it("keeps surrogate pairs intact and handles empty and end-of-line clicks", () => {
  expect(wordSelectionBounds("a 😀 b", 3)).toEqual({ start: 2, end: 4 });
  expect(wordSelectionBounds("", 0)).toEqual({ start: 0, end: 0 });
  expect(wordSelectionBounds("word", 4)).toEqual({ start: 0, end: 4 });
});
