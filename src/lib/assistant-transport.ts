import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AssistantTool } from "./assistant-tools";
import type { AiProvider } from "./ai-oneshot";

/** The CLI's installation and sign-in (for Claude Code, as reported by `claude auth status`). */
export interface CliStatus {
  installed: boolean;
  loggedIn: boolean;
  version: string | null;
  authMethod: string | null;
  subscription: string | null;
  detail: string | null;
}

export interface SendRequest {
  text: string;
  model?: string;
  effort?: string;
  system: string;
  tools: AssistantTool[];
  /** Session to continue when a new process has to be started (every message, for Codex and OpenCode). */
  resume?: string;
  /** The CLI that answers: Claude Code (default), Codex, or OpenCode. */
  provider?: AiProvider;
}

export type SessionEvent =
  | { kind: "session"; sessionId: string; model?: string }
  | { kind: "message_start" }
  | { kind: "block_start"; blockType?: string; name?: string }
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "result"; subtype?: string; isError?: boolean; text?: string; usage?: Record<string, number>; sessionId?: string }
  | { kind: "retry"; detail?: unknown }
  | { kind: "rate_limit"; info?: { status?: string; resetsAt?: number; rateLimitType?: string } }
  | { kind: "exit"; code: number | null; detail: string };

export interface ToolCall { callId: string; name: string; input: Record<string, unknown> | null; toolUseId?: string | null }

export interface AssistantTransport {
  status(provider?: AiProvider): Promise<CliStatus>;
  send(request: SendRequest): Promise<void>;
  interrupt(): Promise<void>;
  reset(): Promise<void>;
  toolResult(callId: string, content: string, isError: boolean): Promise<void>;
  subscribe(onEvent: (event: SessionEvent) => void, onToolCall: (call: ToolCall) => void): Promise<() => void>;
}

export const createClaudeCodeTransport = (conversationId = "default"): AssistantTransport => {
  let channelId = crypto.randomUUID();
  const reset = () => { channelId = crypto.randomUUID(); return invoke<void>("assistant_reset", { conversationId }); };
  return {
  status: provider => invoke<CliStatus>("assistant_status", { provider }),
  send: request => invoke("assistant_send", { request: { ...request, conversationId, channelId } }),
  interrupt: () => invoke("assistant_interrupt", { conversationId }),
  reset,
  toolResult: (callId, content, isError) => invoke("assistant_tool_result", { conversationId, callId, content, isError }),
  async subscribe(onEvent, onToolCall) {
    const stops = await Promise.all([
      listen<SessionEvent & { conversationId?: string; channelId?: string }>("assistant-event", ({ payload }) => {
        if ((payload.conversationId ?? "default") === conversationId && payload.channelId === channelId) onEvent(payload);
      }),
      listen<ToolCall & { conversationId?: string; channelId?: string }>("assistant-tool-call", ({ payload }) => {
        if ((payload.conversationId ?? "default") === conversationId && payload.channelId === channelId) onToolCall(payload);
      }),
    ]);
    // A reloaded frontend must not inherit a still-running process or an old approval.
    try { await reset(); }
    catch (error) { stops.forEach(stop => stop()); throw error; }
    return () => stops.forEach(stop => stop());
  },
  };
};
export const claudeCodeTransport = createClaudeCodeTransport();
