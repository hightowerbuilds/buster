import { describe, expect, it } from "vitest";
import { BLOG_THEMES, resolveBlogTokens } from "./blog-themes";
import type { ThemePalette } from "./theme";

const palette = new Proxy({}, { get: (_, key) => `palette-${String(key)}` }) as ThemePalette;

describe("resolveBlogTokens", () => {
  it("gives every writing style its own typography", () => {
    const families = BLOG_THEMES.map(theme => resolveBlogTokens(theme.id, "dark", palette)["--blog-font-family"]);
    expect(new Set(families).size).toBe(BLOG_THEMES.length);
  });

  it("sets Newspaper headlines in a legible bold serif, not blackletter", () => {
    for (const mode of ["light", "dark"]) {
      const vars = resolveBlogTokens("newspaper", mode, palette);
      expect(vars["--blog-h1-font-family"]).toMatch(/^"Playfair Display"/);
      expect(vars["--blog-h1-font-family"]).not.toMatch(/Unifraktur/);
      expect(Number(vars["--blog-h1-font-weight"])).toBeGreaterThanOrEqual(700);
    }
  });

  it("adapts Business navy to the theme mode", () => {
    expect(resolveBlogTokens("business", "light", palette)["--blog-h1-color"]).toBe("#1f3a5f");
    expect(resolveBlogTokens("business", "dark", palette)["--blog-h1-color"]).toBe("#9db8d9");
  });

  it("falls back to Normal for unknown styles", () => {
    expect(resolveBlogTokens("retired-style", "dark", palette)).toEqual(resolveBlogTokens("normal", "dark", palette));
  });
});
