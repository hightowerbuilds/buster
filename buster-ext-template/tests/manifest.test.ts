import { test, expect, describe } from "bun:test";
import { validateId, validateManifest, type ExtensionManifest } from "../src/manifest.ts";

describe("validateId", () => {
  test("accepts valid IDs", () => {
    expect(validateId("buster-format")).toEqual([]);
    expect(validateId("my-ext-123")).toEqual([]);
    expect(validateId("a")).toEqual([]);
  });

  test("rejects empty ID", () => {
    expect(validateId("")).toContainEqual("id is required");
  });

  test("rejects path traversal", () => {
    const errors = validateId("../malicious");
    expect(errors.length).toBeGreaterThan(0);
  });

  test("rejects uppercase", () => {
    const errors = validateId("Bad-Name");
    expect(errors.length).toBeGreaterThan(0);
  });

  test("rejects leading hyphen", () => {
    const errors = validateId("-starts-bad");
    expect(errors.length).toBeGreaterThan(0);
  });

  test("rejects trailing hyphen", () => {
    const errors = validateId("ends-bad-");
    expect(errors.length).toBeGreaterThan(0);
  });

  test("rejects consecutive hyphens", () => {
    const errors = validateId("double--dash");
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("validateManifest", () => {
  const validManifest: ExtensionManifest = {
    extension: {
      id: "test-ext",
      name: "Test Extension",
      version: "0.1.0",
      entry: "target/wasm32-unknown-unknown/release/test_ext.wasm",
    },
  };

  test("accepts valid manifest", () => {
    expect(validateManifest(validManifest)).toEqual([]);
  });

  test("rejects missing extension section", () => {
    const errors = validateManifest({} as any);
    expect(errors.length).toBeGreaterThan(0);
  });

  test("rejects path traversal in entry", () => {
    const bad = {
      ...validManifest,
      extension: { ...validManifest.extension, entry: "../../etc/passwd" },
    };
    const errors = validateManifest(bad);
    expect(errors.some((e) => e.includes("entry"))).toBe(true);
  });

  test("rejects absolute entry path", () => {
    const bad = {
      ...validManifest,
      extension: { ...validManifest.extension, entry: "/usr/bin/evil" },
    };
    const errors = validateManifest(bad);
    expect(errors.some((e) => e.includes("entry"))).toBe(true);
  });
});
