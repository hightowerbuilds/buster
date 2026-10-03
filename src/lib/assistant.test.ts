import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssistant, formatElapsed } from "./assistant";
import { buildAssistantTools, isAssistantTool, toolName } from "./assistant-tools";
import type { AssistantTransport, CliStatus, SendRequest, SessionEvent, ToolCall } from "./assistant-transport";
import { FeatureCommands, emptyArgs, objectResult } from "./feature-commands";

function catalog() {
  const commands = new FeatureCommands();
  const renamed: string[] = [];
  commands.register({ name: "document list", description: "List documents.", version: 1, effect: "read", inputSchema: emptyArgs, outputSchema: objectResult, examples: ["document list"], run: () => ({ documents: [{ tabId: "file_1" }] }) });
  commands.register({ name: "tab rename", description: "Rename a tab.", version: 1, effect: "write",
    inputSchema: { type: "object", properties: { tabId: { type: "string", minLength: 1 } }, required: ["tabId"], additionalProperties: false },
    outputSchema: objectResult, examples: [], run: args => { renamed.push(String(args.tabId)); return { ok: true }; } });
  commands.register({ name: "commands describe", description: "Describe.", version: 1, effect: "read", inputSchema: emptyArgs, outputSchema: objectResult, examples: [], run: () => ({}) });
  commands.register({ name: "speech read", description: "Speak.", version: 1, effect: "write", inputSchema: emptyArgs, outputSchema: objectResult, examples: [], available: () => false, run: () => ({}) });
  return { commands, renamed };
}

const signedIn: CliStatus = { installed: true, loggedIn: true, version: "2.1.283", authMethod: "claude.ai", subscription: "max", detail: null };

function fakeClaudeCode(status: CliStatus = signedIn) {
  let onEvent: (event: SessionEvent) => void = () => {};
  let onToolCall: (call: ToolCall) => void = () => {};
  const sent: SendRequest[] = [];
  const replies: Array<{ callId: string; content: string; isError: boolean }> = [];
  const transport: AssistantTransport = {
    status: vi.fn(async () => status),
    send: vi.fn(async (request: SendRequest) => { sent.push(structuredClone(request)); }),
    interrupt: vi.fn(async () => {}),
    reset: vi.fn(async () => {}),
    toolResult: vi.fn(async (callId: string, content: string, isError: boolean) => { replies.push({ callId, content, isError }); }),
    subscribe: async (event, call) => { onEvent = event; onToolCall = call; return () => {}; },
  };
  return { transport, sent, replies, emit: (event: SessionEvent) => onEvent(event), call: (call: ToolCall) => onToolCall(call) };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const done = (extra: Partial<Extract<SessionEvent, { kind: "result" }>> = {}): SessionEvent =>
  ({ kind: "result", subtype: "success", isError: false, usage: { input_tokens: 5, output_tokens: 3 }, ...extra });

afterEach(() => { vi.useRealTimers(); });

describe("assistant tools", () => {
  it("maps available commands to API-safe tool names and skips excluded ones", () => {
    const { tools, targets } = buildAssistantTools(catalog().commands);
    expect(tools.map(t => t.name)).toEqual(["document_list", "tab_rename"]);
    expect(targets.get("tab_rename")).toEqual({ command: "tab rename", effect: "write", confirm: true });
    expect(tools[1].description).toContain("must approve");
    expect(toolName("appearance presets apply")).toBe("appearance_presets_apply");
  });

  it("leaves panel-driving, clipboard and appearance commands out of Claude's tools", () => {
    for (const name of ["selection copy", "selection paste", "selection ai", "review apply", "search query", "appearance apply", "effects set", "history list"]) {
      expect(isAssistantTool(name)).toBe(false);
    }
    for (const name of ["document read", "document edit", "selection set", "format bold", "tab focus", "terminal create"]) {
      expect(isAssistantTool(name)).toBe(true);
    }
  });
});

describe("assistant through Claude Code", () => {
  it("sends settings and tools, streams the reply, and resumes the same session", async () => {
    const { commands } = catalog();
    const cc = fakeClaudeCode();
    const assistant = createAssistant({ commands, transport: cc.transport });
    await assistant.send("What is open?");
    expect(cc.sent[0]).toMatchObject({ text: "What is open?", effort: "high", resume: undefined });
    expect(cc.sent[0].model).toBeUndefined();
    expect(cc.sent[0].tools.map(t => t.name)).toEqual(["document_list", "tab_rename"]);
    expect(assistant.state.running).toBe(true);
    cc.emit({ kind: "session", sessionId: "s-1" });
    cc.emit({ kind: "message_start" });
    cc.emit({ kind: "thinking", text: "Look first." });
    cc.emit({ kind: "text", text: "One " });
    cc.emit({ kind: "text", text: "note." });
    cc.emit(done());
    expect(assistant.state.running).toBe(false);
    expect(assistant.state.entries.map(e => e.kind)).toEqual(["user", "assistant"]);
    expect(assistant.state.entries[1]).toMatchObject({ text: "One note.", thinking: "Look first.", streaming: false });
    expect(assistant.state.usage).toMatchObject({ input: 5, output: 3 });
    await assistant.send("And now?");
    expect(cc.sent[1].resume).toBe("s-1");
  });

  it("runs read tools automatically and answers the MCP call", async () => {
    const { commands } = catalog();
    const cc = fakeClaudeCode();
    const assistant = createAssistant({ commands, transport: cc.transport });
    await assistant.send("List");
    cc.call({ callId: "call-1", name: "document_list", input: {}, toolUseId: "toolu_1" });
    await vi.waitFor(() => expect(cc.replies).toHaveLength(1));
    expect(cc.replies[0]).toEqual({ callId: "call-1", content: JSON.stringify({ documents: [{ tabId: "file_1" }] }), isError: false });
    expect(assistant.state.entries.find(e => e.kind === "tool")).toMatchObject({ command: "document list", status: "done" });
  });

  it("waits for approval before a write tool, and reports a denial", async () => {
    const { commands, renamed } = catalog();
    const cc = fakeClaudeCode();
    const assistant = createAssistant({ commands, transport: cc.transport });
    await assistant.send("Rename");
    cc.call({ callId: "call-a", name: "tab_rename", input: { tabId: "file_1" } });
    cc.call({ callId: "call-b", name: "tab_rename", input: { tabId: "file_2" } });
    await flush();
    expect(assistant.state.entries.filter(e => e.kind === "tool").map(e => e.kind === "tool" && e.status)).toEqual(["awaiting", "awaiting"]);
    assistant.approve("call-a", true);
    assistant.approve("call-b", false);
    await vi.waitFor(() => expect(cc.replies).toHaveLength(2));
    expect(renamed).toEqual(["file_1"]);
    const denied = cc.replies.find(r => r.callId === "call-b")!;
    expect(denied.isError).toBe(true);
    expect(denied.content).toContain("declined");
  });

  it("answers unknown tools and schema failures with errors", async () => {
    const { commands } = catalog();
    const cc = fakeClaudeCode();
    const assistant = createAssistant({ commands, transport: cc.transport });
    await assistant.send("Go");
    cc.call({ callId: "u", name: "delete_everything", input: {} });
    cc.call({ callId: "s", name: "document_list", input: { extra: 1 } });
    await vi.waitFor(() => expect(cc.replies).toHaveLength(2));
    expect(cc.replies.map(r => r.isError)).toEqual([true, true]);
    expect(cc.replies.find(r => r.callId === "u")!.content).toContain("Unknown tool");
    expect(cc.replies.find(r => r.callId === "s")!.content).toContain("INVALID_ARGUMENTS");
  });

  it("runs writes marked confirm: false without an approval card", async () => {
    const { commands } = catalog();
    const opened: string[] = [];
    commands.register({ name: "note open", description: "Open.", version: 1, effect: "write", confirm: false,
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
      outputSchema: objectResult, examples: [], run: args => { opened.push(String(args.path)); return { tabId: "file_9" }; } });
    const cc = fakeClaudeCode();
    const assistant = createAssistant({ commands, transport: cc.transport });
    await assistant.send("Open it");
    cc.call({ callId: "open", name: "note_open", input: { path: "Iodine.md" } });
    await vi.waitFor(() => expect(cc.replies).toHaveLength(1));
    expect(cc.replies[0]).toMatchObject({ callId: "open", isError: false });
    expect(opened).toEqual(["Iodine.md"]);
    expect(assistant.state.entries.some(e => e.kind === "tool" && e.status === "awaiting")).toBe(false);
  });

  it("returns write calls that would fail straight to Claude without asking for approval", async () => {
    const { commands, renamed } = catalog();
    const cc = fakeClaudeCode();
    const assistant = createAssistant({ commands, transport: cc.transport });
    await assistant.send("Rename");
    cc.call({ callId: "bad", name: "tab_rename", input: { tabId: "" } });
    await vi.waitFor(() => expect(cc.replies).toHaveLength(1));
    expect(cc.replies[0]).toMatchObject({ callId: "bad", isError: true });
    expect(cc.replies[0].content).toContain("INVALID_ARGUMENTS");
    expect(assistant.state.entries.some(e => e.kind === "tool" && e.status === "awaiting")).toBe(false);
    expect(renamed).toEqual([]);
  });

  it("stop interrupts in place, cancels pending approvals, and hides the interrupt error", async () => {
    const { commands, renamed } = catalog();
    const cc = fakeClaudeCode();
    const assistant = createAssistant({ commands, transport: cc.transport });
    await assistant.send("Rename");
    cc.call({ callId: "call-x", name: "tab_rename", input: { tabId: "file_1" } });
    await flush();
    assistant.stop();
    expect(cc.transport.interrupt).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(cc.replies).toHaveLength(1));
    expect(cc.replies[0]).toMatchObject({ callId: "call-x", isError: true });
    expect(renamed).toEqual([]);
    cc.emit(done({ subtype: "error_during_execution", isError: true }));
    expect(assistant.state.running).toBe(false);
    const notices = assistant.state.entries.filter(e => e.kind === "notice").map(e => e.kind === "notice" && e.text);
    expect(notices).toEqual(["Stopped."]);
    expect(cc.transport.reset).not.toHaveBeenCalled();
  });

  it("times each response from send to result", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
    const { commands } = catalog();
    const cc = fakeClaudeCode();
    const assistant = createAssistant({ commands, transport: cc.transport });
    expect(assistant.state).toMatchObject({ turnStartedAt: null, lastTurnMs: null });
    await assistant.send("Hi");
    expect(assistant.state.turnStartedAt).toBe(Date.parse("2026-09-27T12:00:00Z"));
    vi.setSystemTime(new Date("2026-09-27T12:01:05Z"));
    cc.emit(done());
    expect(assistant.state).toMatchObject({ running: false, turnStartedAt: null, lastTurnMs: 65_000 });
    await assistant.send("Again");
    expect(assistant.state.lastTurnMs).toBeNull();
    assistant.reset();
    expect(assistant.state).toMatchObject({ turnStartedAt: null, lastTurnMs: null });
  });

  it("formats elapsed time as minutes and seconds", () => {
    expect([0, 999, 12_400, 65_000, 3_600_000].map(formatElapsed)).toEqual(["0:00", "0:00", "0:12", "1:05", "60:00"]);
  });

  it("ends the process if an interrupt is not confirmed", async () => {
    vi.useFakeTimers();
    const { commands } = catalog();
    const cc = fakeClaudeCode();
    const assistant = createAssistant({ commands, transport: cc.transport });
    await assistant.send("Long");
    assistant.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(cc.transport.reset).toHaveBeenCalledOnce();
    expect(assistant.state.running).toBe(false);
  });

  it("reports Claude Code errors, usage limits and unexpected exits", async () => {
    const { commands } = catalog();
    const cc = fakeClaudeCode();
    const assistant = createAssistant({ commands, transport: cc.transport });
    await assistant.send("One");
    cc.emit(done({ isError: true, subtype: "error_during_execution", text: "Overloaded" }));
    await assistant.send("Two");
    cc.emit({ kind: "rate_limit", info: { status: "rejected" } });
    cc.emit({ kind: "exit", code: 1, detail: "boom" });
    expect(assistant.state.running).toBe(false);
    const notices = assistant.state.entries.filter(e => e.kind === "notice").map(e => e.kind === "notice" && e.text);
    expect(notices).toEqual(["Overloaded", "Your Claude usage limit has been reached.", "Claude Code stopped: boom"]);
  });

  it("surfaces send failures and rechecks the connection", async () => {
    const { commands } = catalog();
    const cc = fakeClaudeCode({ ...signedIn, loggedIn: false, detail: "Not signed in" });
    cc.transport.send = vi.fn(async () => { throw new Error("Claude Code is not installed"); });
    const assistant = createAssistant({ commands, transport: cc.transport });
    await assistant.send("Hi");
    expect(assistant.state.running).toBe(false);
    await vi.waitFor(() => expect(assistant.state.connection).toBe("logged-out"));
    expect(assistant.state.entries[assistant.state.entries.length - 1]).toMatchObject({ kind: "notice", text: "Claude Code is not installed" });
  });

  it("new chat ends the process and forgets the session", async () => {
    const { commands } = catalog();
    const cc = fakeClaudeCode();
    const assistant = createAssistant({ commands, transport: cc.transport });
    await assistant.send("One");
    cc.emit({ kind: "session", sessionId: "s-9" });
    cc.emit(done());
    assistant.reset();
    expect(cc.transport.reset).toHaveBeenCalled();
    expect(assistant.state.entries).toEqual([]);
    await assistant.send("Two");
    expect(cc.sent[1].resume).toBeUndefined();
  });

  it("omits effort for Haiku and passes explicit models", async () => {
    const { commands } = catalog();
    const cc = fakeClaudeCode();
    const assistant = createAssistant({ commands, transport: cc.transport });
    assistant.setModel("claude-haiku-4-5");
    await assistant.send("Hello");
    expect(cc.sent[0]).toMatchObject({ model: "claude-haiku-4-5" });
    expect(cc.sent[0].effort).toBeUndefined();
  });

  it("maps Claude Code status to a connection state", async () => {
    const { commands } = catalog();
    const cases: Array<[CliStatus, string, string]> = [
      [signedIn, "ready", "Claude Max via Claude Code 2.1.283"],
      [{ ...signedIn, loggedIn: false, detail: "Sign in" }, "logged-out", "Sign in"],
      [{ ...signedIn, authMethod: "api_key", detail: "API key" }, "logged-out", "API key"],
      [{ ...signedIn, installed: false, detail: "Install it" }, "missing", "Install it"],
    ];
    for (const [status, connection, detail] of cases) {
      const assistant = createAssistant({ commands, transport: fakeClaudeCode(status).transport });
      await assistant.refreshStatus();
      expect(assistant.state).toMatchObject({ connection, connectionDetail: detail });
    }
  });

  it("shows Ollama's status for local models and sends chat-only models no tools", async () => {
    const { commands } = catalog();
    const cc = fakeClaudeCode();
    const transport = { ...cc.transport, localModels: vi.fn(async () => ({ baseUrl: "http://localhost:11434/", version: "0.34.4", models: [
      { name: "qwen3.5:4b", family: "qwen35", parameterSize: "4.7B", sizeBytes: 1, tools: true, thinking: true },
      { name: "tiny:1b", family: "llama", parameterSize: "1B", sizeBytes: 1, tools: false, thinking: false },
    ] })) };
    const assistant = createAssistant({ commands, transport });
    await assistant.refreshStatus();
    expect(assistant.state.localModels.map(m => m.name)).toEqual(["qwen3.5:4b", "tiny:1b"]);
    assistant.setModel("ollama:qwen3.5:4b");
    expect(assistant.state).toMatchObject({ connection: "ready", connectionDetail: "Local model via Ollama 0.34.4" });
    assistant.setModel("ollama:missing:7b");
    expect(assistant.state.connection).toBe("missing");
    expect(assistant.state.connectionDetail).toContain("ollama pull missing:7b");
    assistant.setModel("claude-opus-5");
    expect(assistant.state.connection).toBe("ready");
    assistant.setModel("ollama:tiny:1b");
    await assistant.send("Hello");
    expect(cc.sent[0]).toMatchObject({ model: "ollama:tiny:1b", tools: [] });
    cc.emit(done());
    assistant.setModel("ollama:qwen3.5:4b");
    await assistant.send("Again");
    expect(cc.sent[1].tools.length).toBeGreaterThan(0);
  });

  it("reports when Ollama is not running and notes provider switches", async () => {
    const { commands } = catalog();
    const cc = fakeClaudeCode();
    const transport = { ...cc.transport, localModels: vi.fn(async () => { throw new Error("Ollama is not running at http://localhost:11434/."); }) };
    const assistant = createAssistant({ commands, transport });
    await assistant.refreshStatus();
    assistant.setModel("ollama:qwen3.5:4b");
    expect(assistant.state).toMatchObject({ connection: "missing", connectionDetail: "Ollama is not running at http://localhost:11434/." });
    assistant.setModel("claude-opus-5");
    await assistant.send("Hi"); cc.emit(done());
    assistant.setModel("ollama:qwen3.5:4b");
    await assistant.send("Hi local");
    expect(assistant.state.entries.some(e => e.kind === "notice" && e.text.includes("starts without the earlier conversation"))).toBe(true);
  });

  it("persists model, effort, visibility and width", () => {
    const { commands } = catalog();
    const stored = new Map([["bustermark.assistant.model", "claude-sonnet-5"], ["bustermark.assistant.effort", "bogus"], ["bustermark.assistant.width", "5000"]]);
    const assistant = createAssistant({ commands, transport: fakeClaudeCode().transport, storage: { get: k => stored.get(k) ?? null, set: (k, v) => stored.set(k, v) } });
    expect(assistant.state).toMatchObject({ model: "claude-sonnet-5", effort: "high", width: 720, open: false });
    assistant.setModel("");
    assistant.setEffort("max");
    assistant.setOpen(true);
    assistant.setWidth(10);
    expect([...stored.entries()]).toEqual(expect.arrayContaining([["bustermark.assistant.model", ""], ["bustermark.assistant.effort", "max"], ["bustermark.assistant.open", "true"]]));
    expect(assistant.state.width).toBe(300);
  });
});
