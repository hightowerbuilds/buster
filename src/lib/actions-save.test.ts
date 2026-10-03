import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "solid-js/store";
import { createEditorEngine } from "../editor/engine";
import { createSaveActions } from "./actions-save";
import type { BusterStoreState } from "./store-types";
import type { EngineMap } from "./buster-context";
import { lspFormatDocument, watchFile, unwatchFile } from "./ipc";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn(async () => {}) }));
vi.mock("./ipc", () => ({ writeFile: vi.fn(), watchFile: vi.fn(async () => {}), unwatchFile: vi.fn(async () => {}), lspDidChange: vi.fn(async () => {}), lspDidSave: vi.fn(async () => {}), lspFormatDocument: vi.fn() }));
vi.mock("./notify", () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock("../ui/SidebarTree", () => ({ setRefreshDir: vi.fn() }));

function fixture(formatOnSave = false, canSave: (id: string) => boolean = () => true) {
  const engine = createEditorEngine("first line  \nsecond line\n");
  engine.markDirty();
  const [store, setStore] = createStore({ workspaceRoot: null, activeTabId: "file_1", tabs: [
    { id: "file_1", type: "file", name: "Draft.md", path: "/notes/Draft.md", dirty: true },
  ], settings: { format_on_save: formatOnSave, language_settings: {} } } as BusterStoreState);
  const engines = { get: () => engine } as unknown as EngineMap;
  const actions = createSaveActions(store, setStore, engines, () => store.tabs[0], vi.fn(),
    vi.fn(async () => {}), vi.fn(), vi.fn(async () => {}), new Map(), canSave);
  return { engine, store, actions };
}

beforeEach(() => vi.clearAllMocks());

describe("writing document saves", () => {
  it("blocks saves for unresolved external changes and preserves the dirty buffer", async () => {
    const { engine, actions } = fixture(false, () => false);
    await expect(actions.saveTab("file_1")).rejects.toThrow("external file change");
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(engine.dirty()).toBe(true);
  });
  it("rechecks conflict protection after asynchronous save preparation", async () => {
    let checks = 0;
    const { engine, actions } = fixture(false, () => ++checks === 1);
    await expect(actions.saveTab("file_1")).rejects.toThrow("external file change");
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(engine.dirty()).toBe(true);
  });
  it("ignores legacy LSP formatting for Markdown notes", async () => {
    const { engine, actions } = fixture(true);
    await actions.saveTab("file_1");
    expect(lspFormatDocument).not.toHaveBeenCalled();
    expect(writeTextFile).toHaveBeenCalledWith("/notes/Draft.md", "first line  \nsecond line\n");
    expect(engine.dirty()).toBe(false);
  });
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
  it("waits for a queued save and writes edits made during the previous save", async () => {
    let release!: () => void;
    vi.mocked(writeTextFile).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const { engine, actions } = fixture();
    const first = actions.saveTab("file_1");
    await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledOnce());
    engine.insert("latest ");
    let finished = false;
    const second = actions.saveTab("file_1").then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(writeTextFile).toHaveBeenCalledOnce();
    release();
    await Promise.all([first, second]);
    expect(writeTextFile).toHaveBeenLastCalledWith("/notes/Draft.md", engine.getText());
    expect(writeTextFile).toHaveBeenCalledTimes(2);
    expect(engine.dirty()).toBe(false);
  });

  it("allows a queued retry after a failed save without hiding the first failure", async () => {
    vi.mocked(writeTextFile).mockRejectedValueOnce(new Error("disk full"));
    const { engine, actions } = fixture();
    const first = actions.saveTab("file_1");
    const second = actions.saveTab("file_1");
    await expect(first).rejects.toThrow("disk full");
    await second;
    expect(writeTextFile).toHaveBeenCalledTimes(2);
    expect(engine.dirty()).toBe(false);
  });

  it("moves file watcher ownership after Save As", async () => {
    vi.mocked(save).mockResolvedValueOnce("/notes/Renamed.md");
    const { store, actions } = fixture();
    await actions.handleSaveAs();
    expect(store.tabs[0].path).toBe("/notes/Renamed.md");
    expect(unwatchFile).toHaveBeenCalledWith("/notes/Draft.md");
    expect(watchFile).toHaveBeenCalledWith("/notes/Renamed.md");
  });

});
