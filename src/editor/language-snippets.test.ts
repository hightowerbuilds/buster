import { describe, expect, it } from "vitest";
import {
  expandLanguageSnippetBeforeCursor,
  expandTypedLanguageSnippet,
  inferLanguageId,
} from "./language-snippets";
import {
  getAutoClosePairMap,
  getClosingPairSet,
  getLanguageDefinitionForPath,
  LANGUAGE_DEFINITIONS,
} from "./language-registry";

describe("language snippet detection", () => {
  it("infers language from saved paths and unsaved tab names", () => {
    expect(inferLanguageId("/tmp/index.html")).toBe("html");
    expect(inferLanguageId("scratch.htm")).toBe("html");
    expect(inferLanguageId("component.tsx")).toBe("typescript");
    expect(inferLanguageId("script.py")).toBe("python");
    expect(inferLanguageId("Cargo.toml")).toBe("toml");
    expect(inferLanguageId("Untitled-1")).toBeNull();
  });
});

describe("language registry", () => {
  it("contains common editor language definitions", () => {
    const ids = new Set(LANGUAGE_DEFINITIONS.map((language) => language.id));
    expect(ids).toContain("html");
    expect(ids).toContain("javascript");
    expect(ids).toContain("typescript");
    expect(ids).toContain("css");
    expect(ids).toContain("json");
    expect(ids).toContain("rust");
    expect(ids).toContain("python");
    expect(ids).toContain("go");
    expect(ids).toContain("markdown");
    expect(ids).toContain("yaml");
  });

  it("exposes comment tokens by language", () => {
    expect(getLanguageDefinitionForPath("main.rs")?.comments?.line).toBe("//");
    expect(getLanguageDefinitionForPath("script.py")?.comments?.line).toBe("#");
    expect(getLanguageDefinitionForPath("query.sql")?.comments?.line).toBe("--");
    expect(getLanguageDefinitionForPath("index.html")?.comments?.block).toEqual({ open: "<!--", close: "-->" });
  });

  it("exposes auto-close and closing pairs", () => {
    expect(getAutoClosePairMap("index.html")["<"]).toBe(">");
    expect(getAutoClosePairMap("main.ts")["{"]).toBe("}");
    expect(getClosingPairSet("main.ts").has("}")).toBe(true);
  });
});

describe("HTML snippets", () => {
  it("expands ! immediately in a blank HTML document", () => {
    const result = expandTypedLanguageSnippet("!", {
      languagePath: "index.html",
      lines: [""],
      cursor: { line: 0, col: 0 },
      indentUnit: "  ",
    });

    expect(result?.text).toContain("<!DOCTYPE html>");
    expect(result?.text).toContain("<html lang=\"en\">");
    expect(result?.text).toContain("  <meta charset=\"UTF-8\">");
    expect(result?.cursor).toEqual({ line: 8, col: 2 });
  });

  it("does not expand ! in non-HTML files", () => {
    const result = expandTypedLanguageSnippet("!", {
      languagePath: "index.js",
      lines: [""],
      cursor: { line: 0, col: 0 },
      indentUnit: "  ",
    });

    expect(result).toBeNull();
  });

  it("does not expand ! when the document has other content", () => {
    const result = expandTypedLanguageSnippet("!", {
      languagePath: "index.html",
      lines: ["<p>Already here</p>"],
      cursor: { line: 0, col: 0 },
      indentUnit: "  ",
    });

    expect(result).toBeNull();
  });

  it("supports ! then Tab expansion for HTML", () => {
    const result = expandLanguageSnippetBeforeCursor({
      languagePath: "index.html",
      lines: ["!"],
      cursor: { line: 0, col: 1 },
      indentUnit: "    ",
    });

    expect(result?.from).toEqual({ line: 0, col: 0 });
    expect(result?.to).toEqual({ line: 0, col: 1 });
    expect(result?.text).toContain("<body>");
    expect(result?.cursor).toEqual({ line: 8, col: 4 });
  });
});
