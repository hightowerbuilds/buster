// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssistantWorkspace } from "./assistant-workspace";
import { readChatArchive, type ChatArchive, type ChatHistoryStorage } from "./chat-history";
import { FeatureCommands, emptyArgs, objectResult } from "./feature-commands";
import type { AssistantTransport, SessionEvent, ToolCall } from "./assistant-transport";

function transport() {
  let event = (_e: SessionEvent) => {}, call = (_c: ToolCall) => {};
  let localHistory: unknown = [];
  const api: AssistantTransport = {
    status: vi.fn(async () => ({ installed: true, loggedIn: true, version: "1", authMethod: "claude.ai", subscription: "max", detail: null })),
    send: vi.fn(async () => {}), reset: vi.fn(async () => { localHistory = []; }), interrupt: vi.fn(async () => {}),
    toolResult: vi.fn(async () => {}), subscribe: vi.fn(async (e, c) => { event = e; call = c; return () => { event = () => {}; call = () => {}; }; }),
    snapshot: () => localHistory, restore: value => { localHistory = value; },
  };
  return { api, emit: (e: SessionEvent) => event(e), call: (c: ToolCall) => call(c), setLocal: (value: unknown) => { localHistory = value; } };
}
const sessions: Array<ReturnType<typeof createAssistantWorkspace>> = [];
afterEach(async () => { for (const session of sessions.splice(0)) await session.dispose(); vi.restoreAllMocks(); });
async function harness(initial: unknown = null) {
  let saved = initial;
  const history: ChatHistoryStorage = { load: vi.fn(async () => structuredClone(saved)), save: vi.fn(async archive => { saved = structuredClone(archive); }) };
  const transports = new Map<string, ReturnType<typeof transport>>();
  const commands = new FeatureCommands();
  const write = vi.fn(() => ({}));
  commands.register({ name: "tab rename", description: "Rename", version: 1, effect: "write", inputSchema: emptyArgs, outputSchema: objectResult, examples: [], run: write });
  const make = () => {
    const manager = createAssistantWorkspace({ commands, history, transport: id => {
      const result = transport(); transports.set(id, result); return result.api;
    } }); sessions.push(manager); return manager;
  };
  const manager = make(); await manager.ready;
  return { manager, history, transports, write, make, saved: () => saved as ChatArchive };
}
const done: SessionEvent = { kind: "result", isError: false };

describe("saved assistant conversations", () => {
  it("keeps transcripts, drafts, model choices and Claude sessions separate across switching and restart", async () => {
    const h = await harness(); const a = h.manager.state.activeId;
    await h.manager.send("Plan a garden");
    h.transports.get(a)!.emit({ kind: "session", sessionId: "session-a" });
    h.transports.get(a)!.emit({ kind: "text", text: "Plant herbs." }); h.transports.get(a)!.emit(done);
    h.manager.setDraft("And tomatoes?");
    await h.manager.newChat(); const b = h.manager.state.activeId;
    expect(b).not.toBe(a); expect(h.manager.state.entries).toHaveLength(0); expect(h.manager.state.draft).toBe("");
    h.manager.setModel("ollama:local"); h.manager.setDraft("A separate draft");
    h.manager.renameChat(b, "Other ideas");
    await h.manager.switchChat(a);
    expect(h.manager.state.draft).toBe("And tomatoes?");
    expect(h.manager.state.entries[1]).toMatchObject({ text: "Plant herbs." });
    expect(h.manager.state.model).toBe("");
    await h.manager.flush();
    const restored = h.make(); await restored.ready;
    expect(restored.state.activeId).toBe(a);
    expect(restored.state.chats).toHaveLength(2);
    expect(restored.state.chats.find(c => c.id === b)?.title).toBe("Other ideas");
    await restored.send("Continue");
    expect(h.transports.get(a)!.api.send).toHaveBeenLastCalledWith(expect.objectContaining({ resume: "session-a" }));
  });

  it("cancels approvals on switching and ignores late output from the old chat", async () => {
    const h = await harness(); const a = h.manager.state.activeId;
    await h.manager.send("Rename");
    const old = h.transports.get(a)!;
    old.call({ callId: "call-old", name: "tab_rename", input: {} });
    await vi.waitFor(() => expect(h.manager.state.entries.some(e => e.kind === "tool" && e.status === "awaiting")).toBe(true));
    await h.manager.newChat();
    old.emit({ kind: "text", text: "late text" }); old.emit(done);
    h.manager.approve("call-old", true);
    expect(h.write).not.toHaveBeenCalled(); expect(h.manager.state.entries).toHaveLength(0);
    await h.manager.switchChat(a);
    expect(h.manager.state.entries.find(e => e.kind === "tool")).toMatchObject({ status: "cancelled" });
    expect(h.manager.state.entries.some(e => e.kind === "assistant" && e.text.includes("late"))).toBe(false);
  });

  it("persists partial responses and recovers them without streaming or live approvals", async () => {
    const h = await harness(); const id = h.manager.state.activeId;
    await h.manager.send("Continue a draft");
    h.transports.get(id)!.emit({ kind: "text", text: "Partial writing" });
    h.transports.get(id)!.call({ callId: "pending", name: "tab_rename", input: {} });
    await vi.waitFor(() => expect(h.manager.state.entries.some(e => e.kind === "tool" && e.status === "awaiting")).toBe(true));
    await h.manager.flush();
    const archive = readChatArchive(h.saved())!;
    expect(archive.chats[0].entries.find(e => e.kind === "tool")).toMatchObject({ status: "cancelled" });
    expect(archive.chats[0].entries.find(e => e.kind === "assistant")).toMatchObject({ text: "Partial writing", streaming: false });
    expect(archive.chats[0].entries[archive.chats[0].entries.length - 1]).toMatchObject({ kind: "notice" });
  });

  it("restores local model context and never shares it with a new chat", async () => {
    const h = await harness(); const a = h.manager.state.activeId;
    h.manager.setModel("ollama:local");
    const messages = [{ role: "user", content: "My word is violet" }, { role: "assistant", content: "Remembered" }];
    h.transports.get(a)!.setLocal(messages);
    await h.manager.newChat(); const b = h.manager.state.activeId;
    expect(h.transports.get(b)!.api.snapshot!()).toEqual([]);
    await h.manager.switchChat(a);
    expect(h.transports.get(a)!.api.snapshot!()).toEqual(messages);
    await h.manager.flush(); const restored = h.make(); await restored.ready;
    expect(h.transports.get(a)!.api.snapshot!()).toEqual(messages);
  });

  it("keeps history in memory on save failure and saves it on retry", async () => {
    const h = await harness(); h.manager.setDraft("Do not lose this");
    vi.mocked(h.history.save).mockRejectedValueOnce(new Error("disk full"));
    await expect(h.manager.flush()).rejects.toThrow("disk full");
    expect(h.manager.state.saveError).toBe("disk full"); expect(h.manager.state.draft).toBe("Do not lose this");
    await h.manager.flush(); expect(h.manager.state.saveError).toBe("");
    expect(h.saved().chats[0].draft).toBe("Do not lose this");
  });

  it("does not overwrite an invalid archive or allow sending before recovery", async () => {
    const h = await harness({ version: 99, activeId: "", chats: [] });
    expect(h.manager.state.ready).toBe(false); expect(h.manager.state.loadError).toContain("preserved");
    await h.manager.send("Hello"); await expect(h.manager.flush()).rejects.toThrow();
    expect(h.history.save).not.toHaveBeenCalled();
    expect([...h.transports.values()].every(t => vi.mocked(t.api.send).mock.calls.length === 0)).toBe(true);
  });

  it("deletes durably, keeps other chats, and retains a chat when deletion fails", async () => {
    const h = await harness(); const a = h.manager.state.activeId;
    h.manager.setDraft("keep on failure"); await h.manager.newChat(); const b = h.manager.state.activeId;
    vi.mocked(h.history.save).mockRejectedValueOnce(new Error("read only"));
    await h.manager.deleteChat(a);
    expect(h.manager.state.chats.some(c => c.id === a)).toBe(true);
    await h.manager.switchChat(a); expect(h.manager.state.draft).toBe("keep on failure");
    await h.manager.deleteChat(a); expect(h.manager.state.activeId).toBe(b);
    expect(h.saved().chats.map(c => c.id)).toEqual([b]);
    await h.manager.deleteChat(b); expect(h.manager.state.chats).toHaveLength(1);
    expect(h.manager.state.activeId).not.toBe(b);
  });
});
