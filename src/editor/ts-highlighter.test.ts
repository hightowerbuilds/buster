/**
 * Tests for the syntax highlighter's per-line span conversion.
 *
 * spansToLineTokens converts buster-syntax HighlightSpans (per-line,
 * byte-offset columns, TokenKind) into LineTokens (char offsets, CSS colors)
 * for the canvas renderer.
 */

import { describe, it, expect } from "vitest";
import { spansToLineTokens, type HighlightSpan } from "./ts-highlighter";

// ── Basic mapping ────────────────────────────────────────────────────

describe("spansToLineTokens", () => {
  it("maps a single span on a single line", () => {
    const lines = ["hello world"];
    const spans: HighlightSpan[] = [
      { line: 0, start_col: 0, end_col: 5, kind: "Keyword" },
    ];
    const result = spansToLineTokens(spans, lines);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1);
    expect(result[0][0].start).toBe(0);
    expect(result[0][0].end).toBe(5);
  });

  it("maps multiple spans on a single line", () => {
    const lines = ["let x = 5;"];
    const spans: HighlightSpan[] = [
      { line: 0, start_col: 0, end_col: 3, kind: "Keyword" },    // "let"
      { line: 0, start_col: 4, end_col: 5, kind: "Variable" },   // "x"
      { line: 0, start_col: 8, end_col: 9, kind: "Number" },     // "5"
    ];
    const result = spansToLineTokens(spans, lines);
    expect(result[0]).toHaveLength(3);
    expect(result[0][0]).toMatchObject({ start: 0, end: 3 });
    expect(result[0][1]).toMatchObject({ start: 4, end: 5 });
    expect(result[0][2]).toMatchObject({ start: 8, end: 9 });
  });

  it("maps spans on different lines", () => {
    const lines = ["aaa", "bbb"];
    const spans: HighlightSpan[] = [
      { line: 0, start_col: 0, end_col: 3, kind: "Keyword" },
      { line: 1, start_col: 0, end_col: 3, kind: "String" },
    ];
    const result = spansToLineTokens(spans, lines);
    expect(result[0]).toHaveLength(1);
    expect(result[0][0]).toMatchObject({ start: 0, end: 3 });
    expect(result[1]).toHaveLength(1);
    expect(result[1][0]).toMatchObject({ start: 0, end: 3 });
  });

  it("handles empty lines", () => {
    const lines = ["aaa", "", "bbb"];
    const spans: HighlightSpan[] = [
      { line: 2, start_col: 0, end_col: 3, kind: "Keyword" },
    ];
    const result = spansToLineTokens(spans, lines);
    expect(result[0]).toHaveLength(0);
    expect(result[1]).toHaveLength(0);
    expect(result[2]).toHaveLength(1);
    expect(result[2][0]).toMatchObject({ start: 0, end: 3 });
  });

  it("returns empty arrays when no spans", () => {
    const lines = ["hello", "world"];
    const result = spansToLineTokens([], lines);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(0);
    expect(result[1]).toHaveLength(0);
  });

  it("handles empty document", () => {
    const result = spansToLineTokens([], [""]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(0);
  });

  it("handles multi-byte UTF-8 characters", () => {
    // "café" -> bytes: c(1) a(1) f(1) é(2) = 5 bytes but 4 chars
    const lines = ["café"];
    const spans: HighlightSpan[] = [
      { line: 0, start_col: 0, end_col: 5, kind: "String" },
    ];
    const result = spansToLineTokens(spans, lines);
    expect(result[0]).toHaveLength(1);
    // Should cover all 4 chars (byte-to-char conversion)
    expect(result[0][0].start).toBe(0);
    expect(result[0][0].end).toBe(4);
  });

  it("skips spans with out-of-range line numbers", () => {
    const lines = ["hello"];
    const spans: HighlightSpan[] = [
      { line: 5, start_col: 0, end_col: 3, kind: "Keyword" },
    ];
    const result = spansToLineTokens(spans, lines);
    expect(result[0]).toHaveLength(0);
  });

  it("assigns correct colors based on kind", () => {
    const lines = ["let x = 42;"];
    const spans: HighlightSpan[] = [
      { line: 0, start_col: 0, end_col: 3, kind: "Keyword" },
    ];
    const result = spansToLineTokens(spans, lines);
    expect(result[0][0].color).toBeTruthy();
    expect(typeof result[0][0].color).toBe("string");
  });
});

// ── Performance ──────────────────────────────────────────────────────

describe("perf: spansToLineTokens", () => {
  it("1,000 spans over 500 lines under 20ms", () => {
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) {
      lines.push("const x = someFunction(arg1, arg2);");
    }
    // Generate realistic per-line spans
    const spans: HighlightSpan[] = [];
    for (let i = 0; i < 500; i++) {
      spans.push({ line: i, start_col: 0, end_col: 5, kind: "Keyword" });
      spans.push({ line: i, start_col: 6, end_col: 7, kind: "Variable" });
    }

    const start = performance.now();
    spansToLineTokens(spans, lines);
    const ms = performance.now() - start;
    console.log(`  spansToLineTokens 1k spans / 500 lines: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(20);
  });
});
