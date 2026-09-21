import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateWriting, type WritingRequest } from "./writing-ai-transport";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
const request: WritingRequest = { requestId: "write-1", provider: "ollama", model: "test", instruction: "Rewrite", text: "selected" };
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const tick = () => Promise.resolve();

describe("writing AI transport", () => {
  let emit: (event: { payload: { requestId: string; token: string } }) => void;
  let stop: ReturnType<typeof vi.fn<() => void>>;
  beforeEach(() => {
    vi.clearAllMocks(); stop = vi.fn();
    mocks.listen.mockImplementation(async (_name, cb) => { emit = cb; return stop; });
    mocks.invoke.mockResolvedValue(undefined);
  });
  it("subscribes before sending, filters requests and flushes final queued text", async () => {
    const completion = deferred<string>(); const token = vi.fn();
    mocks.invoke.mockReturnValue(completion.promise);
    const run = generateWriting(request, token, new AbortController().signal);
    expect(mocks.invoke).not.toHaveBeenCalled(); await tick();
    expect(mocks.invoke).toHaveBeenCalledWith("writing_ai_generate", { request });
    emit({ payload: { requestId: "other", token: "ignored" } });
    emit({ payload: { requestId: request.requestId, token: "one " } });
    completion.resolve("one two"); await run;
    expect(token.mock.calls).toEqual([["one "], ["two"]]);
    expect(stop).toHaveBeenCalledOnce();
    emit({ payload: { requestId: request.requestId, token: "late" } });
    expect(token).toHaveBeenCalledTimes(2);
  });
  it("aborts immediately during listener setup, cleans the late listener and never sends text", async () => {
    const setup = deferred<() => void>(); mocks.listen.mockReturnValue(setup.promise);
    const controller = new AbortController();
    const run = generateWriting(request, vi.fn(), controller.signal);
    const rejected = expect(run).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await rejected;
    setup.resolve(stop); await tick();
    expect(stop).toHaveBeenCalledOnce(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("cancels only its native request and ignores late native responses", async () => {
    const completion = deferred<string>();
    mocks.invoke.mockImplementation((name) => name === "writing_ai_generate" ? completion.promise : Promise.resolve());
    const controller = new AbortController(); const token = vi.fn();
    const run = generateWriting(request, token, controller.signal); await tick();
    const rejected = expect(run).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await rejected;
    expect(mocks.invoke).toHaveBeenCalledWith("writing_ai_cancel", { requestId: "write-1" });
    completion.resolve("late"); await tick();
    expect(token).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledOnce();
  });
  it("cleans up on provider errors and does not retry a different provider", async () => {
    mocks.invoke.mockRejectedValue("API key is missing");
    await expect(generateWriting(request, vi.fn(), new AbortController().signal)).rejects.toThrow("API key is missing");
    expect(stop).toHaveBeenCalledOnce(); expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it("never sends a request whose signal was already aborted", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(generateWriting(request, vi.fn(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.listen).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("cleans up when a token consumer throws", async () => {
    const completion = deferred<string>(); mocks.invoke.mockImplementation((name) => name === "writing_ai_generate" ? completion.promise : Promise.resolve());
    const run = generateWriting(request, () => { throw new Error("consumer failed"); }, new AbortController().signal);
    await tick();
    emit({ payload: { requestId: request.requestId, token: "text" } });
    await expect(run).rejects.toThrow("consumer failed");
    expect(stop).toHaveBeenCalledOnce(); expect(mocks.invoke).toHaveBeenCalledWith("writing_ai_cancel", { requestId: "write-1" });
    completion.resolve("text");
  });
  it("times out an unresponsive bridge and releases its listener", async () => {
    vi.useFakeTimers();
    try {
      const completion = deferred<string>();
      mocks.invoke.mockImplementation((name) => name === "writing_ai_generate" ? completion.promise : Promise.resolve());
      const run = generateWriting(request, vi.fn(), new AbortController().signal);
      const rejected = expect(run).rejects.toThrow("timed out");
      await tick(); await vi.advanceTimersByTimeAsync(125_000); await rejected;
      expect(stop).toHaveBeenCalledOnce();
      expect(mocks.invoke).toHaveBeenCalledWith("writing_ai_cancel", { requestId: "write-1" });
      completion.resolve("late");
    } finally { vi.useRealTimers(); }
  });
  it("rejects a completed response inconsistent with its streamed prefix", async () => {
    const completion = deferred<string>(); mocks.invoke.mockReturnValue(completion.promise);
    const run = generateWriting(request, vi.fn(), new AbortController().signal); await tick();
    emit({ payload: { requestId: "write-1", token: "expected" } });
    completion.resolve("different");
    await expect(run).rejects.toThrow("did not match");
    expect(stop).toHaveBeenCalledOnce();
  });

});
