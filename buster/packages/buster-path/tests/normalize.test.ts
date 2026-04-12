import { test, expect, describe } from "bun:test";
import { normalizePath, isAbsolute, dirname, basename, extname, join } from "../src/index.ts";

describe("normalizePath", () => {
  test("converts backslashes to forward slashes", () => {
    expect(normalizePath("C:\\Users\\me\\file.ts")).toBe("C:/Users/me/file.ts");
  });

  test("collapses duplicate separators", () => {
    expect(normalizePath("/home//user///file.ts")).toBe("/home/user/file.ts");
  });

  test("resolves . and ..", () => {
    expect(normalizePath("/home/user/./project/../file.ts")).toBe("/home/user/file.ts");
  });

  test("handles UNC paths", () => {
    expect(normalizePath("\\\\server\\share\\file.ts")).toBe("//server/share/file.ts");
  });

  test("uppercases drive letters", () => {
    expect(normalizePath("c:\\users\\me")).toBe("C:/users/me");
  });

  test("returns . for empty string", () => {
    expect(normalizePath("")).toBe(".");
  });

  test("preserves trailing content after ..", () => {
    expect(normalizePath("/a/b/c/../../d")).toBe("/a/d");
  });
});

describe("isAbsolute", () => {
  test("Unix absolute", () => expect(isAbsolute("/home/user")).toBe(true));
  test("Windows absolute", () => expect(isAbsolute("C:\\Users")).toBe(true));
  test("UNC absolute", () => expect(isAbsolute("\\\\server\\share")).toBe(true));
  test("relative", () => expect(isAbsolute("src/main.ts")).toBe(false));
});

describe("dirname", () => {
  test("returns parent directory", () => {
    expect(dirname("/home/user/file.ts")).toBe("/home/user");
  });

  test("returns / for root-level file", () => {
    expect(dirname("/file.ts")).toBe("/");
  });
});

describe("basename", () => {
  test("returns filename", () => {
    expect(basename("/home/user/file.ts")).toBe("file.ts");
  });

  test("strips extension when provided", () => {
    expect(basename("/home/user/file.ts", ".ts")).toBe("file");
  });
});

describe("extname", () => {
  test("returns extension", () => {
    expect(extname("file.ts")).toBe(".ts");
  });

  test("returns empty for no extension", () => {
    expect(extname("Makefile")).toBe("");
  });

  test("returns last extension for multiple dots", () => {
    expect(extname("file.test.ts")).toBe(".ts");
  });
});

describe("join", () => {
  test("joins and normalizes", () => {
    expect(join("/home/user", "project", "src/main.ts")).toBe("/home/user/project/src/main.ts");
  });

  test("handles mixed separators", () => {
    expect(join("C:\\Users", "me", "docs")).toBe("C:/Users/me/docs");
  });
});
