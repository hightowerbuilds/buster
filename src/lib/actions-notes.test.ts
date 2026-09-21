import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "solid-js/store";
import { createTabActions } from "./actions-tabs";
import { createSaveActions } from "./actions-save";
import { createEditorEngine } from "../editor/engine";
import { newPaneWorkspace } from "./writing-panes";
import type { BusterStoreState } from "./store-types";
import type { EngineMap } from "./buster-context";
import { createFile, writeFile } from "./ipc";

vi.mock("./focus-service", () => ({ focusTabPanel: vi.fn() }));
vi.mock("./notify", () => ({ showError: vi.fn(), showInfo: vi.fn(), showSuccess: vi.fn() }));
vi.mock("../ui/SidebarTree", () => ({ setRefreshDir: vi.fn() }));
vi.mock("./ipc", () => ({ createFile: vi.fn(), watchFile: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}), lspDidChange: vi.fn(async () => {}), lspDidSave: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn() }));

function fixture() {
  const [store, setStore] = createStore({ tabs: [], fileTexts: {}, fileTabCounter: 0,
    paneWorkspace: newPaneWorkspace(), activeTabId: null, notesRoot: "/app/Notes",
    workspaceRoot: "/external", settings: { format_on_save: false, language_settings: {} },
  } as unknown as BusterStoreState);
  const map = new Map();
  const engines = { get: (id: string) => map.get(id), map } as EngineMap;
  const pending = new Map<string, Promise<void>>();
  const tabs = createTabActions(store, setStore, engines, { value: "" }, vi.fn(), pending);
  const save = createSaveActions(store, setStore, engines, () => store.tabs.find(t => t.id === store.activeTabId),
    vi.fn(), vi.fn(async () => {}), vi.fn(), vi.fn(), pending);
  return { store, setStore, map, pending, tabs, save };
}
beforeEach(() => vi.clearAllMocks());

describe("new notes on disk", () => {
  it("waits for file creation before saving live writing, even in another workspace", async () => {
    let finish!: () => void;
    vi.mocked(createFile).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const f = fixture();
    const id = f.tabs.createNewFile();
    const engine = createEditorEngine(""); engine.insert("Writing typed while the file is being created");
    f.map.set(id, engine);
    const saving = f.save.saveTab(id, { silent: true, requirePath: true });
    expect(writeFile).not.toHaveBeenCalled();
    finish(); await saving;
    expect(f.store.tabs[0].path).toMatch(/^\/app\/Notes\/Note-1-.+\.md$/);
    expect(writeFile).toHaveBeenCalledWith(f.store.tabs[0].path, engine.getText(), true);
    expect(engine.dirty()).toBe(false);
  });
  it("retains a draft and reports failed creation without assigning a nonexistent path", async () => {
    vi.mocked(createFile).mockRejectedValue(new Error("disk full"));
    const f = fixture(); const id = f.tabs.createNewFile();
    await f.pending.get(id)?.catch(() => {});
    expect(f.store.tabs[0].path).toBe("");
    expect(f.store.notesStorageWarning).toContain("disk full");
    expect(f.store.notesStorageWarning).toContain("Save As");
    expect(writeFile).not.toHaveBeenCalled();
  });
  it("does not restore an old file path when a save races with a rename", async () => {
    vi.mocked(createFile).mockResolvedValue();
    const f = fixture(); const id = f.tabs.createNewFile(); await f.pending.get(id);
    const engine = createEditorEngine(""); engine.insert("Keep these edits"); f.map.set(id, engine);
    let finish!: () => void;
    vi.mocked(writeFile).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const saving = f.save.saveTab(id, { silent: true });
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalled());
    f.setStore("tabs", 0, "path", "/app/Notes/Renamed.md");
    finish(); await saving;
    expect(f.store.tabs[0].path).toBe("/app/Notes/Renamed.md");
    expect(engine.dirty()).toBe(true);
  });
});
