import { describe, it, expect, vi } from "vitest";
import { createMcpBridge, publishableTools, type McpToolCall, type McpTransport } from "./mcp-bridge";
import { FeatureCommands, emptyArgs, objectResult, CommandFailure } from "./feature-commands";

function catalog() {
  const commands = new FeatureCommands();
  commands.register({
    name: "document list", description: "List open notes.", version: 1, effect: "read",
    inputSchema: emptyArgs, outputSchema: objectResult, examples: ["document list"],
    run: () => ({ notes: ["one"] }),
  });
  commands.register({
    name: "panel split", description: "Split a pane.", version: 1, effect: "write",
    inputSchema: { type: "object", properties: { direction: { type: "string" } }, required: ["direction"], additionalProperties: false },
    outputSchema: objectResult, examples: ['panel split {"direction":"right"}'],
    run: (args: any) => ({ direction: args.direction }),
  });
  commands.register({
    name: "format bold", description: "Toggle bold.", version: 1, effect: "write",
    inputSchema: emptyArgs, outputSchema: objectResult, examples: ["format bold"],
    run: () => { throw new CommandFailure("STALE_FORMAT_TARGET", "Your selection changed."); },
  });
  // Stands in for the agent commands, which must never be published.
  commands.register({
    name: "agent send", description: "Send to the assistant.", version: 1, effect: "write",
    inputSchema: emptyArgs, outputSchema: objectResult, examples: ["agent send"],
    run: () => ({}),
  });
  return commands;
}

function harness(overrides: Partial<McpTransport> = {}) {
  let emit: (call: McpToolCall) => void = () => {};
  const replies: { call_id: string; ok: boolean; payload: string }[] = [];
  const transport: McpTransport = {
    start: vi.fn(async () => ({ url: "http://127.0.0.1:1/mcp", token: "t" })),
    stop: vi.fn(async () => {}),
    setTools: vi.fn(async tools => tools.length),
    reply: vi.fn(async result => { replies.push(result); }),
    subscribe: async handler => { emit = handler; return () => {}; },
    ...overrides,
  };
  const commands = catalog();
  const bridge = createMcpBridge({ commands, transport });
  return { bridge, transport, commands, replies, emit: (call: McpToolCall) => emit(call) };
}

describe("publishableTools", () => {
  it("publishes writing commands with their schemas", () => {
    const tools = publishableTools(catalog());
    const split = tools.find(tool => tool.command === "panel split");
    expect(split?.description).toBe("Split a pane.");
    expect(split?.input_schema).toMatchObject({ type: "object", required: ["direction"] });
  });

  it("withholds the assistant-control commands", () => {
    const names = publishableTools(catalog()).map(tool => tool.command);
    expect(names).toContain("document list");
    expect(names).not.toContain("agent send");
  });
});

describe("bridge", () => {
  it("starts the server and publishes the catalog", async () => {
    const { bridge, transport } = harness();
    const endpoint = await bridge.start();
    expect(endpoint.url).toContain("127.0.0.1");
    expect(transport.setTools).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ command: "document list" })]),
    );
  });

  it("runs a forwarded call through the dispatcher and returns its data", async () => {
    const { bridge, replies } = harness();
    await bridge.start();

    await bridge.answer({ call_id: "mcp-1", command: "panel split", args: { direction: "right" } });
    expect(replies[0]).toMatchObject({ call_id: "mcp-1", ok: true });
    expect(JSON.parse(replies[0].payload)).toEqual({ direction: "right" });
  });

  it("returns the command's own error rather than throwing", async () => {
    const { bridge, replies } = harness();
    await bridge.start();

    await bridge.answer({ call_id: "mcp-2", command: "format bold", args: {} });
    expect(replies[0].ok).toBe(false);
    expect(JSON.parse(replies[0].payload)).toMatchObject({ code: "STALE_FORMAT_TARGET" });
  });

  it("refuses arguments that fail the command's schema", async () => {
    const { bridge, replies } = harness();
    await bridge.start();

    await bridge.answer({ call_id: "mcp-3", command: "panel split", args: { direction: 7 } });
    expect(replies[0].ok).toBe(false);
    expect(JSON.parse(replies[0].payload)).toMatchObject({ code: "INVALID_ARGUMENTS" });
  });

  it("reports an unknown command instead of failing silently", async () => {
    const { bridge, replies } = harness();
    await bridge.start();

    await bridge.answer({ call_id: "mcp-4", command: "rm -rf", args: {} });
    expect(replies[0].ok).toBe(false);
    expect(JSON.parse(replies[0].payload)).toMatchObject({ code: "UNKNOWN_COMMAND" });
  });

  it("answers calls that arrive as events", async () => {
    const { bridge, replies, emit } = harness();
    await bridge.start();

    emit({ call_id: "mcp-5", command: "document list", args: {} });
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(replies[0]).toMatchObject({ call_id: "mcp-5", ok: true });
  });
});
