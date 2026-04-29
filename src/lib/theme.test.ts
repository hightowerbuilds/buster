/**
 * Tests for the theme system: palette generation, color math, and constants.
 */

import { describe, it, expect } from "vitest";
import { generatePalette, CATPPUCCIN, LIGHT_THEME, withSyntaxOverrides, type ThemePalette } from "./theme";

// ── Helpers ──────────────────────────────────────────────────────────

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const RGBA_RE = /^rgba?\(/;

function isValidColor(c: string): boolean {
  return HEX_RE.test(c) || RGBA_RE.test(c);
}

function assertPaletteShape(p: ThemePalette) {
  // Backgrounds
  expect(typeof p.editorBg).toBe("string");
  expect(typeof p.gutterBg).toBe("string");
  expect(typeof p.surface0).toBe("string");
  expect(typeof p.surface1).toBe("string");
  expect(typeof p.surface2).toBe("string");

  // Text
  expect(typeof p.text).toBe("string");
  expect(typeof p.textDim).toBe("string");
  expect(typeof p.textMuted).toBe("string");

  // Accents
  expect(typeof p.accent).toBe("string");
  expect(typeof p.cursor).toBe("string");

  // Effects (0–100)
  expect(p.vignette).toBeGreaterThanOrEqual(0);
  expect(p.vignette).toBeLessThanOrEqual(100);
  expect(p.grain).toBeGreaterThanOrEqual(0);
  expect(p.grain).toBeLessThanOrEqual(100);
  expect(p.cursorGlow).toBeGreaterThanOrEqual(0);
  expect(p.cursorGlow).toBeLessThanOrEqual(100);

  // Syntax
  expect(typeof p.syntax).toBe("object");
  expect(typeof p.syntaxDefault).toBe("string");

  // CSS overrides
  expect(typeof p.cssBase).toBe("string");
  expect(typeof p.cssMantle).toBe("string");
  expect(typeof p.cssCrust).toBe("string");

  // RGB accent tuple
  expect(Array.isArray(p.accentRgb)).toBe(true);
  expect(p.accentRgb).toHaveLength(3);
  for (const v of p.accentRgb) {
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(255);
  }
}

// ── Pre-defined palettes ─────────────────────────────────────────────

describe("pre-defined palettes", () => {
  it("CATPPUCCIN has valid shape", () => {
    assertPaletteShape(CATPPUCCIN);
  });

  it("LIGHT_THEME has valid shape", () => {
    assertPaletteShape(LIGHT_THEME);
  });

  it("CATPPUCCIN has dark backgrounds", () => {
    // Catppuccin Mocha bg should be dark (#1e1e2e)
    expect(CATPPUCCIN.editorBg).toMatch(HEX_RE);
    const r = parseInt(CATPPUCCIN.editorBg.slice(1, 3), 16);
    expect(r).toBeLessThan(80); // dark
  });

  it("LIGHT_THEME has light backgrounds", () => {
    const r = parseInt(LIGHT_THEME.editorBg.slice(1, 3), 16);
    expect(r).toBeGreaterThan(180); // light
  });

  it("both palettes have syntax colors", () => {
    expect(Object.keys(CATPPUCCIN.syntax).length).toBeGreaterThan(3);
    expect(Object.keys(LIGHT_THEME.syntax).length).toBeGreaterThan(3);
  });
});

// ── generatePalette ──────────────────────────────────────────────────

describe("generatePalette", () => {
  const defaultFx = { bgGlow: 0, cursorGlow: 0, vignette: 0, grain: 0 };

  it("returns valid palette for hue 0", () => {
    const p = generatePalette(0, defaultFx);
    assertPaletteShape(p);
  });

  it("returns valid palette for hue 180", () => {
    const p = generatePalette(180, defaultFx);
    assertPaletteShape(p);
  });

  it("returns valid palette for hue 360", () => {
    const p = generatePalette(360, defaultFx);
    assertPaletteShape(p);
  });

  it("different hues produce different accent colors", () => {
    const p1 = generatePalette(0, defaultFx);
    const p2 = generatePalette(180, defaultFx);
    expect(p1.accent).not.toBe(p2.accent);
  });

  it("passes through effect values", () => {
    const fx = { bgGlow: 50, cursorGlow: 30, vignette: 20, grain: 10 };
    const p = generatePalette(0, fx);
    expect(p.vignette).toBe(20);
    expect(p.grain).toBe(10);
    expect(p.cursorGlow).toBe(30);
  });

  it("all syntax colors are valid hex", () => {
    const p = generatePalette(120, defaultFx);
    for (const [key, color] of Object.entries(p.syntax)) {
      expect(isValidColor(color), `syntax.${key} = "${color}" is not a valid color`).toBe(true);
    }
  });

  it("applies valid syntax overrides", () => {
    const p = withSyntaxOverrides(CATPPUCCIN, {
      keyword: "#ff00aa",
      string: "invalid",
    });
    expect(p.syntax.keyword).toBe("#ff00aa");
    expect(p.syntax.string).toBe(CATPPUCCIN.syntax.string);
  });
});

// ── Performance ──────────────────────────────────────────────────────

describe("perf: theme", () => {
  it("generatePalette under 5ms", () => {
    const fx = { bgGlow: 50, cursorGlow: 30, vignette: 20, grain: 10 };
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      generatePalette(i * 3.6, fx);
    }
    const ms = performance.now() - start;
    console.log(`  100x generatePalette: ${ms.toFixed(2)} ms (${(ms / 100).toFixed(3)} ms avg)`);
    expect(ms / 100).toBeLessThan(5);
  });
});
