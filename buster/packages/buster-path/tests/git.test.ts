import { test, expect, describe } from "bun:test";
import { toGitPath, fromGitPath } from "../src/index.ts";

describe("toGitPath", () => {
  test("converts absolute to repo-relative", () => {
    expect(toGitPath("/home/user/repo/src/main.ts", "/home/user/repo")).toBe("src/main.ts");
  });

  test("converts Windows path to git format", () => {
    expect(toGitPath("C:\\Users\\me\\repo\\src\\main.ts", "C:\\Users\\me\\repo", "win32")).toBe("src/main.ts");
  });
});

describe("fromGitPath", () => {
  test("converts git-relative to absolute", () => {
    expect(fromGitPath("src/main.ts", "/home/user/repo")).toBe("/home/user/repo/src/main.ts");
  });

  test("handles Windows repo root", () => {
    expect(fromGitPath("src/main.ts", "C:\\Users\\me\\repo")).toBe("C:/Users/me/repo/src/main.ts");
  });
});
