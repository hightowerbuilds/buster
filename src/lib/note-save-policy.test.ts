import { describe, expect, it } from "vitest";
import { autoSaveDelay } from "./note-save-policy";
import type { AppSettings } from "./ipc";

const settings = { auto_save: false, auto_save_delay_ms: 10000,
  language_settings: { markdown: { auto_save: false, auto_save_delay_ms: 9000 } },
} as unknown as AppSettings;

describe("note autosave policy", () => {
  it("autosaves Markdown anywhere, independent of old global and language settings", () => {
    for (const path of ["/Notes/one.md", "/external/two.markdown", "/external/THREE.MD"]) {
      expect(autoSaveDelay(settings, path, "/Notes")).toBe(500);
    }
  });
  it("does not attempt to autosave drafts without a file path", () => {
    expect(autoSaveDelay(settings, "", "/Notes")).toBeNull();
  });
  it("preserves existing autosave choices for other file types", () => {
    expect(autoSaveDelay(settings, "/external/app.ts", "/Notes")).toBeNull();
    expect(autoSaveDelay({ ...settings, auto_save: true, auto_save_delay_ms: 2000 }, "/external/app.ts", "/Notes")).toBe(2000);
  });
});
