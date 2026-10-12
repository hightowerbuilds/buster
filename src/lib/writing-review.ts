import { createStore } from "solid-js/store";
import type { EditorEngine } from "../editor/engine";
import { orderPositions } from "../editor/engine";
import { captureSelection, snapshotSchema, type SelectionTarget } from "./selection-commands";
import { CommandFailure, type FeatureCommands, type CommandSchema } from "./feature-commands";
import { REPHRASE_INSTRUCTION, REPHRASE_MAX_CHARS, REPHRASE_SCHEMA, rephrasingsFrom } from "./rephrase";
import { SPELLING_INSTRUCTION, SPELLING_SCHEMA, markedSentence, sentenceAround, spellingFrom } from "./spelling";
import { AI_LADDERS, AI_PROVIDERS, isAiProvider, type AiProvider, type OneShotReply, type OneShotRequest } from "./ai-oneshot";

export interface WritingReview {
  id: string; tabId: string; kind: "lookup" | "ai"; target: SelectionTarget;
  status: "ready" | "running" | "completed" | "failed" | "canceled" | "applied";
  output: string; error: string; source: string; provider: string; model: string; instruction: string; resultTabId: string;
}
export interface WritingReviewDeps {
  engine: (tabId: string) => EditorEngine | undefined;
  hasTab: (tabId: string) => boolean;
  openPanel: (id: string, kind: "lookup" | "ai", sourceTabId: string) => string;
  createNote: (text: string, reviewTabId: string) => string;
  focusSource: (target: SelectionTarget) => void;
  closePanel: (tabId: string) => void;
  lookup: (text: string) => Promise<{ definition: string | null; source: string }>;
  /** One answer from the writer's AI CLI (Claude Code, Codex, or OpenCode) on their subscription. */
  oneShot: (request: OneShotRequest, signal: AbortSignal) => Promise<OneShotReply>;
}
const fail = (code: string, message: string): never => { throw new CommandFailure(code, message); };
export function createWritingReview(deps: WritingReviewDeps) {
  const [reviews, setReviews] = createStore<Record<string, WritingReview>>({});
  const pending = new Map<string, AbortController>();
  const requireReview = (id: string) => reviews[id] ?? fail("NOT_FOUND", "This review is no longer open.");
  function sourceEngine(target: SelectionTarget) {
    const engine = deps.hasTab(target.tabId) ? deps.engine(target.tabId) : undefined;
    if (!engine) return fail("NOT_FOUND", "The source note is no longer open.");
    const valid = [target.range.anchor, target.range.head].every(p => Number.isInteger(p.line) && Number.isInteger(p.col) && p.line >= 0 && p.line < engine.lineCount() && p.col >= 0 && p.col <= engine.getLine(p.line).length);
    if (!valid || engine.editSeq() !== target.revision || engine.getTextRange(target.range.anchor, target.range.head) !== target.text)
      return fail("STALE_SELECTION", "The source note changed. Return to it, select the passage again, and open a new review. You can still keep this result as a new note.");
    return engine;
  }
  function stale(id: string) {
    try { sourceEngine(requireReview(id).target); return false; } catch { return true; }
  }
  function validateTarget(target: SelectionTarget, kind: "lookup" | "ai") {
    const engine = sourceEngine(target);
    if (engine.hasMultiCursors()) fail("UNAVAILABLE", "Use a single selection for this action.");
    const current = captureSelection(target.tabId, engine);
    if (!current ||
      current.revision !== target.revision || current.text !== target.text ||
      current.range.anchor.line !== target.range.anchor.line || current.range.anchor.col !== target.range.anchor.col ||
      current.range.head.line !== target.range.head.line || current.range.head.col !== target.range.head.col)
      fail("STALE_SELECTION", "The selection changed. Select the passage again.");
    if (kind === "lookup" && (Array.from(target.text.trim()).length > 256 || /[\r\n]/.test(target.text.trim())))
      fail("INVALID_ARGUMENTS", "Look up a word or short phrase on one line (up to 256 characters).");
    if (new TextEncoder().encode(target.text).length > 32_768) fail("LIMIT_REACHED", "Select a shorter passage (up to 32 KiB).");
  }
  /** Look a captured word up in place, without opening a review tab. */
  async function define(target: SelectionTarget) {
    validateTarget(target, "lookup");
    const result = await deps.lookup(target.text);
    return { query: target.text.trim(), definition: result.definition, source: result.source };
  }
  /** A one-shot model request running in the background: Rephrase or Spelling. */
  interface AiJob {
    kind: "rephrase" | "spelling";
    status: "running" | "ready" | "failed" | "canceled";
    provider: AiProvider; rung: number; label: string; servedBy?: string; result?: Record<string, unknown>; error?: { code: string; message: string };
    controller: AbortController;
  }
  const jobs = new Map<string, AiJob>();
  /**
   * Start asking the writer's AI CLI, on their subscription, at `rung` of the
   * provider's ladder. Returns at once — the command queue must not wait on a
   * model — and runs in the background; `readJob` reports the result. A reply
   * `parse` rejects fails with UNUSABLE, so the caller can try the next rung.
   */
  function startJob(kind: AiJob["kind"], requestId: string, provider: AiProvider, rung: number,
    request: { system: string; text: string; schema: Record<string, unknown> }, parse: (output: unknown) => Record<string, unknown>) {
    if (!isAiProvider(provider)) fail("INVALID_ARGUMENTS", "This runs on Claude, Codex, or OpenCode.");
    const step = AI_LADDERS[provider][rung] ?? fail("INVALID_ARGUMENTS", `That provider has ${AI_LADDERS[provider].length} step(s).`);
    if (jobs.has(requestId)) fail("BUSY", "That request was already started.");
    // Keep a handful of finished results for late readers; drop the oldest.
    for (const [id, item] of jobs) if (jobs.size >= 16 && item.status !== "running") jobs.delete(id);
    const item: AiJob = { kind, status: "running", provider, rung, label: step.label, controller: new AbortController() };
    jobs.set(requestId, item);
    const settle = (update: Partial<AiJob>) => { if (item.status === "running") Object.assign(item, update); };
    void deps.oneShot({ requestId, provider, model: step.model, effort: step.effort, ...request }, item.controller.signal)
      .then(reply => {
        try { settle({ status: "ready", result: parse(reply.output), servedBy: reply.model ?? step.model ?? step.label }); }
        catch (error) { settle({ status: "failed", error: { code: "UNUSABLE", message: error instanceof Error ? error.message : String(error) } }); }
      })
      .catch(error => settle({ status: "failed", error: { code: "UNAVAILABLE", message: error instanceof Error ? error.message : String(error) } }));
    return { requestId, status: item.status, label: step.label };
  }
  function readJob(kind: AiJob["kind"], requestId: string) {
    const item = jobs.get(requestId);
    if (!item || item.kind !== kind) return fail("NOT_FOUND", `No ${kind} request with that ID is running or recent.`);
    const { controller: _controller, kind: _kind, result, ...state } = item;
    return { requestId, ...state, ...result };
  }
  function cancelJob(kind: AiJob["kind"], requestId: string) {
    const item = jobs.get(requestId);
    if (!item || item.kind !== kind || item.status !== "running") return { canceled: false };
    item.status = "canceled";
    item.controller.abort();
    return { canceled: true };
  }
  /** Three rephrasings of a captured passage, without opening a tab. Sends only the passage. */
  function rephrase(target: SelectionTarget, provider: AiProvider, rung: number, requestId: string) {
    validateTarget(target, "ai");
    if (!target.text.trim() || target.text.length > REPHRASE_MAX_CHARS)
      fail("INVALID_ARGUMENTS", `Rephrase works on up to ${REPHRASE_MAX_CHARS.toLocaleString()} characters of text.`);
    return startJob("rephrase", requestId, provider, rung, { system: REPHRASE_INSTRUCTION, text: target.text, schema: REPHRASE_SCHEMA },
      output => ({ options: rephrasingsFrom(output, target.text) }));
  }
  /**
   * Check one captured word, in its sentence, for spelling and grammar. Sends
   * only that sentence. Grammar fixes come back with a `range` in the same
   * revision, to apply with `selection set` then `selection replace`.
   */
  function spelling(target: SelectionTarget, provider: AiProvider, rung: number, requestId: string) {
    validateTarget(target, "ai");
    const word = target.text;
    if (!word.trim() || /\s/.test(word) || word.length > 64 || target.range.anchor.line !== target.range.head.line)
      fail("INVALID_ARGUMENTS", "Spelling checks one word at a time.");
    const [from, to] = orderPositions(target.range.anchor, target.range.head);
    const line = from.line;
    const context = sentenceAround(deps.engine(target.tabId)!.getLine(line), from.col, to.col);
    return startJob("spelling", requestId, provider, rung, { system: SPELLING_INSTRUCTION, text: markedSentence(context, word), schema: SPELLING_SCHEMA }, output => {
      const checked = spellingFrom(output, word, context);
      return {
        word, revision: target.revision, misspelled: checked.misspelled, suggestions: checked.suggestions,
        grammar: checked.grammar.map(({ at, ...issue }) => ({ ...issue,
          range: { anchor: { line, col: context.start + at }, head: { line, col: context.start + at + issue.excerpt.length } } })),
      };
    });
  }
  function start(target: SelectionTarget, kind: "lookup" | "ai") {
    validateTarget(target, kind);
    const id = crypto.randomUUID();
    const captured = JSON.parse(JSON.stringify(target)) as SelectionTarget;
    setReviews(id, { id, tabId: "", kind, target: captured, status: "ready", output: "", error: "", source: "", provider: "", model: "", instruction: "", resultTabId: "" });
    try { setReviews(id, "tabId", deps.openPanel(id, kind, target.tabId)); }
    catch (error) { setReviews(id, undefined!); throw error; }
    if (kind === "lookup") {
      const controller = new AbortController(); pending.set(id, controller); setReviews(id, "status", "running");
      void deps.lookup(target.text).then(result => {
        if (pending.get(id) !== controller || controller.signal.aborted) return;
        setReviews(id, { status: "completed", output: result.definition ?? "No definition found in your active dictionaries. Enable or download a dictionary in the macOS Dictionary app, or try a shorter word or phrase.", source: result.source });
      }).catch(error => {
        if (pending.get(id) === controller && !controller.signal.aborted) setReviews(id, { status: "failed", error: String(error instanceof Error ? error.message : error) });
      }).finally(() => { if (pending.get(id) === controller) pending.delete(id); });
    }
    return { reviewId: id, tabId: reviews[id].tabId };
  }
  /** Send the captured passage and instruction to the writer's AI CLI on their subscription. Returns at once. */
  function generate(id: string, provider: AiProvider, instruction: string) {
    const review = requireReview(id);
    if (review.kind !== "ai") fail("INVALID_ARGUMENTS", "This is a dictionary lookup.");
    if (review.status === "running") fail("BUSY", "Cancel the current request before starting another.");
    if (review.status === "applied") fail("UNAVAILABLE", "This result has already been used. Open a new review for another edit.");
    sourceEngine(review.target);
    if (!isAiProvider(provider)) fail("INVALID_ARGUMENTS", "AI review runs on Claude, Codex, or OpenCode.");
    if (!instruction.trim()) fail("INVALID_ARGUMENTS", "Enter an instruction.");
    if (new TextEncoder().encode(instruction).length > 4096) fail("LIMIT_REACHED", "Keep the instruction within 4 KiB.");
    const controller = new AbortController(); pending.set(id, controller);
    setReviews(id, { status: "running", output: "", error: "", provider, model: "", instruction });
    void deps.oneShot({ requestId: crypto.randomUUID(), provider, system: instruction, text: review.target.text }, controller.signal).then(reply => {
      if (pending.get(id) !== controller || controller.signal.aborted) return;
      const text = typeof reply.output === "string" ? reply.output.trim() : JSON.stringify(reply.output);
      if (text.length > 65_536) setReviews(id, { status: "failed", error: "The response exceeded the output limit. Try a shorter instruction." });
      else if (!text) setReviews(id, { status: "failed", error: "The model returned no text." });
      else setReviews(id, { status: "completed", output: text, error: "", model: reply.model ?? "" });
    }).catch(error => {
      if (pending.get(id) === controller && !controller.signal.aborted) setReviews(id, { status: "failed", error: String(error instanceof Error ? error.message : error) });
    }).finally(() => { if (pending.get(id) === controller) pending.delete(id); });
    return { reviewId: id, status: "running" };
  }
  function cancel(id: string) {
    const review = requireReview(id);
    if (review.status !== "running") return { reviewId: id, status: review.status };
    const controller = pending.get(id); pending.delete(id); controller?.abort();
    setReviews(id, { status: "canceled", error: "" });
    return { reviewId: id, status: "canceled" };
  }
  function apply(id: string, mode: "replace" | "insert-after" | "new-note") {
    const review = requireReview(id);
    if (review.kind !== "ai" || review.status !== "completed") fail("UNAVAILABLE", "Only a completed AI result can be used.");
    const text = review.output.replace(/\r\n?/g, "\n");
    let resultTabId = review.target.tabId;
    if (mode === "new-note") resultTabId = deps.createNote(text, review.tabId);
    else {
      const engine = sourceEngine(review.target);
      if (engine.hasMultiCursors()) fail("UNAVAILABLE", "Clear additional cursors before applying the result.");
      engine.setSelection(review.target.range.anchor, review.target.range.head);
      engine.beginUndoGroup();
      try {
        if (mode === "insert-after") {
          const [, end] = orderPositions(review.target.range.anchor, review.target.range.head);
          engine.setCursor(end); engine.insert("\n\n" + text);
        } else engine.insert(text);
      } finally { engine.endUndoGroup(); }
    }
    setReviews(id, { status: "applied", resultTabId });
    return { reviewId: id, tabId: resultTabId };
  }
  function returnToSource(id: string) {
    const review = requireReview(id);
    const engine = deps.hasTab(review.target.tabId) ? deps.engine(review.target.tabId) : undefined;
    if (!engine) fail("NOT_FOUND", "The source note is no longer open.");
    deps.focusSource(review.target);
    // A stale capture may be viewed but never used to reposition a changed note.
    if (!stale(id)) engine!.setSelection(review.target.range.anchor, review.target.range.head);
    return { tabId: review.target.tabId };
  }
  function reconcile() {
    for (const id of Object.keys(reviews)) {
      const review = reviews[id];
      if (review.tabId && !deps.hasTab(review.tabId)) {
        cancel(id); setReviews(id, undefined!);
      } else if (!deps.hasTab(review.target.tabId)) {
        // Keep completed output available as a new note, but stop orphaned work.
        cancel(id);
      }
    }
  }
  function discard(id: string) {
    const tabId = requireReview(id).tabId;
    cancel(id); deps.closePanel(tabId); setReviews(id, undefined!);
    return { reviewId: id, discarded: true };
  }
  function dispose() {
    for (const controller of pending.values()) controller.abort();
    for (const item of jobs.values()) item.controller.abort();
    pending.clear(); jobs.clear();
  }
  return { reviews, start, define, rephrase, spelling, readJob, cancelJob, generate, cancel, apply, returnToSource, stale, reconcile, discard, dispose };
}
export type WritingReviewService = ReturnType<typeof createWritingReview>;

export function registerWritingReviewCommands(service: FeatureCommands, review: WritingReviewService, dictionaryAvailable = true) {
  const string: CommandSchema = { type: "string", minLength: 1 };
  const obj = (properties: Record<string, CommandSchema>): CommandSchema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
  const id = obj({ reviewId: string });
  const result: CommandSchema = { type: "object", additionalProperties: true };
  const dictionaryCommands = new Set(["selection lookup", "selection define"]);
  const add = (name: string, description: string, inputSchema: CommandSchema, run: (args: any) => unknown, effect: "read" | "write" = "write") =>
    service.register({ name, description: dictionaryCommands.has(name) && !dictionaryAvailable ? "Unavailable on Linux: offline dictionary lookup is deferred from this release." : description, inputSchema, outputSchema: result, run, effect, version: 1, examples: [name], available: () => !dictionaryCommands.has(name) || dictionaryAvailable });
  add("selection lookup", "Look up a captured word or phrase in local macOS dictionaries in a review tab.", snapshotSchema, target => review.start(target, "lookup"));
  add("selection define", "Look up a captured word or phrase in local macOS dictionaries and return the definition without opening a tab. Text never leaves the machine.", snapshotSchema, target => review.define(target), "read");
  add("selection rephrase", "Start asking the writer's AI CLI (claude, codex, or opencode, on their subscription) for three rephrasings of a captured passage (up to 4,000 characters). Sends only the passage. Returns at once; poll selection rephrase read. Start at rung 0 (Claude Haiku 5.5, or Codex at low effort); on UNUSABLE, or when the writer wants stronger options, start again one rung up (Claude Sonnet 5.5 then Opus 5.5; Codex medium then high effort; OpenCode has one rung). Apply a chosen option with selection replace.",
    obj({ target: snapshotSchema, provider: { type: "string", enum: AI_PROVIDERS.map(entry => entry.id) }, rung: { type: "number" }, requestId: string }),
    args => review.rephrase(args.target, args.provider, args.rung, args.requestId), "read");
  add("selection rephrase read", "Read a rephrase request: status running, ready (with options and the model that served them), failed (with error code UNUSABLE or UNAVAILABLE), or canceled.",
    obj({ requestId: string }), args => review.readJob("rephrase", args.requestId), "read");
  add("selection rephrase cancel", "Stop a running rephrase request. The note is unchanged.", obj({ requestId: string }), args => review.cancelJob("rephrase", args.requestId), "read");
  add("selection spelling", "Start checking one captured word for spelling, and its sentence for grammar, with the writer's AI CLI (claude, codex, or opencode, on their subscription). Sends only that sentence, with the word marked. Returns at once; poll selection spelling read. Rungs climb as for selection rephrase. Apply a suggestion with selection replace on the word; apply a grammar fix with selection set on its range (in the returned revision), then selection replace.",
    obj({ target: snapshotSchema, provider: { type: "string", enum: AI_PROVIDERS.map(entry => entry.id) }, rung: { type: "number" }, requestId: string }),
    args => review.spelling(args.target, args.provider, args.rung, args.requestId), "read");
  add("selection spelling read", "Read a spelling request: status running, ready (with misspelled, suggestions best first, grammar issues each with excerpt, replacement, explanation and range, and the model that served them), failed (UNUSABLE or UNAVAILABLE), or canceled.",
    obj({ requestId: string }), args => review.readJob("spelling", args.requestId), "read");
  add("selection spelling cancel", "Stop a running spelling request. The note is unchanged.", obj({ requestId: string }), args => review.cancelJob("spelling", args.requestId), "read");
  add("selection ai", "Open an AI review tab for a captured selection. Does not send text until review generate is invoked.", snapshotSchema, target => review.start(target, "ai"));
  add("review generate", "Send only the captured passage and instruction to the writer's AI CLI (claude, codex, or opencode) on their subscription, using its default model. Returns immediately; inspect review read for progress.",
    obj({ reviewId: string, provider: { type: "string", enum: AI_PROVIDERS.map(entry => entry.id) }, instruction: string }),
    args => review.generate(args.reviewId, args.provider, args.instruction));
  add("review read", "Read a review's source, status, streamed result, errors, and whether its source is stale.", id, args => {
    const item = review.reviews[args.reviewId];
    if (!item) fail("NOT_FOUND", "This review is no longer open.");
    return { ...JSON.parse(JSON.stringify(item)), stale: review.stale(item.id) };
  }, "read");
  add("review cancel", "Cancel generation and ignore late output without changing the note.", id, args => review.cancel(args.reviewId));
  add("review discard", "Cancel any request and close its review tab, leaving the source note intact.", id, args => review.discard(args.reviewId));
  add("review apply", "Use a completed result once: replace captured selection, insert after it, or keep as a new unsaved note. Stale source edits are rejected.",
    obj({ reviewId: string, mode: { type: "string", enum: ["replace", "insert-after", "new-note"] } }), args => review.apply(args.reviewId, args.mode));
  add("review source", "Return to the captured source note; restore its range only if its revision still matches.", id, args => review.returnToSource(args.reviewId));
}
