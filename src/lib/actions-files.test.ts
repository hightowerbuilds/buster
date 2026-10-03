import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "solid-js/store";
import { createFileActions } from "./actions-files";
import type { BusterStoreState } from "./store-types";
import { readFile, watchFile } from "./ipc";
import { showError } from "./notify";
vi.mock("./ipc", () => ({ readFile: vi.fn(), watchFile: vi.fn(async () => {}) }));
vi.mock("./notify", () => ({ showError: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
function fixture() {
  const [store, setStore] = createStore({ tabs: [], fileTexts: {}, fileTabCounter: 0, workspaceRoot: null } as unknown as BusterStoreState);
  const focus = vi.fn();
  const actions = createFileActions(store, setStore, focus, vi.fn(), vi.fn(async () => {}), vi.fn());
  return { store, actions, focus };
}
describe("opening writing files", () => {
  it("shares concurrent reads and creates one tab without changing the text", async () => {
    const { store, actions, focus } = fixture();
    let release!: (value: any) => void;
    vi.mocked(readFile).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const background = actions.openFile("/note.md", { activate: false });
    const foreground = actions.openFile("/note.md");
    const content = "# Déjà 📝\r\nHard break  \r\n\r\n";
    release({ path: "/note.md", file_name: "note.md", content });
    const ids = await Promise.all([background, foreground]);
    expect(ids[0]).toBe(ids[1]);
    expect(readFile).toHaveBeenCalledOnce();
    expect(watchFile).toHaveBeenCalledOnce();
    expect(store.tabs).toHaveLength(1);
    expect(store.fileTexts[ids[0]!]).toBe(content);
    expect(focus).toHaveBeenCalledExactlyOnceWith(ids[0]);
    expect(store.fileLoading).toBe(false);
  });
  it("preserves read failures, creates no editable tab, and permits retry", async () => {
    const { store, actions } = fixture();
    vi.mocked(readFile).mockRejectedValueOnce(new Error("Invalid UTF-8"));
    expect(await actions.openFile("/note.md")).toBeUndefined();
    expect(store.tabs).toHaveLength(0);
    expect(showError).toHaveBeenCalledWith("Could not open note.md: Invalid UTF-8");
    vi.mocked(readFile).mockResolvedValueOnce({ path: "/note.md", file_name: "note.md", content: "restored\n" });
    expect(await actions.openFile("/note.md")).toBeDefined();
    expect(store.tabs).toHaveLength(1);
  });
  it("keeps the loading indicator until all independent reads finish", async () => {
    const { store, actions } = fixture();
    let release!: (value: any) => void;
    vi.mocked(readFile).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockRejectedValueOnce(new Error("permission denied"));
    const first = actions.openFile("/first.md");
    await actions.openFile("/second.md");
    expect(store.fileLoading).toBe(true);
    release({ path: "/first.md", file_name: "first.md", content: "" });
    await first;
    expect(store.fileLoading).toBe(false);
  });
});
