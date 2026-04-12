import { test, expect, describe } from "bun:test";
import { pathsEqual, isDescendant } from "../src/index.ts";

describe("pathsEqual", () => {
  test("equal paths on Linux (case-sensitive)", () => {
    expect(pathsEqual("/home/user/file.ts", "/home/user/file.ts", "linux")).toBe(true);
  });

  test("different case on Linux", () => {
    expect(pathsEqual("/home/User/File.ts", "/home/user/file.ts", "linux")).toBe(false);
  });

  test("different case on macOS (case-insensitive)", () => {
    expect(pathsEqual("/home/User/File.ts", "/home/user/file.ts", "darwin")).toBe(true);
  });

  test("different case on Windows (case-insensitive)", () => {
    expect(pathsEqual("C:\\Users\\Me\\File.ts", "c:\\users\\me\\file.ts", "win32")).toBe(true);
  });

  test("normalizes before comparing", () => {
    expect(pathsEqual("/home/user/../user/file.ts", "/home/user/file.ts", "linux")).toBe(true);
  });
});

describe("isDescendant", () => {
  test("child inside parent", () => {
    expect(isDescendant("/home/user/project", "/home/user/project/src/main.ts", "linux")).toBe(true);
  });

  test("not a descendant", () => {
    expect(isDescendant("/home/user/project", "/home/user/other/file.ts", "linux")).toBe(false);
  });

  test("parent itself is not a descendant", () => {
    expect(isDescendant("/home/user/project", "/home/user/project", "linux")).toBe(false);
  });

  test("case-insensitive on macOS", () => {
    expect(isDescendant("/Home/User/Project", "/home/user/project/src/file.ts", "darwin")).toBe(true);
  });
});
