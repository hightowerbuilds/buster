import { describe, expect, it } from "vitest";
import { isNotesPath, movedFilePath } from "./notes-storage";

describe("managed note identity", () => {
  it("includes nested notes but excludes similarly named folders and traversal", () => {
    expect(isNotesPath("/app/Notes/Drafts/one.md", "/app/Notes/")).toBe(true);
    expect(isNotesPath("/app/Notes-old/one.md", "/app/Notes")).toBe(false);
    expect(isNotesPath("/app/Notes/../private.md", "/app/Notes")).toBe(false);
    expect(isNotesPath("/app/Notes/one.md", null)).toBe(false);
    expect(isNotesPath("C:\\App\\Notes\\one.md", "C:\\App\\Notes")).toBe(true);
  });
  it("retargets a moved folder's open notes without touching similarly named siblings", () => {
    expect(movedFilePath("/Notes/Drafts/chapter.md", "/Notes/Drafts", "/Notes/Archive")).toBe("/Notes/Archive/chapter.md");
    expect(movedFilePath("/Notes/Drafts-old/chapter.md", "/Notes/Drafts", "/Notes/Archive")).toBeUndefined();
    expect(movedFilePath("/Notes/Drafts/chapter.md", "/Notes/Drafts", null)).toBeNull();
    expect(movedFilePath("/Notes/one.md", "/Notes/one.md", "/Notes/two.md")).toBe("/Notes/two.md");
  });
});
