import { describe, expect, it, vi } from "vitest";
import { createLocalModelTransport, createRoutingTransport, isLocalModel, ollamaTools, type LocalModelIpc } from "./local-model-transport";
import type { AssistantTransport, SendRequest, SessionEvent, ToolCall } from "./assistant-transport";

type Reply = { content?: string; thinking?: string; toolCalls?: Array<{ id?: string; function: { name: string; arguments: unknown } }> };

function fakeOllama(replies: Reply[]) {
  const requests: Array<{ model: string; messages: unknown[]; tools: unknown[]; think: boolean }> = [];
  const ipc: LocalModelIpc = {
    models: vi.fn(async () => ({ baseUrl: "http://localhost:11434/", version: "0.34.4", models: [] })),
    chat: vi.fn(async (request, onEvent) => {
      requests.push(structuredClone(request));
      const reply = replies.shift();
      if (!reply) throw new Error("no scripted reply");
      if (reply.thinking) onEvent("thinking", reply.thinking);
      if (reply.content) onEvent("text", reply.content);
      return { content: reply.content ?? "", thinking: reply.thinking ?? "", toolCalls: reply.toolCalls ?? [], doneReason: "stop", promptTokens: 100, outputTokens: 10 };
    }),
    cancel: vi.fn(async () => {}),
  };
  return { ipc, requests };
}

async function harness(replies: Reply[]) {
  const fake = fakeOllama(replies);
  const transport = createLocalModelTransport(fake.ipc);
  const events: SessionEvent[] = [];
  const calls: ToolCall[] = [];
  await transport.subscribe(e => events.push(e), c => calls.push(c));
  return { ...fake, transport, events, calls };
}

const send = (text: string, extra: Partial<SendRequest> = {}): SendRequest => ({
  text, model: "ollama:qwen3.5:4b", effort: "high", system: "You are the writing assistant.",
  tools: [{ name: "document_list", description: "List notes.", input_schema: { type: "object", properties: {}, additionalProperties: false } }], ...extra,
});
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const last = <T,>(items: T[]) => items[items.length - 1];

describe("local model transport", () => {
  it("converts tools to Ollama's function format and recognises local model IDs", () => {
    expect(ollamaTools(send("x").tools)).toEqual([{ type: "function", function: { name: "document_list", description: "List notes.", parameters: { type: "object", properties: {}, additionalProperties: false } } }]);
    expect(isLocalModel("ollama:qwen3.5:4b")).toBe(true);
    expect(isLocalModel("claude-opus-5")).toBe(false);
  });

  it("streams a reply and reports usage, with the system prompt and thinking on", async () => {
    const h = await harness([{ thinking: "Say hello.", content: "Hello!" }]);
    await h.transport.send(send("Hi"));
    await vi.waitFor(() => expect(last(h.events)).toMatchObject({ kind: "result", isError: false }));
    expect(h.requests[0]).toMatchObject({ model: "qwen3.5:4b", think: true, messages: [{ role: "system" }, { role: "user", content: "Hi" }] });
    expect(h.events.map(e => e.kind)).toEqual(["message_start", "thinking", "text", "result"]);
    expect(last(h.events)).toMatchObject({ usage: { input_tokens: 100, output_tokens: 10 } });
  });

  it("runs tool calls through the sidebar and returns their results to the model", async () => {
    const h = await harness([
      { toolCalls: [{ id: "call_1", function: { name: "document_list", arguments: {} } }] },
      { content: "You have one note." },
    ]);
    await h.transport.send(send("What is open?"));
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    expect(h.calls[0]).toMatchObject({ name: "document_list", input: {}, toolUseId: h.calls[0].callId });
    await h.transport.toolResult(h.calls[0].callId, '{"documents":[]}', false);
    await vi.waitFor(() => expect(last(h.events)).toMatchObject({ kind: "result", isError: false }));
    expect(h.requests[1].messages.slice(-2)).toEqual([
      { role: "assistant", content: "", tool_calls: [{ id: "call_1", function: { name: "document_list", arguments: {} } }] },
      { role: "tool", tool_name: "document_list", content: '{"documents":[]}' },
    ]);
  });

  it("keeps the conversation across messages and clears it on reset", async () => {
    const h = await harness([{ content: "One" }, { content: "Two" }, { content: "Fresh" }]);
    await h.transport.send(send("First")); await flush();
    await h.transport.send(send("Second")); await flush();
    expect(h.requests[1].messages.map(m => (m as { role: string }).role)).toEqual(["system", "user", "assistant", "user"]);
    await h.transport.reset();
    await h.transport.send(send("New")); await flush();
    expect(h.requests[2].messages).toHaveLength(2);
  });

  it("turns thinking off at Low effort and parses string arguments", async () => {
    const h = await harness([{ toolCalls: [{ function: { name: "document_list", arguments: '{"a":1}' } }] }, { content: "ok" }]);
    await h.transport.send(send("Go", { effort: "low" }));
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    expect(h.requests[0].think).toBe(false);
    expect(h.calls[0].input).toEqual({ a: 1 });
  });

  it("interrupts a waiting tool call and reports it like Claude Code does", async () => {
    const h = await harness([{ toolCalls: [{ id: "call_x", function: { name: "document_list", arguments: {} } }] }]);
    await h.transport.send(send("Go"));
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    await h.transport.interrupt();
    expect(last(h.events)).toMatchObject({ kind: "result", subtype: "error_during_execution", isError: true });
    await flush();
    expect(h.ipc.chat).toHaveBeenCalledTimes(1);
  });

  it("reports Ollama errors as a failed result", async () => {
    const h = await harness([]);
    await h.transport.send(send("Hi"));
    await vi.waitFor(() => expect(last(h.events)).toMatchObject({ kind: "result", isError: true, text: "no scripted reply" }));
  });
});

describe("routing transport", () => {
  it("sends local models to Ollama and others to Claude Code", async () => {
    const h = await harness([{ content: "local" }]);
    const claude: AssistantTransport = {
      status: vi.fn(async () => ({ installed: true, loggedIn: true, version: "1", authMethod: "claude.ai", subscription: "max", detail: null })),
      send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), reset: vi.fn(async () => {}),
      toolResult: vi.fn(async () => {}), subscribe: vi.fn(async () => () => {}),
    };
    const routing = createRoutingTransport(claude, h.transport);
    await routing.send(send("to claude", { model: "claude-opus-5" }));
    expect(claude.send).toHaveBeenCalledOnce();
    await routing.send(send("to qwen"));
    await flush();
    expect(h.requests).toHaveLength(1);
    await routing.toolResult("claude-call", "x", false);
    expect(claude.toolResult).toHaveBeenCalledWith("claude-call", "x", false);
    await routing.reset();
    expect(claude.reset).toHaveBeenCalled();
    expect((await routing.localModels()).version).toBe("0.34.4");
  });
});
