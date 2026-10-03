import { describe, expect, it, vi } from "vitest";
import { createExternalChanges } from "./external-changes";
import { createEditorEngine } from "../editor/engine";
import type { Tab } from "./tab-types";
function fixture() {
  const tabs = new Map(["a", "b"].map(id => [id, { id, path: `/${id}.md`, name: id, type: "file" } as Tab]));
  const engines = new Map(["a", "b"].map(id => [id, createEditorEngine(`my ${id}`)]));
  const present = vi.fn(), loaded = vi.fn();
  const changes = createExternalChanges({ tab: id => tabs.get(id), engine: id => engines.get(id), present, loaded });
  return { tabs, engines, present, loaded, changes };
}
describe("external edit conflicts", () => {
  it("queues conflicts, protects every pending note, and loads the newest disk text with undo", () => {
    const { changes, engines, present } = fixture();
    changes.receive("a", "A", "disk a"); changes.receive("b", "B", "disk b");
    changes.receive("a", "A", "newest a");
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ tabId: "a", text: "newest a" }));
    expect(changes.has("a")).toBe(true); expect(changes.has("b")).toBe(true);
    changes.resolve("load-disk");
    expect(engines.get("a")!.getText()).toBe("newest a");
    engines.get("a")!.undo();
    expect(engines.get("a")!.getText()).toBe("my a");
    expect(engines.get("a")!.dirty()).toBe(true);
    expect(changes.has("a")).toBe(false); expect(changes.has("b")).toBe(true);
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ tabId: "b" }));
    changes.resolve("keep-mine");
    expect(engines.get("b")!.getText()).toBe("my b");
    expect(present).toHaveBeenLastCalledWith(undefined);
    engines.forEach(engine => engine.dispose());
  });
  it("does not apply an old disk snapshot after Save As or redirect a choice to another note", () => {
    const { changes, tabs, engines } = fixture();
    changes.receive("a", "A", "old disk"); changes.receive("b", "B", "disk b");
    tabs.get("a")!.path = "/renamed.md";
    changes.resolve("load-disk");
    expect(engines.get("a")!.getText()).toBe("my a");
    expect(engines.get("b")!.getText()).toBe("my b");
    expect(changes.has("a")).toBe(false);
    tabs.delete("b"); changes.sync();
    expect(changes.has("b")).toBe(false);
    engines.forEach(engine => engine.dispose());
  });
});
