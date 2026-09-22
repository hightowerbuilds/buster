/**
 * Headless assistant connections (Claude Code and Codex).
 *
 * Each CLI owns its own sign-in, so this module never handles a credential.
 * Detection is local and free; only `send` reaches a model.
 */

import { createStore } from "solid-js/store";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { CommandFailure, emptyArgs, objectResult, type CommandSchema, type FeatureCommands } from "./feature-commands";

export type AgentProvider = "claude-code" | "codex";

export interface AgentStatus {
  provider: AgentProvider;
  label: string;
  binary_path: string | null;
  version: string | null;
  signed_in: boolean;
  account: string | null;
  problem: string | null;
}

export interface AgentEvent {
  request_id: string;
  provider: AgentProvider;
  kind: "delta" | "message" | "tool" | "done" | "error";
  text: string;
}

export interface AgentRun {
  requestId: string;
  provider: AgentProvider;
  prompt: string;
  /** Streamed assistant text, in arrival order. */
  transcript: string;
  /** Names of tools the assistant used, for visible activity. */
  tools: string[];
  state: "running" | "completed" | "failed" | "cancelled";
  error: string;
}

export interface AgentConnectionState {
  statuses: AgentStatus[];
  /** True once detection has run at least once. */
  detected: boolean;
  detecting: boolean;
  runs: Record<string, AgentRun>;
  /** The assistant the writer chose, when one is usable. */
  active: AgentProvider | null;
}

export const PROVIDERS: AgentProvider[] = ["claude-code", "codex"];

/** A provider is only usable when its CLI is installed and signed in. */
export function isReady(status: AgentStatus | undefined): boolean {
  return !!status && !!status.binary_path && status.signed_in;
}

export interface AgentTransport {
  detect: () => Promise<AgentStatus[]>;
  send: (request: {
    requestId: string;
    provider: AgentProvider;
    prompt: string;
    model?: string;
    cwd?: string;
  }) => Promise<string>;
  cancel: (requestId: string) => Promise<void>;
  subscribe: (handler: (event: AgentEvent) => void) => Promise<UnlistenFn>;
}

export const tauriAgentTransport: AgentTransport = {
  detect: () => invoke<AgentStatus[]>("agent_detect"),
  send: ({ requestId, provider, prompt, model, cwd }) =>
    invoke<string>("agent_send", {
      request: { request_id: requestId, provider, prompt, model: model ?? null, cwd: cwd ?? null },
    }),
  cancel: requestId => invoke<void>("agent_cancel", { requestId }),
  subscribe: handler => listen<AgentEvent>("agent-event", event => handler(event.payload)),
};

export interface AgentConnectionDeps {
  transport?: AgentTransport;
  /** Working directory offered to the assistant; the Notes home by default. */
  cwd: () => string | null;
}

export function createAgentConnection(deps: AgentConnectionDeps) {
  const transport = deps.transport ?? tauriAgentTransport;
  const [state, setState] = createStore<AgentConnectionState>({
    statuses: [],
    detected: false,
    detecting: false,
    runs: {},
    active: null,
  });

  let unlisten: UnlistenFn | undefined;
  void transport
    .subscribe(event => {
      const run = state.runs[event.request_id];
      if (!run || run.state !== "running") return;
      if (event.kind === "delta" || event.kind === "message") {
        setState("runs", event.request_id, "transcript", text => text + event.text);
      } else if (event.kind === "tool") {
        setState("runs", event.request_id, "tools", tools => [...tools, event.text]);
      }
    })
    .then(off => { unlisten = off; });

  function status(provider: AgentProvider): AgentStatus | undefined {
    return state.statuses.find(item => item.provider === provider);
  }

  /** Re-read installation and sign-in state. Makes no model request. */
  async function detect(): Promise<AgentStatus[]> {
    setState("detecting", true);
    try {
      const statuses = await transport.detect();
      setState("statuses", statuses);
      setState("detected", true);
      // Drop a chosen assistant that is no longer usable.
      if (state.active && !isReady(statuses.find(item => item.provider === state.active))) {
        setState("active", null);
      }
      return statuses;
    } finally {
      setState("detecting", false);
    }
  }

  /** Choose the assistant that later requests use. */
  function connect(provider: AgentProvider): AgentStatus {
    const current = status(provider);
    if (!current) throw new Error("Run assistant detection first.");
    if (!current.binary_path) throw new Error(current.problem ?? `${current.label} is not installed.`);
    if (!current.signed_in) throw new Error(current.problem ?? `Sign in to ${current.label} first.`);
    setState("active", provider);
    return current;
  }

  function disconnect() {
    setState("active", null);
  }

  /** Send one request. Resolves with the assistant's final text. */
  async function send(options: { requestId: string; prompt: string; provider?: AgentProvider; model?: string }): Promise<AgentRun> {
    const provider = options.provider ?? state.active;
    if (!provider) throw new Error("Connect an assistant first.");
    if (!isReady(status(provider))) throw new Error("That assistant is not ready. Check its connection.");
    if (state.runs[options.requestId]) throw new Error("That assistant request ID is already in use.");

    setState("runs", options.requestId, {
      requestId: options.requestId,
      provider,
      prompt: options.prompt,
      transcript: "",
      tools: [],
      state: "running",
      error: "",
    });

    try {
      const text = await transport.send({
        requestId: options.requestId,
        provider,
        prompt: options.prompt,
        model: options.model,
        cwd: deps.cwd() ?? undefined,
      });
      // The command's return value is authoritative over streamed chunks.
      setState("runs", options.requestId, { state: "completed", transcript: text || state.runs[options.requestId].transcript });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const cancelled = message.toLowerCase().includes("cancel");
      setState("runs", options.requestId, { state: cancelled ? "cancelled" : "failed", error: message });
    }
    return state.runs[options.requestId];
  }

  /**
   * Begin a request and return as soon as it is registered.
   *
   * The shared dispatcher runs one command at a time, so a command that waited
   * for the whole assistant reply would block the tool calls that reply needs.
   * Watch `state.runs[requestId]`, or poll `read`, for progress.
   */
  function start(options: { requestId: string; prompt: string; provider?: AgentProvider; model?: string }): AgentRun {
    const provider = options.provider ?? state.active;
    if (!provider) throw new Error("Connect an assistant first.");
    if (!isReady(status(provider))) throw new Error("That assistant is not ready. Check its connection.");
    if (state.runs[options.requestId]) throw new Error("That assistant request ID is already in use.");
    // send() records its own failures on the run, so nothing is lost here.
    void send({ ...options, provider }).catch(() => {});
    return state.runs[options.requestId];
  }

  async function cancel(requestId: string): Promise<void> {
    const run = state.runs[requestId];
    if (!run) throw new Error("No such assistant request.");
    await transport.cancel(requestId);
  }

  function read(requestId: string): AgentRun {
    const run = state.runs[requestId];
    if (!run) throw new Error("No such assistant request.");
    return run;
  }

  function dispose() {
    unlisten?.();
    unlisten = undefined;
  }

  return { state, detect, connect, disconnect, send, start, cancel, read, status, dispose };
}

export type AgentConnection = ReturnType<typeof createAgentConnection>;

/**
 * Expose assistant connections through the shared catalog so the UI and an
 * in-app model reach the same handlers.
 */
export function registerAgentCommands(commands: FeatureCommands, agent: AgentConnection) {
  const str: CommandSchema = { type: "string", minLength: 1 };
  const obj = (properties: Record<string, CommandSchema>, required: string[] = []): CommandSchema =>
    ({ type: "object", properties, required, additionalProperties: false });
  const provider: CommandSchema = { type: "string", enum: [...PROVIDERS] };
  const examples: Record<string, object> = {
    "agent connect": { provider: "claude-code" },
    "agent send": { requestId: "<request ID>", prompt: "Suggest a clearer opening line." },
    "agent read": { requestId: "<request ID>" },
    "agent cancel": { requestId: "<request ID>" },
  };
  // Connection problems are the writer's to act on, so pass their text through
  // with a code rather than letting the dispatcher report a generic failure.
  const readable = (run: (args: any) => unknown) => async (args: any) => {
    try {
      return await run(args);
    } catch (cause) {
      if (cause instanceof CommandFailure) throw cause;
      throw new CommandFailure("UNAVAILABLE", cause instanceof Error ? cause.message : String(cause));
    }
  };
  const add = (
    name: string,
    description: string,
    inputSchema: CommandSchema,
    run: (args: any) => unknown,
    effect: "read" | "write" = "write",
    example = examples[name] ? `${name} ${JSON.stringify(examples[name])}` : name,
  ) => commands.register({ name, description, inputSchema, outputSchema: objectResult, run: readable(run), effect, version: 1, examples: [example] });

  add("agent detect", "Report which assistant CLIs are installed and signed in. Makes no model request.",
    emptyArgs, async () => ({ assistants: await agent.detect() }), "read");

  add("agent connect", "Choose the assistant that later requests use. Fails when it is missing or signed out.",
    obj({ provider }, ["provider"]), args => {
      const chosen = agent.connect(args.provider as AgentProvider);
      return { provider: chosen.provider, label: chosen.label, version: chosen.version, account: chosen.account };
    });

  add("agent disconnect", "Stop using the connected assistant. Running requests are unaffected.",
    emptyArgs, () => { agent.disconnect(); return { connected: false }; });

  add("agent send", "Start one assistant request. Returns immediately; poll `agent read` for the reply.",
    obj({ requestId: str, prompt: str, provider, model: str }, ["requestId", "prompt"]), args => {
      const run = agent.start({
        requestId: String(args.requestId),
        prompt: String(args.prompt),
        provider: args.provider as AgentProvider | undefined,
        model: args.model as string | undefined,
      });
      return { requestId: run.requestId, state: run.state, text: run.transcript, tools: run.tools, error: run.error };
    });

  add("agent read", "Read the current state of an assistant request.",
    obj({ requestId: str }, ["requestId"]), args => {
      const run = agent.read(String(args.requestId));
      return { requestId: run.requestId, state: run.state, text: run.transcript, tools: run.tools, error: run.error };
    }, "read");

  add("agent cancel", "Stop a running assistant request. Late output is ignored.",
    obj({ requestId: str }, ["requestId"]), async args => {
      await agent.cancel(String(args.requestId));
      return { cancelled: true };
    });
}
