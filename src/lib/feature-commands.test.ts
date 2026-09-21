import { describe, expect, it, vi } from "vitest";
import { FeatureCommands, emptyArgs, objectResult } from "./feature-commands";

function fixture(run = vi.fn(() => ({ value: 1 }))) {
  const service = new FeatureCommands();
  service.register({ name: "test create", description: "Create a test object", version: 1,
    effect: "write", inputSchema: emptyArgs, outputSchema: objectResult,
    examples: ["test create"], run });
  return { service, run };
}

describe("feature command dispatcher", () => {
  it("shares handlers between text commands and structured AI requests", async () => {
    const { service, run } = fixture();
    const human = await service.executeLine("test create {}", "human-1");
    const ai = await service.dispatch({ requestId: "ai-1", command: "test create" }, "ai");
    expect(human).toMatchObject({ ok: true, data: { value: 1 } });
    expect(ai).toMatchObject({ ok: true, data: { value: 1 } });
    expect(run.mock.calls).toHaveLength(2);
    expect(service.history().map(entry => entry.caller)).toEqual(["user", "ai"]);
  });

  it("rejects unknown commands, malformed JSON, and unexpected arguments", async () => {
    const { service, run } = fixture();
    expect(await service.executeLine("shell run", "1")).toMatchObject({ ok: false, error: { code: "UNKNOWN_COMMAND" } });
    expect(await service.executeLine("test create {broken}", "2")).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(await service.executeLine('test create {"unexpected":true}', "3")).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(await service.dispatch({ requestId: "4", command: "test create", args: null as never }, "ai")).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(run).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent and completed retries without repeating side effects", async () => {
    const { service, run } = fixture();
    const request = { requestId: "repeat", command: "test create" };
    const [first, second] = await Promise.all([service.dispatch(request, "ai"), service.dispatch(request, "ai")]);
    expect(first).toEqual(second);
    expect(await service.dispatch(request, "ai")).toEqual(first);
    expect(run).toHaveBeenCalledOnce();
    expect(await service.dispatch({ ...request, args: { other: true } }, "ai")).toMatchObject({ ok: false, error: { code: "REQUEST_ID_CONFLICT" } });
  });

  it("preserves execution order across asynchronous operations", async () => {
    const service = new FeatureCommands();
    const order: string[] = [];
    let release!: () => void;
    service.register({ name: "work", description: "Queued work", version: 1, effect: "write",
      inputSchema: emptyArgs, outputSchema: objectResult, examples: ["work"],
      run: async () => { order.push("started"); await new Promise<void>(resolve => { release = resolve; }); order.push("finished"); return {}; } });
    const first = service.dispatch({ requestId: "1", command: "work" }, "user");
    const second = service.dispatch({ requestId: "2", command: "work" }, "ai");
    await Promise.resolve();
    expect(order).toEqual(["started"]);
    release();
    await first;
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["started", "finished", "started"]);
    release();
    await second;
  });

  it("returns availability and result errors instead of silent failures", async () => {
    const service = new FeatureCommands();
    const run = vi.fn(() => ({}));
    service.register({ name: "unavailable", description: "Not available", version: 1, effect: "read",
      inputSchema: emptyArgs, outputSchema: objectResult, examples: [], available: () => false, run });
    expect(service.describe()[0].available).toBe(false);
    expect(await service.executeLine("unavailable", "1")).toMatchObject({ ok: false, error: { code: "UNAVAILABLE" } });
    expect(run).not.toHaveBeenCalled();
    service.register({ name: "invalid", description: "Invalid output", version: 1, effect: "read",
      inputSchema: emptyArgs, outputSchema: { type: "string" }, examples: [], run });
    expect(await service.executeLine("invalid", "2")).toMatchObject({ ok: false, error: { code: "INVALID_RESULT" } });
  });

  it("keeps thrown details out of results and stores no payloads in history", async () => {
    const { service } = fixture(vi.fn(() => { throw new Error("secret provider token"); }));
    const result = await service.executeLine("test create", "1");
    expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(JSON.stringify([result, service.history()])).not.toContain("secret");
    expect(service.history()[0]).not.toHaveProperty("args");
    expect(service.history()[0]).not.toHaveProperty("data");
  });
});
