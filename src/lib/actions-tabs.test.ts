import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "solid-js/store";
import { createTabActions } from "./actions-tabs";
import { createEditorEngine } from "../editor/engine";
import { focusNewNote, focusTabPanel } from "./focus-service";
import { createFile, watchFile, unwatchFile } from "./ipc";
import type { BusterStoreState } from "./store-types";
import type { EngineMap } from "./buster-context";
import type { Tab } from "./tab-types";

vi.mock("./focus-service", () => ({ focusTabPanel: vi.fn(), focusNewNote: vi.fn() }));
vi.mock("./notify", () => ({ showError: vi.fn(), showInfo: vi.fn() }));
vi.mock("../ui/SidebarTree", () => ({ setRefreshDir: vi.fn() }));
vi.mock("./ipc", () => ({
  createFile: vi.fn(async () => {}), watchFile: vi.fn(async () => {}),
  unwatchFile: vi.fn(async () => {}),
}));

const note = (id: string): Tab => ({ id, type: "file", name: `${id}.md`, path: `/notes/${id}.md`, dirty: false });
function fixture(tabs: Tab[] = [note("a"), note("b"), note("c")], active = tabs[0]?.id ?? null) {
  // Deliberately no pane workspace: these actions must work independently.
  const [store, setStore] = createStore({ tabs, activeTabId: active, splitView: null,
    fileTexts: Object.fromEntries(tabs.map(tab => [tab.id, ""])),
    scrollPositions: {}, diffHunksMap: {}, lspLanguages: [],
    fileTabCounter: 0, notesRoot: null, workspaceRoot: "/notes",
  } as unknown as BusterStoreState);
  const map: EngineMap["map"] = new Map();
  const engines: EngineMap = { map, revision: () => 0, get: id => map.get(id), set: (id, engine) => { map.set(id, engine); }, delete: id => { map.delete(id); } };
  const write = vi.fn(async () => {});
  const pendingNotes = new Map<string, Promise<void>>();
  const queueSave = vi.fn(async (_id: string, save: () => Promise<void>) => save());
  return { store, setStore, engines, write, pendingNotes, queueSave,
    actions: createTabActions(store, setStore, engines, { value: "" }, write, pendingNotes, queueSave) };
}
beforeEach(() => vi.clearAllMocks());

describe("tab lifecycle without panes", () => {
  it("creates distinct notes without a pane limit and reuses Settings", () => {
    const f = fixture([]);
    for (let i = 0; i < 9; i++) f.actions.createNewFile();
    expect(f.store.tabs).toHaveLength(9);
    expect(new Set(f.store.tabs.map(tab => tab.id)).size).toBe(9);
    const last = f.store.tabs[8].id;
    expect(f.store.activeTabId).toBe(last);
    f.actions.createSettingsTab(); f.actions.switchToTab(last); f.actions.createSettingsTab();
    expect(f.store.tabs.filter(tab => tab.type === "settings")).toHaveLength(1);
    expect(f.store.activeTabId).toBe("settings_tab");
  });

  it("preserves editor resources when switching and reordering tabs", () => {
    const f = fixture();
    const engine = createEditorEngine("draft"); engine.insert("edited ");
    f.engines.set("a", engine);
    f.setStore("scrollPositions", "a", 123);
    f.actions.createSettingsTab();
    f.actions.switchToTab("a");
    f.actions.reorderTabs(0, 2);
    expect(f.store.tabs.map(tab => tab.id)).toEqual(["b", "c", "a", "settings_tab"]);
    expect(f.store.activeTabId).toBe("a");
    expect(f.engines.get("a")).toBe(engine);
    expect(engine.getText()).toBe("edited draft");
    expect(f.store.scrollPositions.a).toBe(123);
    f.actions.reorderTabs(-1, 0); f.actions.reorderTabs(0, 99);
    f.actions.switchToTab("missing");
    expect(f.store.activeTabId).toBe("a");
    expect(f.store.tabs).toHaveLength(4);
  });

  it("closes to the right neighbor, then left, then focuses New Note", () => {
    const f = fixture(undefined, "b");
    f.actions.handleTabClose("b");
    expect(f.store.activeTabId).toBe("c");
    expect(focusTabPanel).toHaveBeenLastCalledWith("c");
    f.actions.handleTabClose("c");
    expect(f.store.activeTabId).toBe("a");
    f.actions.handleTabClose("a");
    expect(f.store.tabs).toEqual([]);
    expect(f.store.activeTabId).toBeNull();
    expect(focusNewNote).toHaveBeenCalledOnce();
  });

  it("does not change focus when an inactive tab closes and clears its resources", () => {
    const f = fixture();
    f.setStore("scrollPositions", "b", 20);
    f.actions.handleTabClose("b");
    expect(f.store.activeTabId).toBe("a");
    expect(focusTabPanel).not.toHaveBeenCalled();
    expect(f.store.fileTexts.b).toBeUndefined();
    expect(f.store.scrollPositions.b).toBeUndefined();
    expect(unwatchFile).toHaveBeenCalledWith("/notes/b.md");
  });

  it("keeps a shared file watcher until its final tab closes", () => {
    const f = fixture([note("a"), { ...note("b"), path: "/notes/a.md" }]);
    f.actions.handleTabClose("a");
    expect(unwatchFile).not.toHaveBeenCalled();
    f.actions.handleTabClose("b");
    expect(unwatchFile).toHaveBeenCalledExactlyOnceWith("/notes/a.md");
  });

  it("retains a dirty note on cancelled close or failed save, even before the dirty flag updates", async () => {
    const f = fixture();
    const engine = createEditorEngine(""); engine.insert("unsaved writing"); f.engines.set("a", engine);
    f.actions.handleTabClose("a");
    expect(f.store.dirtyCloseTabId).toBe("a");
    await f.actions.handleDirtyCloseResult("cancel");
    expect(f.store.tabs).toHaveLength(3);
    f.actions.handleTabClose("a"); f.write.mockRejectedValueOnce(new Error("disk full"));
    await f.actions.handleDirtyCloseResult("save");
    expect(f.store.tabs).toHaveLength(3);
    expect(engine.getText()).toBe("unsaved writing");
    expect(engine.dirty()).toBe(true);
  });

  it("waits for note creation inside the save queue before saving and closing", async () => {
    const f = fixture([]);
    f.setStore("notesRoot", "/notes");
    let created!: () => void;
    vi.mocked(createFile).mockImplementationOnce(() => new Promise(resolve => { created = resolve; }));
    const id = f.actions.createNewFile();
    const engine = createEditorEngine(""); engine.insert("new draft"); f.engines.set(id, engine);
    f.actions.handleTabClose(id);
    const closing = f.actions.handleDirtyCloseResult("save");
    expect(f.queueSave).toHaveBeenCalledWith(id, expect.any(Function));
    expect(f.write).not.toHaveBeenCalled();
    expect(f.store.tabs).toHaveLength(1);
    created(); await closing;
    expect(f.write).toHaveBeenCalledWith(expect.stringMatching(/^\/notes\/[A-Za-z]+\.md$/), "new draft", true);
    expect(watchFile).toHaveBeenCalledOnce();
    expect(unwatchFile).toHaveBeenCalledWith(vi.mocked(watchFile).mock.calls[0][0]);
    expect(f.store.tabs).toEqual([]);
  });

  it("does not install a watcher or restore a tab after pending creation closes", async () => {
    const f = fixture([]); f.setStore("notesRoot", "/notes");
    let created!: () => void;
    vi.mocked(createFile).mockImplementationOnce(() => new Promise(resolve => { created = resolve; }));
    const id = f.actions.createNewFile();
    const pending = f.pendingNotes.get(id)!;
    f.actions.handleTabClose(id); created(); await pending;
    expect(watchFile).not.toHaveBeenCalled();
    expect(f.store.tabs).toEqual([]);
    expect(f.store.fileTexts[id]).toBeUndefined();
  });

  it("keeps edits made during a dirty-close write open", async () => {
    const f = fixture(); const engine = createEditorEngine("");
    engine.insert("first"); f.engines.set("a", engine);
    let written!: () => void;
    f.write.mockImplementationOnce(() => new Promise(resolve => { written = resolve; }));
    f.actions.handleTabClose("a"); const closing = f.actions.handleDirtyCloseResult("save");
    await Promise.resolve(); engine.insert(" second"); written(); await closing;
    expect(engine.getText()).toBe("first second");
    expect(engine.dirty()).toBe(true);
    expect(f.store.tabs.some(tab => tab.id === "a")).toBe(true);
  });
});

describe("tabs alongside one another", () => {
  it("pairs notes and Settings and replaces only the focused pane when selecting another tab", () => {
    const f = fixture();
    f.actions.createSettingsTab(); f.actions.switchToTab("a");
    f.actions.openTabAlongside("settings_tab");
    expect(f.store.splitView).toEqual({ leftTabId: "a", rightTabId: "settings_tab", ratio: 0.5 });
    expect(f.store.activeTabId).toBe("settings_tab");
    f.actions.switchToTab("b");
    expect(f.store.splitView?.rightTabId).toBe("b");
    expect(f.store.splitView?.leftTabId).toBe("a");
    f.actions.switchToTab("a", { focus: false });
    f.actions.switchToTab("c");
    expect(f.store.splitView).toMatchObject({ leftTabId: "c", rightTabId: "b" });
  });

  it("opens a third tab alongside the current pane and avoids duplicate panes", () => {
    const f = fixture();
    f.actions.openTabAlongside("b");
    f.actions.openTabAlongside("c");
    expect(f.store.splitView).toMatchObject({ leftTabId: "c", rightTabId: "b" });
    f.actions.openTabAlongside("b");
    expect(f.store.activeTabId).toBe("b");
    expect(f.store.splitView).toMatchObject({ leftTabId: "c", rightTabId: "b" });
    f.actions.openTabAlongside("missing");
    expect(f.store.splitView).toMatchObject({ leftTabId: "c", rightTabId: "b" });
    const single = fixture([note("a")]); single.actions.openTabAlongside();
    expect(single.store.splitView).toBeNull();
  });

  it("preserves editors and their undo history through split, resize, reorder, and collapse", () => {
    const f = fixture(); const engine = createEditorEngine("first draft");
    engine.insert("edited "); f.engines.set("a", engine); f.setStore("scrollPositions", "a", 200);
    f.actions.openTabAlongside(); f.actions.setSplitRatio(0.62); f.actions.reorderTabs(0, 2);
    expect(f.store.splitView).toEqual({ leftTabId: "a", rightTabId: "b", ratio: 0.62 });
    f.actions.setSplitRatio(2); expect(f.store.splitView?.ratio).toBe(0.75);
    f.actions.setSplitRatio(NaN); expect(f.store.splitView?.ratio).toBe(0.5);
    f.actions.closeSplitView("a");
    expect(f.store.splitView).toBeNull(); expect(f.store.activeTabId).toBe("a");
    expect(f.engines.get("a")).toBe(engine); expect(f.store.scrollPositions.a).toBe(200);
    engine.undo(); expect(engine.getText()).toBe("first draft");
  });

  it.each(["a", "b"])("closing visible tab %s collapses to the survivor without selecting a hidden tab", id => {
    const f = fixture(); f.actions.openTabAlongside("b");
    f.actions.handleTabClose(id);
    expect(f.store.splitView).toBeNull();
    expect(f.store.activeTabId).toBe(id === "a" ? "b" : "a");
    expect(f.store.tabs.map(tab => tab.id)).toContain("c");
  });

  it("keeps a split intact for hidden closes and cancelled dirty closes", async () => {
    const f = fixture(); f.actions.openTabAlongside("b");
    f.actions.handleTabClose("c");
    const engine = createEditorEngine("draft"); engine.insert("new "); f.engines.set("a", engine);
    f.actions.handleTabClose("a"); await f.actions.handleDirtyCloseResult("cancel");
    expect(f.store.splitView).toEqual({ leftTabId: "a", rightTabId: "b", ratio: 0.5 });
    expect(f.store.tabs.map(tab => tab.id)).toEqual(["a", "b"]);
  });

  it("updates active-tab commands without redirecting focus from the clicked control", () => {
    const f = fixture(); f.actions.openTabAlongside("b"); vi.mocked(focusTabPanel).mockClear();
    f.actions.switchToTab("a", { focus: false });
    expect(f.store.activeTabId).toBe("a"); expect(focusTabPanel).not.toHaveBeenCalled();
  });
});
