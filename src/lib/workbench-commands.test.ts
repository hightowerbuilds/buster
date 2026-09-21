import { describe, expect, it, vi } from "vitest";
import { createWorkbenchCommands } from "./workbench-commands";
import { createStore } from "solid-js/store";
import { createPaneActions } from "./actions-panes";
import { newPaneWorkspace, showTabInPane } from "./writing-panes";
import type { BusterStoreState } from "./store-types";
vi.mock("./focus-service", () => ({ focusTabPanel: vi.fn() }));
vi.stubGlobal("requestAnimationFrame", vi.fn());

function fixture() {
  const [store, setStore] = createStore({ tabs: [{ id: "file_1", name: "Draft.md", type: "file", dirty: true, path: "/notes/Draft.md" }],
    activeTabId: "file_1", paneWorkspace: newPaneWorkspace("file_1") } as BusterStoreState);
  let text = "Unsaved writing";
  const focusTab = vi.fn((id: string) => { setStore("activeTabId", id); setStore("paneWorkspace", showTabInPane(store.paneWorkspace, id)); });
  const createTerminal = vi.fn(() => {
    const id = `term_${store.tabs.length}`;
    setStore("tabs", [...store.tabs, { id, name: "Terminal", type: "terminal", path: "/notes", dirty: false }]);
    focusTab(id);
    return id;
  });
  const createNote = vi.fn(() => {
    const id = `file_${store.tabs.length + 1}`;
    setStore("tabs", [...store.tabs, { id, name: "Note.md", type: "file", path: "", dirty: false }]);
    focusTab(id); return id;
  });
  const panes = createPaneActions(store, setStore, createNote, createTerminal);
  const service = createWorkbenchCommands({ tabs: () => store.tabs, activeTabId: () => store.activeTabId,
    workspaceRoot: () => "/notes", terminalId: () => undefined,
    document: () => ({ text, revision: 7, dirty: true }), createTerminal, focusTab,
    paneWorkspace: () => store.paneWorkspace, panes, createNote });
  return { service, store, createTerminal, createNote, focusTab, edit: (next: string) => { text = next; } };
}

describe("live workbench commands", () => {
  it("publishes the same complete catalog used by help and AI discovery", async () => {
    const { service } = fixture();
    expect(service.describe()).toHaveLength(19);
    const result = await service.executeLine("help", "help");
    expect(result).toMatchObject({ ok: true, data: { commands: service.describe() } });
    expect(await service.executeLine('commands describe {"name":"terminal create"}', "describe")).toMatchObject({
      ok: true, data: { command: { name: "terminal create", effect: "write", inputSchema: { additionalProperties: false } } },
    });
  });

  it("creates one terminal on retry and reports the updated live status", async () => {
    const { service, createTerminal } = fixture();
    const request = { requestId: "create", command: "terminal create" };
    expect(await service.dispatch(request, "ai")).toMatchObject({ ok: true, data: { tabId: "term_1", state: "created" } });
    await service.dispatch(request, "ai");
    expect(createTerminal).toHaveBeenCalledOnce();
    expect(await service.executeLine("app status", "status")).toMatchObject({ ok: true, data: { product: "BusterMark", activeTabId: "term_1", terminalCount: 1 } });
    expect(await service.executeLine("terminal list", "list")).toMatchObject({ ok: true, data: { terminals: [{ tabId: "term_1", state: "pending" }] } });
  });

  it("reads live unsaved text on each new request", async () => {
    const { service, edit } = fixture();
    const line = 'document read {"tabId":"file_1"}';
    expect(await service.executeLine(line, "read1")).toMatchObject({ ok: true, data: { text: "Unsaved writing", revision: 7, dirty: true } });
    edit("Revised writing");
    expect(await service.executeLine(line, "read2")).toMatchObject({ ok: true, data: { text: "Revised writing" } });
  });

  it("validates targets before focus and rejects missing or wrong-type tabs", async () => {
    const { service, focusTab } = fixture();
    expect(await service.executeLine('terminal focus {"tabId":"file_1"}', "wrong-type")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await service.executeLine('panel focus {"tabId":"missing"}', "missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await service.executeLine("panel focus", "no-id")).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(focusTab).not.toHaveBeenCalled();
    expect(await service.executeLine('panel focus {"tabId":"file_1"}', "focus")).toMatchObject({ ok: true });
    expect(focusTab).toHaveBeenCalledWith("file_1");
  });
  it("creates one note and pane on AI retry, then closes only the view", async () => {
    const { service, store, createNote } = fixture();
    const request = { requestId: "split", command: "panel split", args: { direction: "right", content: "note" } };
    expect(await service.dispatch(request, "ai")).toMatchObject({ ok: true });
    await service.dispatch(request, "ai");
    expect(createNote).toHaveBeenCalledOnce();
    expect(store.paneWorkspace.panes).toHaveLength(2);
    const paneId = store.paneWorkspace.activePaneId;
    const tabId = store.activeTabId;
    expect(await service.dispatch({ requestId: "zoom", command: "panel zoom", args: { paneId } }, "user")).toMatchObject({ ok: true, data: { maximized: true } });
    expect(await service.dispatch({ requestId: "close", command: "panel close", args: { paneId } }, "ai")).toMatchObject({ ok: true });
    expect(store.paneWorkspace.panes).toHaveLength(1);
    expect(store.tabs.some(t => t.id === tabId)).toBe(true);
    expect(await service.executeLine("layout inspect", "layout")).toMatchObject({ ok: true });
  });

  it("validates pane targets and size limits before creating content", async () => {
    const { service, store, createNote } = fixture();
    expect(await service.dispatch({ requestId: "missing", command: "panel split", args: { paneId: "missing", direction: "right" } }, "ai")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(createNote).not.toHaveBeenCalled();
    for (let n = 0; n < 5; n++) await service.executeLine('panel split {"direction":"right"}', `split-${n}`);
    expect(store.paneWorkspace.panes).toHaveLength(6);
    expect(await service.executeLine('panel split {"direction":"right"}', "overflow")).toMatchObject({ ok: false, error: { code: "LIMIT_REACHED" } });
    expect(createNote).toHaveBeenCalledTimes(5);
  });

});
