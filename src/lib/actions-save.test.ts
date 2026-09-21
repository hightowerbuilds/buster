import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "solid-js/store";
import { createEditorEngine } from "../editor/engine";
import { createSaveActions } from "./actions-save";
import type { BusterStoreState } from "./store-types";
import type { EngineMap } from "./buster-context";
import { writeTextFile } from "@tauri-apps/plugin-fs";

vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn(async () => {}) }));
vi.mock("./ipc", () => ({ writeFile: vi.fn(), lspDidChange: vi.fn(async () => {}), lspDidSave: vi.fn(async () => {}), lspFormatDocument: vi.fn() }));
vi.mock("./notify", () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock("../ui/SidebarTree", () => ({ setRefreshDir: vi.fn() }));

function fixture() {
  const engine = createEditorEngine("first line  \nsecond line\n");
  engine.markDirty();
  const [store, setStore] = createStore({ workspaceRoot: null, tabs: [
    { id: "file_1", type: "file", name: "Draft.md", path: "/notes/Draft.md", dirty: true },
  ], settings: { format_on_save: false, language_settings: {} } } as BusterStoreState);
  const engines = { get: () => engine } as unknown as EngineMap;
  const actions = createSaveActions(store, setStore, engines, () => store.tabs[0], vi.fn(),
    vi.fn(async () => {}), vi.fn(), vi.fn(async () => {}));
  return { engine, store, actions };
}

beforeEach(() => vi.clearAllMocks());

describe("writing document saves", () => {
  it("preserves Markdown hard breaks and the final newline", async () => {
    const { engine, actions } = fixture();
    await actions.saveTab("file_1");
    expect(writeTextFile).toHaveBeenCalledWith("/notes/Draft.md", "first line  \nsecond line\n");
    expect(engine.getText()).toBe("first line  \nsecond line\n");
    expect(engine.dirty()).toBe(false);
  });

  it("keeps edits made while a disk write is pending dirty", async () => {
    let release!: () => void;
    vi.mocked(writeTextFile).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const { engine, store, actions } = fixture();
    const pending = actions.saveTab("file_1");
    await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledOnce());
    engine.insert("New writing: ");
    release();
    await pending;
    expect(engine.dirty()).toBe(true);
    expect(store.tabs[0].dirty).toBe(true);
    expect(engine.getText()).toContain("New writing: ");
  });
});
