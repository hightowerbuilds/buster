import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { lookupSelection } from "./selection-lookup";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("local selection lookup", () => {
  beforeEach(() => { vi.mocked(invoke).mockReset(); });

  it("returns a native definition and preserves its source", async () => {
    const result = { query: "déjà vu", definition: "A feeling of familiarity.", source: "Apple Dictionary" };
    vi.mocked(invoke).mockResolvedValue(result);
    await expect(lookupSelection("  déjà vu  ")).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith("lookup_selection_text", { text: "déjà vu" });
  });

  it("preserves a missing definition without substituting network results", async () => {
    const result = { query: "unknownword", definition: null, source: "Apple Dictionary" };
    vi.mocked(invoke).mockResolvedValue(result);
    await expect(lookupSelection("unknownword")).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("bounds Unicode queries and rejects multiline or empty selections before IPC", async () => {
    for (const text of ["  ", "one\ntwo", "one\ttwo", "word\0", "📝".repeat(257)]) {
      await expect(lookupSelection(text)).rejects.toThrow();
    }
    expect(invoke).not.toHaveBeenCalled();
    vi.mocked(invoke).mockResolvedValue({ query: "📝".repeat(256), definition: null, source: "Apple Dictionary" });
    await lookupSelection("📝".repeat(256));
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("surfaces native unavailability errors", async () => {
    vi.mocked(invoke).mockRejectedValue("Local dictionary lookup is currently available on macOS only.");
    await expect(lookupSelection("word")).rejects.toContain("macOS only");
  });
});
