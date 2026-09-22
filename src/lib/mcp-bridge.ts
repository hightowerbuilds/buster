/**
 * Publishes the command catalog to a connected assistant over the local MCP
 * server, and answers the tool calls it makes.
 *
 * Every call runs through the same dispatcher the writer's controls use, as
 * the `ai` caller, so an assistant reaches no behaviour the UI lacks.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { FeatureCommands } from "./feature-commands";

export interface McpEndpoint {
  url: string;
  token: string;
}

export interface McpToolCall {
  call_id: string;
  command: string;
  args: Record<string, unknown>;
}

export interface McpTool {
  command: string;
  description: string;
  input_schema: unknown;
}

export interface McpTransport {
  start: () => Promise<McpEndpoint>;
  stop: () => Promise<void>;
  setTools: (tools: McpTool[]) => Promise<number>;
  reply: (result: { call_id: string; ok: boolean; payload: string }) => Promise<void>;
  subscribe: (handler: (call: McpToolCall) => void) => Promise<UnlistenFn>;
}

export const tauriMcpTransport: McpTransport = {
  start: () => invoke<McpEndpoint>("mcp_start"),
  stop: () => invoke<void>("mcp_stop"),
  setTools: tools => invoke<number>("mcp_set_tools", { tools }),
  reply: result => invoke<void>("mcp_tool_result", { result }),
  subscribe: handler => listen<McpToolCall>("mcp-tool-call", event => handler(event.payload)),
};

/**
 * Commands that would let an assistant drive another assistant, or read the
 * connection secrets. Published tools stop at the writing features.
 */
const WITHHELD = new Set(["agent detect", "agent connect", "agent disconnect", "agent send", "agent read", "agent cancel"]);

/** The catalog an assistant may call, in MCP's shape. */
export function publishableTools(commands: FeatureCommands): McpTool[] {
  return commands
    .describe()
    .filter(command => !WITHHELD.has(command.name))
    .map(command => ({
      command: command.name,
      description: command.description,
      input_schema: command.inputSchema ?? { type: "object" },
    }));
}

export interface McpBridgeDeps {
  commands: FeatureCommands;
  transport?: McpTransport;
}

export function createMcpBridge(deps: McpBridgeDeps) {
  const transport = deps.transport ?? tauriMcpTransport;
  let unlisten: UnlistenFn | undefined;
  let endpoint: McpEndpoint | null = null;

  /** Run one forwarded tool call and hand the answer back. */
  async function answer(call: McpToolCall): Promise<void> {
    let ok = false;
    let payload = "";
    try {
      const result = await deps.commands.dispatch(
        { requestId: call.call_id, command: call.command, args: call.args ?? {} },
        "ai",
      );
      ok = result.ok;
      payload = JSON.stringify(result.ok ? result.data : result.error);
    } catch (cause) {
      payload = JSON.stringify({ code: "INTERNAL_ERROR", message: cause instanceof Error ? cause.message : String(cause) });
    }
    await transport.reply({ call_id: call.call_id, ok, payload });
  }

  /** Start publishing. Returns the endpoint the assistant will be pointed at. */
  async function start(): Promise<McpEndpoint> {
    if (!unlisten) unlisten = await transport.subscribe(call => { void answer(call); });
    endpoint = await transport.start();
    await transport.setTools(publishableTools(deps.commands));
    return endpoint;
  }

  async function stop(): Promise<void> {
    await transport.stop();
    endpoint = null;
  }

  /** Re-publish after the catalog changes. */
  async function refresh(): Promise<number> {
    return transport.setTools(publishableTools(deps.commands));
  }

  function dispose() {
    unlisten?.();
    unlisten = undefined;
  }

  return { start, stop, refresh, answer, dispose, endpoint: () => endpoint };
}

export type McpBridge = ReturnType<typeof createMcpBridge>;
