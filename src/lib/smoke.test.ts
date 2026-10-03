/**
 * Smoke tests — verify that core modules load and initialize without crashing.
 *
 * These don't test deep behavior. They answer: "does the app start?"
 * If any of these fail, something fundamental is broken.
 */

import { describe, it, expect } from "vitest";

// ── Editor engine ────────────────────────────────────────────────────

describe("smoke: editor engine", () => {
  it("creates an engine from empty string", async () => {
    const { createEditorEngine } = await import("../editor/engine");
    const e = createEditorEngine("");
    expect(e.lines()).toEqual([""]);
    expect(e.cursor()).toEqual({ line: 0, col: 0 });
    expect(e.dirty()).toBe(false);
  });

  it("creates an engine from multi-line text", async () => {
    const { createEditorEngine } = await import("../editor/engine");
    const e = createEditorEngine("line1\nline2\nline3");
    expect(e.lineCount()).toBe(3);
  });

  it("basic edit cycle: insert, undo, redo", async () => {
    const { createEditorEngine } = await import("../editor/engine");
    const e = createEditorEngine("hello");
    e.setCursor({ line: 0, col: 5 });
    e.insert(" world");
    expect(e.getText()).toBe("hello world");
    e.undo();
    expect(e.getText()).toBe("hello");
    e.redo();
    expect(e.getText()).toBe("hello world");
  });
});

// ── Display rows ─────────────────────────────────────────────────────

describe("smoke: computeDisplayRows", () => {
  it("computes rows without crashing", async () => {
    const { computeDisplayRows } = await import("../editor/engine");
    const rows = computeDisplayRows(["hello", "world"], 8, 800, false, 50);
    expect(rows).toHaveLength(2);
  });

  it("handles word wrap on long lines", async () => {
    const { computeDisplayRows } = await import("../editor/engine");
    const longLine = "a".repeat(200);
    const rows = computeDisplayRows([longLine], 8, 200, true, 50);
    expect(rows.length).toBeGreaterThan(1);
  });
});

// ── Text measurement ─────────────────────────────────────────────────

describe("smoke: text-measure", () => {
  it("getCharWidth returns a positive number", async () => {
    const { getCharWidth } = await import("../editor/text-measure");
    const w = getCharWidth(14);
    expect(w).toBeGreaterThan(0);
    expect(typeof w).toBe("number");
  });

  it("getCharWidth is cached (same value on second call)", async () => {
    const { getCharWidth } = await import("../editor/text-measure");
    const w1 = getCharWidth(16);
    const w2 = getCharWidth(16);
    expect(w1).toBe(w2);
  });
});

// ── Command registry ─────────────────────────────────────────────────

describe("smoke: command registry", () => {
  it("registers and executes a command", async () => {
    const { registry } = await import("./command-registry");
    let called = false;
    registry.register({ id: "smoke.test", label: "Smoke", execute: () => { called = true; } });
    registry.execute("smoke.test");
    expect(called).toBe(true);
    registry.unregister("smoke.test");
  });

  it("search returns results", async () => {
    const { registry } = await import("./command-registry");
    registry.register({ id: "smoke.search", label: "Find Something", execute: () => {} });
    const results = registry.search("find");
    expect(results.length).toBeGreaterThan(0);
    registry.unregister("smoke.search");
  });
});

// ── Theme ────────────────────────────────────────────────────────────

describe("smoke: theme", () => {
  it("CATPPUCCIN palette loads", async () => {
    const { CATPPUCCIN } = await import("./theme");
    expect(CATPPUCCIN.editorBg).toBeTruthy();
    expect(CATPPUCCIN.syntax).toBeTruthy();
  });

  it("LIGHT_THEME palette loads", async () => {
    const { LIGHT_THEME } = await import("./theme");
    expect(LIGHT_THEME.editorBg).toBeTruthy();
  });

  it("generatePalette returns a palette", async () => {
    const { generatePalette } = await import("./theme");
    const p = generatePalette(200, { bgGlow: 0, cursorGlow: 0, vignette: 0, grain: 0 });
    expect(p.editorBg).toBeTruthy();
    expect(p.accent).toBeTruthy();
    expect(p.syntax).toBeTruthy();
  });
});

// ── Highlighter ──────────────────────────────────────────────────────

describe("smoke: highlighter", () => {
  it("spansToLineTokens returns correct number of lines", async () => {
    const { spansToLineTokens } = await import("../editor/ts-highlighter");
    const result = spansToLineTokens([], ["a", "b", "c"]);
    expect(result).toHaveLength(3);
  });
});

// ── Tab types ────────────────────────────────────────────────────────

describe("smoke: tab types", () => {
  it("Tab interface is importable", async () => {
    const mod = await import("./tab-types");
    // Just verify the module loads — types are compile-time only
    expect(mod).toBeDefined();
  });
});
