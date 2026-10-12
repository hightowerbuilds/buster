import { describe, expect, it } from "vitest";
import { parseRephrasings, rephrasingsFrom } from "./rephrase";

const original = "the brass lantern swung in the wind";

describe("parseRephrasings", () => {
  it("reads a JSON array, even inside a code fence", () => {
    expect(parseRephrasings('```json\n["the lantern of brass swayed", "wind rocked the brass lamp", "a brass lantern swinging"]\n```', original))
      .toEqual(["the lantern of brass swayed", "wind rocked the brass lamp", "a brass lantern swinging"]);
  });

  it("accepts a numbered list when the model ignores the format", () => {
    expect(parseRephrasings("Here you go:\n1. the lantern swayed\n2) wind rocked the lamp\n3. a lamp swinging", original))
      .toEqual(["the lantern swayed", "wind rocked the lamp", "a lamp swinging"]);
  });

  it("drops the original, duplicates, non-strings, and runaway text, and keeps at most three", () => {
    const reply = JSON.stringify(["The brass lantern  swung in the wind", "a lamp swung", "A lamp swung", 7, "x".repeat(5000), "b", "c", "d"]);
    expect(parseRephrasings(reply, original)).toEqual(["a lamp swung", "b", "c"]);
  });

  it("keeps single-line passages on one line and strips wrapping quotes", () => {
    expect(parseRephrasings('["“the lamp\\nswayed”"]', original)).toEqual(["the lamp swayed"]);
  });

  it("fails clearly when nothing is usable", () => {
    expect(() => parseRephrasings("Sorry, I can't help with that.", original)).toThrow(/usable rephrasings/);
  });
});

describe("rephrasingsFrom", () => {
  it("reads Claude's structured output and still validates it", () => {
    expect(rephrasingsFrom({ rephrasings: ["the tide charts, and", "The tide tables, and", "the tidal tables, and"] }, "the tide tables, and"))
      .toEqual(["the tide charts, and", "the tidal tables, and"]);
  });

  it("falls back to a text reply and rejects a malformed one", () => {
    expect(rephrasingsFrom('["a lamp swung"]', original)).toEqual(["a lamp swung"]);
    expect(() => rephrasingsFrom({ other: [] }, original)).toThrow(/usable rephrasings/);
  });
});
