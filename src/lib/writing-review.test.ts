import { describe, expect, it, vi } from "vitest";
import { createEditorEngine } from "../editor/engine";
import { CommandFailure, FeatureCommands } from "./feature-commands";
import { captureSelection } from "./selection-commands";
import { createWritingReview, registerWritingReviewCommands } from "./writing-review";
import type { OneShotReply, OneShotRequest } from "./ai-oneshot";

const original = "A café 世界 passage. Private surrounding context.";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(dictionaryAvailable = true) {
  const engine = createEditorEngine(original);
  const other = createEditorEngine("Another note.");
  engine.setSelection({ line: 0, col: 2 }, { line: 0, col: 9 });
  const tabs = new Set(["draft", "other"]);
  const target = captureSelection("draft", engine)!;
  const lookup = vi.fn(async (_text: string): Promise<{ definition: string | null; source: string }> => ({ definition: "A coffeehouse.", source: "macOS Dictionary" }));
  const openPanel = vi.fn((id: string, _kind: "lookup" | "ai", _tabId: string) => { const tabId = `review_${id}`; tabs.add(tabId); return tabId; });
  const closePanel = vi.fn((tabId: string) => { tabs.delete(tabId); });
  const createNote = vi.fn((_text: string, _reviewTabId: string) => "new-note");
  const focusSource = vi.fn();
  // A fake AI CLI: `token` adds to the answer, which arrives whole when `task` resolves.
  const requests: Array<{ request: OneShotRequest; token: (text: string) => void; signal: AbortSignal; task: ReturnType<typeof deferred<void>> }> = [];
  const oneShot = vi.fn((request: OneShotRequest, signal: AbortSignal): Promise<OneShotReply> => {
    const task = deferred<void>(); let text = "";
    requests.push({ request, token: token => { text += token; }, signal, task });
    return task.promise.then(() => ({ output: text, model: null }));
  });
  const review = createWritingReview({ engine: id => id === "draft" ? engine : id === "other" ? other : undefined,
    hasTab: id => tabs.has(id), openPanel, closePanel, createNote, focusSource, lookup, oneShot });
  const commands = new FeatureCommands(); registerWritingReviewCommands(commands, review, dictionaryAvailable);
  const run = (command: string, args: object = target, requestId: string = crypto.randomUUID()) => commands.dispatch({ command, args: { ...args }, requestId }, "ai");
  async function completed(text = "Polished passage.") {
    const { reviewId } = review.start(target, "ai");
    review.generate(reviewId, "claude", "Polish this passage.");
    const request = requests[requests.length - 1]; request.token(text); request.task.resolve();
    await vi.waitFor(() => expect(review.reviews[reviewId].status).toBe("completed"));
    return reviewId;
  }
  return { engine, other, target, tabs, review, commands, run, completed, requests, lookup, oneShot, openPanel, closePanel, createNote, focusSource,

    closeSource: () => { tabs.delete("draft"); } };
}

describe("writing review", () => {
  it("opens without sending and sends only the captured passage on explicit generate after focus changes", async () => {
    const f = fixture();
    const { reviewId } = f.review.start(f.target, "ai");
    expect(f.oneShot).not.toHaveBeenCalled();
    expect(f.review.reviews[reviewId].status).toBe("ready");
     f.engine.clearSelection();
    f.review.generate(reviewId, "codex", "Rewrite plainly.");
    expect(f.requests[0].request).toEqual({ requestId: expect.any(String), provider: "codex", system: "Rewrite plainly.", text: "café 世界" });
    f.requests[0].token("Clear writing"); f.requests[0].task.resolve();
    await vi.waitFor(() => expect(f.review.reviews[reviewId].status).toBe("completed"));
    f.review.apply(reviewId, "replace");
    expect(f.engine.getText()).toBe("A Clear writing passage. Private surrounding context.");
    expect(f.other.getText()).toBe("Another note.");
  });

  it.each(["replace", "insert-after"] as const)("applies %s as one undo step isolated from later typing", async mode => {
    const f = fixture(); const id = await f.completed("First\r\nsecond");
    f.review.apply(id, mode);
    const expected = mode === "replace" ? "A First\nsecond passage. Private surrounding context." : "A café 世界\n\nFirst\nsecond passage. Private surrounding context.";
    expect(f.engine.getText()).toBe(expected);
    f.engine.insert("!"); f.engine.undo(); expect(f.engine.getText()).toBe(expected);
    f.engine.undo(); expect(f.engine.getText()).toBe(original);
    expect(f.engine.sel()).toEqual(f.target.range);
    expect(() => f.review.apply(id, mode)).toThrow(CommandFailure);
  });

  it("rejects edits to a stale source but can retain the result in a new note", async () => {
    const f = fixture(); const id = await f.completed();
    f.engine.insert("A changed passage"); const changed = f.engine.getText();
    for (const mode of ["replace", "insert-after"] as const) {
      expect(await f.run("review apply", { reviewId: id, mode })).toMatchObject({ ok: false, error: { code: "STALE_SELECTION" } });
    }
    expect(await f.run("review read", { reviewId: id })).toMatchObject({ ok: true, data: { stale: true, output: "Polished passage." } });
    expect(f.review.apply(id, "new-note")).toMatchObject({ tabId: "new-note" });
    expect(f.createNote).toHaveBeenCalledExactlyOnceWith("Polished passage.", f.review.reviews[id].tabId);
    expect(f.engine.getText()).toBe(changed);
  });

  it("never applies to a closed source, even if another note is focused", async () => {
    const f = fixture(); const id = await f.completed(); f.tabs.delete("draft");
    expect(await f.run("review apply", { reviewId: id, mode: "replace" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await f.run("review source", { reviewId: id })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(f.other.getText()).toBe("Another note.");
    expect(f.review.apply(id, "new-note")).toMatchObject({ tabId: "new-note" });
  });

  it("returns to a captured range only while its source revision is unchanged", async () => {
    const f = fixture(); const { reviewId } = f.review.start(f.target, "ai");
    f.engine.setCursor({ line: 0, col: 0 }); f.review.returnToSource(reviewId);
    expect(f.engine.sel()).toEqual(f.target.range);
    f.engine.insert("changed"); f.engine.setCursor({ line: 0, col: 1 });
    f.review.returnToSource(reviewId);
    expect(f.engine.cursor()).toEqual({ line: 0, col: 1 });
    expect(f.focusSource).toHaveBeenCalledTimes(2);
  });

  it("deduplicates opening, generation, and applying through shared command requests", async () => {
    const f = fixture();
    const [first, second] = await Promise.all([f.run("selection ai", f.target, "open"), f.run("selection ai", f.target, "open")]);
    expect(second).toEqual(first); expect(f.openPanel).toHaveBeenCalledOnce();
    if (!first.ok) throw new Error("Failed to open review");
    const { reviewId } = first.data as { reviewId: string };
    const args = { reviewId, provider: "claude", instruction: "Rewrite." };
    await Promise.all([f.run("review generate", args, "generate"), f.run("review generate", args, "generate")]);
    expect(f.oneShot).toHaveBeenCalledOnce();
    f.requests[0].token("Saved output"); f.requests[0].task.resolve();
    await vi.waitFor(() => expect(f.review.reviews[reviewId].status).toBe("completed"));
    const apply = { reviewId, mode: "new-note" };
    const [a, b] = await Promise.all([f.run("review apply", apply, "apply"), f.run("review apply", apply, "apply")]);
    expect(a.ok).toBe(true); expect(b).toEqual(a); expect(f.createNote).toHaveBeenCalledOnce();
  });

  it("cancels promptly through commands and ignores old output or errors after a retry starts", async () => {
    const f = fixture(); const { reviewId } = f.review.start(f.target, "ai");
    const args = { reviewId, provider: "claude", instruction: "Rewrite." };
    expect(await f.run("review generate", args)).toMatchObject({ ok: true, data: { status: "running" } });
    f.requests[0].token("Partial");
    expect(await f.run("review cancel", { reviewId })).toMatchObject({ ok: true, data: { status: "canceled" } });
    expect(f.requests[0].signal.aborted).toBe(true);
    expect(f.engine.getText()).toBe(original);
    await f.run("review generate", args);
    f.requests[0].token(" stale"); f.requests[0].task.reject(new Error("late failure"));
    f.requests[1].token("Fresh"); f.requests[1].task.resolve();
    await vi.waitFor(() => expect(f.review.reviews[reviewId].status).toBe("completed"));
    expect(f.review.reviews[reviewId]).toMatchObject({ output: "Fresh", error: "" });
  });

  it("closing a review tab cancels work and ignores late completion", async () => {
    const f = fixture(); const { reviewId, tabId } = f.review.start(f.target, "ai");
    f.review.generate(reviewId, "claude", "Rewrite.");
    f.tabs.delete(tabId); f.review.reconcile();
    expect(f.requests[0].signal.aborted).toBe(true); expect(f.review.reviews[reviewId]).toBeUndefined();
    f.requests[0].token("Late"); f.requests[0].task.resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(f.review.reviews[reviewId]).toBeUndefined(); expect(f.engine.getText()).toBe(original);
  });

  it("closing a source cancels generation and ignores late output while retaining the review", async () => {
    const f = fixture(); const { reviewId } = f.review.start(f.target, "ai");
    f.review.generate(reviewId, "claude", "Rewrite.");
    f.requests[0].token("Partial");
    f.closeSource(); f.review.reconcile();
    expect(f.requests[0].signal.aborted).toBe(true);
    f.requests[0].token(" late"); f.requests[0].task.resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(f.review.reviews[reviewId]).toMatchObject({ status: "canceled", output: "" });
    expect(f.other.getText()).toBe("Another note.");
  });

  it("keeps completed output after source-close reconciliation", async () => {
    const f = fixture(); const id = await f.completed();
    f.closeSource(); f.review.reconcile();
    expect(f.review.apply(id, "new-note")).toMatchObject({ tabId: "new-note" });
  });

  it("discard closes the review without changing the source or selection", async () => {
    const f = fixture(); const id = await f.completed(); const tabId = f.review.reviews[id].tabId;
    expect(await f.run("review discard", { reviewId: id })).toMatchObject({ ok: true, data: { discarded: true } });
    expect(f.closePanel).toHaveBeenCalledExactlyOnceWith(tabId);
    expect(f.review.reviews[id]).toBeUndefined();
    expect(captureSelection("draft", f.engine)).toEqual(f.target);
    expect(f.engine.getText()).toBe(original);
  });

  it("reports provider errors and empty results without allowing partial output to be applied", async () => {
    const f = fixture(); const { reviewId } = f.review.start(f.target, "ai");
    f.review.generate(reviewId, "claude", "Rewrite.");
    f.requests[0].token("Partial"); f.requests[0].task.reject(new Error("Provider unavailable"));
    await vi.waitFor(() => expect(f.review.reviews[reviewId].status).toBe("failed"));
    expect(f.review.reviews[reviewId].error).toBe("Provider unavailable");
    expect(await f.run("review apply", { reviewId, mode: "replace" })).toMatchObject({ ok: false, error: { code: "UNAVAILABLE" } });
    f.review.generate(reviewId, "claude", "Rewrite."); f.requests[1].task.resolve();
    await vi.waitFor(() => expect(f.review.reviews[reviewId].status).toBe("failed"));
    expect(f.review.reviews[reviewId].error).toMatch(/no text/);
    expect(f.engine.getText()).toBe(original);
  });

  it("rejects stale selections, closed source tabs, and failed panel creation without orphaned reviews", async () => {
    const f = fixture(); f.engine.clearSelection();
    expect(await f.run("selection ai")).toMatchObject({ ok: false, error: { code: "STALE_SELECTION" } });
    expect(f.openPanel).not.toHaveBeenCalled();
    const g = fixture(); g.closeSource();
    expect(await g.run("selection ai")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const h = fixture(); h.openPanel.mockImplementation(() => { throw new CommandFailure("LIMIT_REACHED", "Cannot open review"); });
    expect(await h.run("selection ai")).toMatchObject({ ok: false, error: { code: "LIMIT_REACHED" } });
    expect(Object.keys(h.review.reviews)).toEqual([]); expect(h.oneShot).not.toHaveBeenCalled();
  });

  it("looks up locally, handles missing definitions, and rejects AI apply on dictionary output", async () => {
    const f = fixture(); const { reviewId } = f.review.start(f.target, "lookup");
    await vi.waitFor(() => expect(f.review.reviews[reviewId].status).toBe("completed"));
    expect(f.lookup).toHaveBeenCalledExactlyOnceWith("café 世界");
    expect(f.oneShot).not.toHaveBeenCalled();
    expect(f.review.reviews[reviewId]).toMatchObject({ output: "A coffeehouse.", source: "macOS Dictionary" });
    expect(await f.run("review apply", { reviewId, mode: "replace" })).toMatchObject({ ok: false, error: { code: "UNAVAILABLE" } });
    const g = fixture(); g.lookup.mockResolvedValue({ definition: null, source: "macOS Dictionary" });
    const missing = g.review.start(g.target, "lookup").reviewId;
    await vi.waitFor(() => expect(g.review.reviews[missing].status).toBe("completed"));
    expect(g.review.reviews[missing].output).toMatch(/No definition found/);
  });

  it("ignores a dictionary result when discarded during lookup", async () => {
    const f = fixture(); const task = deferred<{ definition: string; source: string }>();
    f.lookup.mockImplementation(() => task.promise);
    const { reviewId } = f.review.start(f.target, "lookup"); f.review.discard(reviewId);
    task.resolve({ definition: "Late definition", source: "macOS Dictionary" });
    await Promise.resolve(); await Promise.resolve();
    expect(f.review.reviews[reviewId]).toBeUndefined(); expect(f.engine.getText()).toBe(original);
  });
});

it("marks Linux dictionary lookup unavailable without disabling AI review", async () => {
 const f = fixture(false);
 expect(f.commands.describe("selection lookup")[0].available).toBe(false);
 expect((await f.run("selection lookup")).ok).toBe(false);
 expect(f.lookup).not.toHaveBeenCalled();
 expect((await f.run("selection ai")).ok).toBe(true); f.review.dispose();
});

describe("selection define", () => {
  it("returns the definition in place without opening a review tab", async () => {
    const f = fixture();
    const result = await f.run("selection define");
    expect(result).toMatchObject({ ok: true, data: { query: "café 世界", definition: "A coffeehouse.", source: "macOS Dictionary" } });
    expect(f.lookup).toHaveBeenCalledWith("café 世界");
    expect(f.openPanel).not.toHaveBeenCalled();
    expect(f.engine.getText()).toBe(original);
  });

  it("rejects a changed selection before looking anything up", async () => {
    const f = fixture();
    f.engine.setCursor({ line: 0, col: 0 }); f.engine.insert("Now ");
    const result = await f.run("selection define");
    expect(result).toMatchObject({ ok: false, error: { code: "STALE_SELECTION" } });
    expect(f.lookup).not.toHaveBeenCalled();
  });

  it("is unavailable where offline dictionaries are", async () => {
    const f = fixture(false);
    expect(f.commands.describe("selection define")[0].available).toBe(false);
    expect((await f.run("selection define")).ok).toBe(false);
    expect(f.lookup).not.toHaveBeenCalled();
  });
});

describe("selection rephrase", () => {
  const settled = async (f: ReturnType<typeof fixture>, requestId: string) => {
    let read: Awaited<ReturnType<typeof f.run>> | undefined;
    await vi.waitFor(async () => {
      read = await f.run("selection rephrase read", { requestId });
      expect(read).toMatchObject({ ok: true, data: { status: expect.not.stringMatching(/^running$/) } });
    });
    return read!;
  };

  it("starts at once and reads back Claude's structured rephrasings, without opening a tab", async () => {
    const f = fixture();
    f.oneShot.mockResolvedValueOnce({ output: { rephrasings: ["coffee world", "a café, a world", "café 世界"] }, model: "claude-haiku-5-5" });
    expect(await f.run("selection rephrase", { target: f.target, provider: "claude", rung: 0, requestId: "r1" }))
      .toMatchObject({ ok: true, data: { requestId: "r1", status: "running" } });
    expect(await settled(f, "r1")).toMatchObject({ ok: true, data: { status: "ready", options: ["coffee world", "a café, a world"], servedBy: "claude-haiku-5-5" } });
    expect(f.oneShot.mock.calls[0][0]).toMatchObject({ requestId: "r1", provider: "claude", model: "claude-haiku-5-5", effort: "low", text: "café 世界" });
    expect(f.openPanel).not.toHaveBeenCalled();
    expect(f.engine.getText()).toBe(original);
  });

  it("does not hold the command queue while Claude answers", async () => {
    const f = fixture();
    f.oneShot.mockImplementationOnce(() => new Promise(() => {}));
    await f.run("selection rephrase", { target: f.target, provider: "claude", rung: 0, requestId: "r1" });
    expect(await f.run("selection rephrase read", { requestId: "r1" })).toMatchObject({ ok: true, data: { status: "running" } });
  });

  it("marks an unusable reply for escalation and keeps transport failures distinct", async () => {
    const f = fixture();
    f.oneShot.mockResolvedValueOnce({ output: { rephrasings: ["café 世界"] }, model: "claude-haiku-5-5" });
    await f.run("selection rephrase", { target: f.target, provider: "claude", rung: 0, requestId: "r1" });
    expect(await settled(f, "r1")).toMatchObject({ ok: true, data: { status: "failed", error: { code: "UNUSABLE" } } });
    f.oneShot.mockRejectedValueOnce(new Error("Claude Code is not installed."));
    await f.run("selection rephrase", { target: f.target, provider: "claude", rung: 1, requestId: "r2" });
    expect(await settled(f, "r2")).toMatchObject({ ok: true, data: { status: "failed", error: { code: "UNAVAILABLE", message: "Claude Code is not installed." } } });
    expect(await f.run("selection rephrase", { target: f.target, provider: "ollama", rung: 0, requestId: "r3" })).toMatchObject({ ok: false });
  });

  it("climbs Codex by effort and runs OpenCode on its default model", async () => {
    const f = fixture();
    f.oneShot.mockResolvedValue({ output: { rephrasings: ["coffee world"] }, model: null });
    await f.run("selection rephrase", { target: f.target, provider: "codex", rung: 2, requestId: "c" });
    expect(f.oneShot.mock.calls[0][0]).toMatchObject({ provider: "codex", effort: "high" });
    expect(f.oneShot.mock.calls[0][0].model).toBeUndefined();
    expect(await settled(f, "c")).toMatchObject({ ok: true, data: { status: "ready", servedBy: "Codex · high effort" } });
    expect(await f.run("selection rephrase", { target: f.target, provider: "opencode", rung: 1, requestId: "o" })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
  });

  it("cancels a running request", async () => {
    const f = fixture();
    let aborted = false;
    f.oneShot.mockImplementationOnce((_request, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => { aborted = true; reject(new Error("Cancelled")); })));
    await f.run("selection rephrase", { target: f.target, provider: "claude", rung: 0, requestId: "r1" });
    expect(await f.run("selection rephrase cancel", { requestId: "r1" })).toMatchObject({ ok: true, data: { canceled: true } });
    expect(aborted).toBe(true);
    expect(await settled(f, "r1")).toMatchObject({ ok: true, data: { status: "canceled" } });
  });
});
