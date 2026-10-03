import { describe, expect, it, vi } from "vitest";
import { createWorkbenchCommands } from "./workbench-commands";
import { createStore } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
vi.mock("./focus-service", () => ({ focusTabPanel: vi.fn() }));
vi.stubGlobal("requestAnimationFrame", vi.fn());

function fixture() {
  const [store, setStore] = createStore({ tabs: [{ id: "file_1", name: "Draft.md", type: "file", dirty: true, path: "/notes/Draft.md" }],
    activeTabId: "file_1" } as unknown as BusterStoreState);
  let text = "Unsaved writing";
  const focusTab = vi.fn((id: string) => { setStore("activeTabId", id); });
  const createNote = vi.fn(() => {
    const id = `file_${store.tabs.length + 1}`;
    setStore("tabs", [...store.tabs, { id, name: "Note.md", type: "file", path: "", dirty: false }]);
    focusTab(id); return id;
  });
  const service = createWorkbenchCommands({ tabs: () => store.tabs, activeTabId: () => store.activeTabId,
    workspaceRoot: () => "/notes",
    document: () => ({ text, revision: 7, dirty: true }), focusTab,
    createNote });
  return { service, store, createNote, focusTab, edit: (next: string) => { text = next; } };
}

describe("live workbench commands", () => {
  it("publishes the same complete catalog used by help and AI discovery", async () => {
    const { service } = fixture();
    expect(service.describe()).toHaveLength(9);
    expect(service.describe().some(c => c.name.startsWith("terminal "))).toBe(false);
    const result = await service.executeLine("help", "help");
    expect(result).toMatchObject({ ok: true, data: { commands: service.describe() } });
    expect(await service.executeLine('commands describe {"name":"document create"}', "describe")).toMatchObject({
      ok: true, data: { command: { name: "document create", effect: "write", inputSchema: { additionalProperties: false } } },
    });
  });

  it("keeps help working when commands declare approval and dry-run hooks", async () => {
    const { service } = fixture();
    service.register({ name: "note open", description: "Open.", version: 1, effect: "write", confirm: false,
      inputSchema: { type: "object", properties: {}, additionalProperties: false }, outputSchema: { type: "object" },
      examples: [], check: () => {}, run: () => ({}) });
    const result = await service.executeLine("help", "help-confirm");
    expect(result.ok).toBe(true);
    const listed = result.ok ? (result.data as { commands: Array<{ name: string; confirm: boolean }> }).commands : [];
    expect(listed.find(c => c.name === "note open")?.confirm).toBe(false);
    expect(listed.find(c => c.name === "document create")?.confirm).toBe(true);
    expect(listed.find(c => c.name === "document read")?.confirm).toBe(false);
  });

  it("reports live status and rejects the retired shell commands", async () => {
    const { service } = fixture();
    expect(await service.executeLine("app status", "status")).toMatchObject({ ok: true, data: { product: "BusterMark", activeTabId: "file_1", tabCount: 1 } });
    for (const line of ["terminal create", "terminal list", 'terminal focus {"tabId":"file_1"}']) {
      expect(await service.executeLine(line, line)).toMatchObject({ ok: false, error: { code: "UNKNOWN_COMMAND" } });
    }
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
    expect(await service.executeLine('tab focus {"tabId":"missing"}', "missing")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await service.executeLine("tab focus", "no-id")).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(focusTab).not.toHaveBeenCalled();
    expect(await service.executeLine('tab focus {"tabId":"file_1"}', "focus")).toMatchObject({ ok: true });
    expect(focusTab).toHaveBeenCalledWith("file_1");
  });
  it("creates one note on retry and has no pane limit", async () => {
    const { service, store, createNote } = fixture();
    const request = { requestId: "new", command: "document create" };
    await service.dispatch(request, "ai"); await service.dispatch(request, "ai");
    expect(createNote).toHaveBeenCalledOnce();
    for (let n = 0; n < 8; n++) expect(await service.executeLine("document create", `new-${n}`)).toMatchObject({ ok: true });
    expect(store.tabs).toHaveLength(10);
  });
  it("rejects all retired pane commands without changing tabs", async () => {
    const { service, store, createNote } = fixture();
    for (const command of ["panel split", "panel close", "panel zoom", "panel swap", "panel resize", "panel focus", "panel list", "layout inspect"]) {
      expect(await service.dispatch({ requestId: command, command }, "ai")).toMatchObject({ ok: false, error: { code: "UNKNOWN_COMMAND" } });
    }
    expect(store.tabs).toHaveLength(1); expect(createNote).not.toHaveBeenCalled();
  });
});
