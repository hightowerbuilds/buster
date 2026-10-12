import { describe, expect, it } from "vitest";
import { BLOG_THEMES, resolveBlogTokens, writingStyle } from "./blog-themes";
import type { ThemePalette } from "./theme";

const palette = new Proxy({}, { get: (_, key) => `palette-${String(key)}` }) as ThemePalette;

describe("writing styles", () => {
  it("offers None and Courier", () => {
    expect(BLOG_THEMES.map(theme => theme.label)).toEqual(["None", "Courier"]);
  });

  it("sets Courier in Courier throughout", () => {
    const vars = resolveBlogTokens("courier", palette);
    for (const key of ["--blog-font-family", "--blog-heading-font-family", "--blog-code-font-family"]) expect(vars[key]).toMatch(/^"Courier New", Courier/);
  });

  it("keeps None plain: the note's own text color and no rules or tints", () => {
    const vars = resolveBlogTokens("none", palette);
    expect([vars["--blog-h1-color"], vars["--blog-h2-color"], vars["--blog-strong-color"]]).toEqual(Array(3).fill("palette-text"));
    expect([vars["--blog-h1-border-bottom"], vars["--blog-bq-bg"], vars["--blog-surface"]]).toEqual(["none", "transparent", "transparent"]);
  });

  it("falls back to None for earlier styles", () => {
    for (const retired of ["normal", "newspaper", "technical", "business", undefined]) expect(writingStyle(retired)).toBe("none");
    expect(resolveBlogTokens("business", palette)).toEqual(resolveBlogTokens("none", palette));
  });
});
