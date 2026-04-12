import { test, expect, describe } from "bun:test";
import { pathToUri, uriToPath } from "../src/index.ts";

describe("pathToUri", () => {
  test("converts Unix path", () => {
    expect(pathToUri("/home/user/file.ts")).toBe("file:///home/user/file.ts");
  });

  test("encodes spaces", () => {
    expect(pathToUri("/home/user/my project/file.ts")).toBe(
      "file:///home/user/my%20project/file.ts",
    );
  });

  test("encodes hash and percent", () => {
    expect(pathToUri("/home/user/C# project/100%/file.ts")).toBe(
      "file:///home/user/C%23%20project/100%25/file.ts",
    );
  });

  test("converts Windows path", () => {
    expect(pathToUri("C:\\Users\\me\\file.ts")).toBe("file:///C:/Users/me/file.ts");
  });

  test("converts UNC path", () => {
    expect(pathToUri("\\\\server\\share\\file.ts")).toBe("file://server/share/file.ts");
  });

  test("throws on relative path", () => {
    expect(() => pathToUri("src/file.ts")).toThrow("relative");
  });
});

describe("uriToPath", () => {
  test("converts Unix URI", () => {
    expect(uriToPath("file:///home/user/file.ts")).toBe("/home/user/file.ts");
  });

  test("decodes spaces", () => {
    expect(uriToPath("file:///home/user/my%20project/file.ts")).toBe(
      "/home/user/my project/file.ts",
    );
  });

  test("converts Windows URI", () => {
    expect(uriToPath("file:///C:/Users/me/file.ts")).toBe("C:/Users/me/file.ts");
  });

  test("converts UNC URI", () => {
    expect(uriToPath("file://server/share/file.ts")).toBe("//server/share/file.ts");
  });

  test("throws on non-file URI", () => {
    expect(() => uriToPath("https://example.com")).toThrow("Not a file URI");
  });

  test("roundtrips Unix path", () => {
    const original = "/home/user/my project/file#1.ts";
    expect(uriToPath(pathToUri(original))).toBe(original);
  });

  test("roundtrips Windows path", () => {
    const original = "C:\\Users\\me\\my docs\\file.ts";
    expect(uriToPath(pathToUri(original))).toBe("C:/Users/me/my docs/file.ts");
  });
});
