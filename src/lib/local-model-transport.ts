import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AssistantTool } from "./assistant-tools";
import type { AssistantTransport, SendRequest, SessionEvent, ToolCall } from "./assistant-transport";

/** Local model IDs in the sidebar carry this prefix, e.g. "ollama:qwen3.5:4b". */
export const LOCAL_PREFIX = "ollama:";
export const isLocalModel = (model: string | undefined) => !!model?.startsWith(LOCAL_PREFIX);

export interface LocalModel { name: string; family: string | null; parameterSize: string | null; sizeBytes: number; tools: boolean; thinking: boolean }
export interface LocalModels { baseUrl: string; version: string | null; models: LocalModel[] }

export type OllamaMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: unknown[]; tool_name?: string };

/** Complete interrupted tool exchanges without ever rerunning their actions. */
export function restoreLocalHistory(value: unknown): OllamaMessage[] {
  if (!Array.isArray(value)) throw new Error("Invalid local chat history");
  const messages: OllamaMessage[] = JSON.parse(JSON.stringify(value));
  for (const message of messages) {
    if (!message || !["user", "assistant", "tool"].includes(message.role) || typeof message.content !== "string"
      || (message.tool_calls !== undefined && !Array.isArray(message.tool_calls))) throw new Error("Invalid local chat message");
  }
  const restored: OllamaMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]; restored.push(message);
    if (!message.tool_calls?.length) continue;
    const replies: OllamaMessage[] = [];
    while (messages[i + 1]?.role === "tool") replies.push(messages[++i]);
    for (const call of message.tool_calls) {
      const name = (call as { function?: { name?: unknown } })?.function?.name;
      if (typeof name !== "string") throw new Error("Invalid saved local tool call");
      const index = replies.findIndex(reply => reply.tool_name === name);
      restored.push(index >= 0 ? replies.splice(index, 1)[0] : { role: "tool", tool_name: name, content: "Interrupted before completion. Inspect the current state before taking any further action." });
    }
    restored.push(...replies);
  }
  return restored;
}
interface ChatResult { content: string; thinking: string; toolCalls: Array<{ id?: string; function: { name: string; arguments: unknown } }>; doneReason: string | null; promptTokens: number; outputTokens: number }

export interface LocalModelIpc {
  models(): Promise<LocalModels>;
  chat(request: { requestId: string; model: string; messages: OllamaMessage[]; tools: unknown[]; think: boolean }, onEvent: (kind: "text" | "thinking", text: string) => void): Promise<ChatResult>;
  cancel(requestId: string): Promise<void>;
}

export const nativeLocalModelIpc: LocalModelIpc = {
  models: () => invoke<LocalModels>("local_models"),
  async chat(request, onEvent) {
    const stop = await listen<{ requestId: string; kind: "text" | "thinking"; text: string }>("local-model-event", ({ payload }) => {
      if (payload.requestId === request.requestId) onEvent(payload.kind, payload.text);
    });
    try { return await invoke<ChatResult>("local_chat", { request }); }
    finally { stop(); }
  },
  cancel: requestId => invoke("local_chat_cancel", { requestId }),
};

const MAX_STEPS = 30;

/** Ollama tool format for the command catalog. */
export const ollamaTools = (tools: AssistantTool[]) =>
  tools.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }));

/**
 * Runs the tool loop against a local model and reports it with the same events and tool calls as the
 * Claude Code transport, so the sidebar's approvals, previews and Stop work unchanged.
 */
export function createLocalModelTransport(ipc: LocalModelIpc = nativeLocalModelIpc): Omit<AssistantTransport, "status"> & { models: () => Promise<LocalModels> } {
  let onEvent: (event: SessionEvent) => void = () => {};
  let onToolCall: (call: ToolCall) => void = () => {};
  let history: OllamaMessage[] = [];
  let running: { requestId: string | null; stopped: boolean } | null = null;
  const waiting = new Map<string, (reply: { content: string; isError: boolean }) => void>();
  let nextId = 0;

  /** Stops the running turn, if any; tool calls still waiting are answered as cancelled. */
  function stopRunning() {
    const turn = running;
    if (!turn) return false;
    turn.stopped = true;
    running = null;
    if (turn.requestId) void ipc.cancel(turn.requestId).catch(() => {});
    for (const [callId, resolve] of waiting) { waiting.delete(callId); resolve({ content: "Cancelled by the user before this ran.", isError: true }); }
    return true;
  }

  async function loop(request: SendRequest, turn: { requestId: string | null; stopped: boolean }) {
    const model = (request.model ?? "").slice(LOCAL_PREFIX.length);
    const think = request.effort !== "low";
    const tools = ollamaTools(request.tools);
    const usage = { input_tokens: 0, output_tokens: 0 };
    for (let step = 0; step < MAX_STEPS; step++) {
      turn.requestId = `local-${Date.now()}-${nextId++}`;
      onEvent({ kind: "message_start" });
      const result = await ipc.chat({
        requestId: turn.requestId, model, think, tools,
        messages: [{ role: "system", content: request.system }, ...history],
      }, (kind, text) => { if (!turn.stopped) onEvent({ kind, text }); });
      if (turn.stopped) return;
      usage.input_tokens += result.promptTokens;
      usage.output_tokens += result.outputTokens;
      history.push({ role: "assistant", content: result.content, ...(result.toolCalls.length ? { tool_calls: result.toolCalls } : {}) });
      if (!result.toolCalls.length) {
        onEvent({ kind: "result", subtype: "success", isError: false, usage });
        return;
      }
      for (const call of result.toolCalls) {
        const callId = `local-call-${crypto.randomUUID()}`;
        const reply = turn.stopped
          ? { content: "Cancelled by the user before this ran.", isError: true }
          : await new Promise<{ content: string; isError: boolean }>(resolve => {
            waiting.set(callId, resolve);
            const args = call.function.arguments;
            const input = typeof args === "string" ? safeJson(args) : (args as Record<string, unknown> | null) ?? {};
            onToolCall({ callId, name: call.function.name, input, toolUseId: callId });
          });
        if (!turn.stopped) history.push({ role: "tool", tool_name: call.function.name, content: reply.content });
      }
      if (turn.stopped) return;
    }
    onEvent({ kind: "result", subtype: "error_max_turns", isError: true, usage });
  }

  return {
    snapshot: () => JSON.parse(JSON.stringify(history)),
    restore: value => { if (running) throw new Error("Cannot restore a running chat"); history = restoreLocalHistory(value); },
    models: () => ipc.models(),
    async send(request) {
      const turn = { requestId: null as string | null, stopped: false };
      running = turn;
      history.push({ role: "user", content: request.text });
      void loop(request, turn).catch(error => {
        if (!turn.stopped) onEvent({ kind: "result", subtype: "error", isError: true, text: error instanceof Error ? error.message : String(error) });
      }).finally(() => { if (running === turn) running = null; });
    },
    async interrupt() {
      if (stopRunning()) onEvent({ kind: "result", subtype: "error_during_execution", isError: true });
    },
    async reset() {
      stopRunning();
      history = [];
    },
    async toolResult(callId, content, isError) {
      const resolve = waiting.get(callId);
      waiting.delete(callId);
      resolve?.({ content, isError });
    },
    async subscribe(event, call) {
      onEvent = event;
      onToolCall = call;
      return () => { onEvent = () => {}; onToolCall = () => {}; };
    },
  };
}

function safeJson(text: string): Record<string, unknown> {
  try { const value = JSON.parse(text); return value && typeof value === "object" ? value : {}; } catch { return {}; }
}

/** Sends each message to Claude Code or the local model based on the selected model. */
export function createRoutingTransport(claude: AssistantTransport, local: ReturnType<typeof createLocalModelTransport>): AssistantTransport & { localModels: () => Promise<LocalModels> } {
  let active: "claude" | "local" = "claude";
  return {
    snapshot: () => local.snapshot?.(),
    restore: value => local.restore?.(value),
    status: () => claude.status(),
    localModels: () => local.models(),
    send(request) {
      active = isLocalModel(request.model) ? "local" : "claude";
      return active === "local" ? local.send(request) : claude.send(request);
    },
    interrupt: () => active === "local" ? local.interrupt() : claude.interrupt(),
    async reset() { await Promise.all([claude.reset(), local.reset()]); },
    toolResult: (callId, content, isError) => callId.startsWith("local-call-") ? local.toolResult(callId, content, isError) : claude.toolResult(callId, content, isError),
    async subscribe(onEvent, onToolCall) {
      const stops = await Promise.all([claude.subscribe(onEvent, onToolCall), local.subscribe(onEvent, onToolCall)]);
      return () => stops.forEach(stop => stop());
    },
  };
}
