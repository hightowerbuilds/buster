import { describe, expect, it, vi } from "vitest";
import { createWorkbenchCommands } from "./workbench-commands";
import { createStore } from "solid-js/store";
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
  const service = createWorkbenchCommands({ tabs: () => store.tabs, activeTabId: () => store.activeTabId,
    workspaceRoot: () => "/notes", terminalId: () => undefined,
    document: () => ({ text, revision: 7, dirty: true }), createTerminal, focusTab,
    createNote });
  return { service, store, createTerminal, createNote, focusTab, edit: (next: string) => { text = next; } };
}

describe("live workbench commands", () => {
  it("publishes the same complete catalog used by help and AI discovery", async () => {
    const { service } = fixture();
    expect(service.describe()).toHaveLength(13);
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
  it("creates one note per AI request id and lists it as a tab", async () => {
    const { service, store, createNote } = fixture();
    const request = { requestId: "make", command: "document create", args: {} };
    expect(await service.dispatch(request, "ai")).toMatchObject({ ok: true });
    // A repeated request id must share the first result rather than create twice.
    await service.dispatch(request, "ai");
    expect(createNote).toHaveBeenCalledOnce();

    const listed = await service.executeLine("panel list", "list");
    expect(listed).toMatchObject({ ok: true });
    if (listed.ok) {
      const panels = (listed.data as { panels: { tabId: string; active: boolean }[] }).panels;
      expect(panels.map(panel => panel.tabId)).toEqual(store.tabs.map(tab => tab.id));
      expect(panels.filter(panel => panel.active)).toHaveLength(1);
    }
  });

  it("focuses an open tab and refuses an unknown one", async () => {
    const { service, store, focusTab } = fixture();
    const tabId = store.tabs[0].id;
    expect(await service.dispatch({ requestId: "focus", command: "panel focus", args: { tabId } }, "ai"))
      .toMatchObject({ ok: true, data: { tabId } });
    expect(focusTab).toHaveBeenCalledWith(tabId);

    expect(await service.dispatch({ requestId: "missing", command: "panel focus", args: { tabId: "nope" } }, "ai"))
      .toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("no longer exposes the removed pane commands", async () => {
    const { service } = fixture();
    for (const command of ["panel split", "panel close", "panel zoom", "panel swap", "panel resize", "layout inspect"]) {
      expect(await service.dispatch({ requestId: `gone-${command}`, command, args: {} }, "ai"))
        .toMatchObject({ ok: false, error: { code: "UNKNOWN_COMMAND" } });
    }
  });

});
