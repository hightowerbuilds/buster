import { describe, it, expect, vi } from "vitest";
import { createAgentConnection, registerAgentCommands, isReady, type AgentEvent, type AgentStatus, type AgentTransport } from "./agent-connection";
import { FeatureCommands } from "./feature-commands";

function status(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    provider: "claude-code",
    label: "Claude Code",
    binary_path: "/usr/local/bin/claude",
    version: "2.1.0 (Claude Code)",
    signed_in: true,
    account: "claude.ai",
    problem: null,
    ...overrides,
  };
}

function harness(overrides: Partial<AgentTransport> = {}, statuses: AgentStatus[] = [status()]) {
  let emit: (event: AgentEvent) => void = () => {};
  const transport: AgentTransport = {
    detect: vi.fn(async () => statuses),
    send: vi.fn(async () => "final answer"),
    cancel: vi.fn(async () => {}),
    subscribe: async handler => { emit = handler; return () => {}; },
    ...overrides,
  };
  const agent = createAgentConnection({ transport, cwd: () => "/notes" });
  return { agent, transport, emit: (event: AgentEvent) => emit(event) };
}

describe("agent readiness", () => {
  it("requires both an installed CLI and a signed-in account", () => {
    expect(isReady(status())).toBe(true);
    expect(isReady(status({ binary_path: null }))).toBe(false);
    expect(isReady(status({ signed_in: false }))).toBe(false);
    expect(isReady(undefined)).toBe(false);
  });
});

describe("connect", () => {
  it("refuses an assistant that is missing or signed out, with its own explanation", async () => {
    const { agent } = harness({}, [
      status({ binary_path: null, signed_in: false, problem: "Claude Code is not installed." }),
      status({ provider: "codex", label: "Codex", signed_in: false, problem: "Not signed in. Run `codex login`." }),
    ]);
    await agent.detect();

    expect(() => agent.connect("claude-code")).toThrow("not installed");
    expect(() => agent.connect("codex")).toThrow("codex login");
    expect(agent.state.active).toBeNull();
  });

  it("connects a ready assistant and drops it when a later detection finds it signed out", async () => {
    const statuses = [status()];
    const { agent } = harness({ detect: vi.fn(async () => statuses) });
    await agent.detect();
    agent.connect("claude-code");
    expect(agent.state.active).toBe("claude-code");

    statuses[0] = status({ signed_in: false });
    await agent.detect();
    expect(agent.state.active).toBeNull();
  });
});

describe("send", () => {
  it("streams events into the run and prefers the command result as final text", async () => {
    const { agent, emit } = harness({
      send: vi.fn(async () => {
        emit({ request_id: "r1", provider: "claude-code", kind: "delta", text: "par" });
        emit({ request_id: "r1", provider: "claude-code", kind: "delta", text: "tial" });
        emit({ request_id: "r1", provider: "claude-code", kind: "tool", text: "Read" });
        return "the whole answer";
      }),
    });
    await agent.detect();
    agent.connect("claude-code");

    const run = await agent.send({ requestId: "r1", prompt: "Tidy this." });
    expect(run.state).toBe("completed");
    expect(run.transcript).toBe("the whole answer");
    expect(run.tools).toEqual(["Read"]);
  });

  it("passes the notes directory as the working root", async () => {
    const { agent, transport } = harness();
    await agent.detect();
    agent.connect("claude-code");
    await agent.send({ requestId: "r2", prompt: "hello" });
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/notes" }));
  });

  it("refuses to send without a connection, and rejects a reused request ID", async () => {
    const { agent } = harness();
    await expect(agent.send({ requestId: "r3", prompt: "hi" })).rejects.toThrow("Connect an assistant");

    await agent.detect();
    agent.connect("claude-code");
    await agent.send({ requestId: "r4", prompt: "hi" });
    await expect(agent.send({ requestId: "r4", prompt: "again" })).rejects.toThrow("already in use");
  });

  it("records a failure without throwing, and marks cancellation separately", async () => {
    const { agent } = harness({ send: vi.fn(async () => { throw new Error("Assistant request cancelled"); }) });
    await agent.detect();
    agent.connect("claude-code");

    const run = await agent.send({ requestId: "r5", prompt: "hi" });
    expect(run.state).toBe("cancelled");
    expect(agent.read("r5").state).toBe("cancelled");
  });

  it("ignores streamed events for a request that already finished", async () => {
    const { agent, emit } = harness();
    await agent.detect();
    agent.connect("claude-code");
    await agent.send({ requestId: "r6", prompt: "hi" });

    emit({ request_id: "r6", provider: "claude-code", kind: "delta", text: " late" });
    expect(agent.read("r6").transcript).toBe("final answer");
  });
});

describe("catalog commands", () => {
  it("shares the same handlers with the UI and reports readable errors", async () => {
    const { agent } = harness({}, [status({ signed_in: false, problem: "Not signed in. Run `claude auth login`." })]);
    const commands = new FeatureCommands();
    registerAgentCommands(commands, agent);

    const detected = await commands.dispatch({ requestId: "c1", command: "agent detect", args: {} }, "user");
    expect(detected.ok).toBe(true);

    const refused = await commands.dispatch({ requestId: "c2", command: "agent connect", args: { provider: "claude-code" } }, "ai");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain("claude auth login");
  });

  it("rejects an unknown provider through schema validation", async () => {
    const { agent } = harness();
    const commands = new FeatureCommands();
    registerAgentCommands(commands, agent);

    const result = await commands.dispatch({ requestId: "c3", command: "agent connect", args: { provider: "gemini" } }, "ai");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_ARGUMENTS");
  });
});

describe("start (non-blocking)", () => {
  it("lets another command run while the assistant is still replying", async () => {
    // Reproduces a deadlock: the shared dispatcher runs one command at a time,
    // so an assistant request that awaited its own reply blocked the tool calls
    // that reply depended on.
    let finishReply: (text: string) => void = () => {};
    const { agent } = harness({
      send: vi.fn(() => new Promise<string>(resolve => { finishReply = resolve; })),
    });
    await agent.detect();
    agent.connect("claude-code");

    const commands = new FeatureCommands();
    registerAgentCommands(commands, agent);
    commands.register({
      name: "document list", description: "List notes.", version: 1, effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: { type: "object", additionalProperties: true },
      examples: ["document list"], run: () => ({ notes: 2 }),
    });

    const started = await commands.dispatch({ requestId: "a1", command: "agent send", args: { requestId: "run-1", prompt: "count notes" } }, "user");
    expect(started).toMatchObject({ ok: true, data: { state: "running" } });

    // The assistant's tool call must not wait for the reply it is producing.
    const toolCall = await commands.dispatch({ requestId: "t1", command: "document list", args: {} }, "ai");
    expect(toolCall).toMatchObject({ ok: true, data: { notes: 2 } });

    finishReply("2");
    await vi.waitFor(() => expect(agent.read("run-1").state).toBe("completed"));
    expect(agent.read("run-1").transcript).toBe("2");
  });

  it("reports an unusable assistant immediately rather than in the background", async () => {
    const { agent } = harness({}, [status({ signed_in: false, problem: "Not signed in." })]);
    await agent.detect();
    expect(() => agent.start({ requestId: "run-2", prompt: "hi" })).toThrow("Connect an assistant");
  });
});
