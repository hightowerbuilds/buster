import { test, expect, describe } from "bun:test";
import { breadcrumbs } from "../src/index.ts";

describe("breadcrumbs", () => {
  test("workspace-relative breadcrumbs", () => {
    const result = breadcrumbs("/home/user/project/src/lib/utils.ts", "/home/user/project");
    expect(result).toEqual([
      { label: "src", path: "src" },
      { label: "lib", path: "src/lib" },
      { label: "utils.ts", path: "src/lib/utils.ts" },
    ]);
  });

  test("absolute breadcrumbs without workspace", () => {
    const result = breadcrumbs("/home/user/file.ts");
    expect(result).toEqual([
      { label: "home", path: "home" },
      { label: "user", path: "home/user" },
      { label: "file.ts", path: "home/user/file.ts" },
    ]);
  });

  test("single file at workspace root", () => {
    const result = breadcrumbs("/project/file.ts", "/project");
    expect(result).toEqual([{ label: "file.ts", path: "file.ts" }]);
  });
});
