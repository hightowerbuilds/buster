import { describe, expect, it } from "vitest";
import { formatJsonText } from "./json-format";

describe("formatJsonText", () => {
  it("pretty-prints JSON with two-space indentation", () => {
    expect(formatJsonText('{"a":1,"b":{"c":2}}')).toBe(`{
  "a": 1,
  "b": {
    "c": 2
  }
}`);
  });

  it("preserves a trailing newline", () => {
    expect(formatJsonText('{"a":1}\n')).toBe(`{
  "a": 1
}\n`);
  });
});
