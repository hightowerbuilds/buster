import { test, expect, describe } from "bun:test";
import { relativeTo } from "../src/index.ts";

describe("relativeTo", () => {
  test("file inside workspace", () => {
    expect(relativeTo("/home/user/project", "/home/user/project/src/main.ts")).toBe("src/main.ts");
  });

  test("file outside workspace", () => {
    expect(relativeTo("/home/user/project", "/home/user/other/file.ts")).toBe("../other/file.ts");
  });

  test("same path returns .", () => {
    expect(relativeTo("/home/user/project", "/home/user/project")).toBe(".");
  });

  test("Windows paths", () => {
    expect(relativeTo("C:\\Users\\me\\project", "C:\\Users\\me\\project\\src\\main.ts", "win32")).toBe("src/main.ts");
  });

  test("deeply nested relative", () => {
    expect(relativeTo("/a/b/c/d", "/a/b/x/y")).toBe("../../x/y");
  });
});
