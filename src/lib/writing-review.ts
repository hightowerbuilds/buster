import { createStore } from "solid-js/store";
import type { EditorEngine } from "../editor/engine";
import { orderPositions } from "../editor/engine";
import { captureSelection, snapshotSchema, type SelectionTarget } from "./selection-commands";
import { CommandFailure, type FeatureCommands, type CommandSchema } from "./feature-commands";
import type { PaneWorkspace } from "./writing-panes";

export type WritingProvider = "ollama" | "anthropic" | "openai";
export interface WritingRequest { requestId: string; provider: WritingProvider; model: string; instruction: string; text: string }
export interface WritingReview {
  id: string; tabId: string; kind: "lookup" | "ai"; target: SelectionTarget;
  status: "ready" | "running" | "completed" | "failed" | "canceled" | "applied";
  output: string; error: string; source: string; provider: string; model: string; instruction: string; resultTabId: string;
}
export interface WritingReviewDeps {
  workspace: () => PaneWorkspace;
  engine: (tabId: string) => EditorEngine | undefined;
  hasTab: (tabId: string) => boolean;
  openPanel: (id: string, kind: "lookup" | "ai", sourcePaneId: string) => string;
  createNote: (text: string, reviewTabId: string) => string;
  focusSource: (target: SelectionTarget) => void;
  closePanel: (tabId: string) => void;
  generate: (request: WritingRequest, onToken: (text: string) => void, signal: AbortSignal) => Promise<void>;
  lookup: (text: string) => Promise<{ definition: string | null; source: string }>;
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
  function start(target: SelectionTarget, kind: "lookup" | "ai") {
    const engine = sourceEngine(target);
    if (engine.hasMultiCursors()) fail("UNAVAILABLE", "Use a single selection for this action.");
    const current = captureSelection(target.paneId, target.tabId, engine);
    if (!deps.workspace().panes.some(p => p.id === target.paneId && p.tabId === target.tabId) || !current ||
      current.revision !== target.revision || current.text !== target.text ||
      current.range.anchor.line !== target.range.anchor.line || current.range.anchor.col !== target.range.anchor.col ||
      current.range.head.line !== target.range.head.line || current.range.head.col !== target.range.head.col)
      fail("STALE_SELECTION", "The selection changed. Select the passage again.");
    if (kind === "lookup" && (Array.from(target.text.trim()).length > 256 || /[\r\n]/.test(target.text.trim())))
      fail("INVALID_ARGUMENTS", "Look up a word or short phrase on one line (up to 256 characters).");
    if (new TextEncoder().encode(target.text).length > 32_768) fail("LIMIT_REACHED", "Select a shorter passage (up to 32 KiB).");
    const id = crypto.randomUUID();
    const captured = JSON.parse(JSON.stringify(target)) as SelectionTarget;
    setReviews(id, { id, tabId: "", kind, target: captured, status: "ready", output: "", error: "", source: "", provider: "", model: "", instruction: "", resultTabId: "" });
    try { setReviews(id, "tabId", deps.openPanel(id, kind, target.paneId)); }
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
  function generate(id: string, provider: WritingProvider, model: string, instruction: string) {
    const review = requireReview(id);
    if (review.kind !== "ai") fail("INVALID_ARGUMENTS", "This is a dictionary lookup.");
    if (review.status === "running") fail("BUSY", "Cancel the current request before starting another.");
    if (review.status === "applied") fail("UNAVAILABLE", "This result has already been used. Open a new review for another edit.");
    sourceEngine(review.target);
    if (!model.trim() || !instruction.trim()) fail("INVALID_ARGUMENTS", "Choose a model and enter an instruction.");
    if (new TextEncoder().encode(instruction).length > 4096) fail("LIMIT_REACHED", "Keep the instruction within 4 KiB.");
    const controller = new AbortController(); pending.set(id, controller);
    setReviews(id, { status: "running", output: "", error: "", provider, model: model.trim(), instruction });
    void deps.generate({ requestId: crypto.randomUUID(), provider, model: model.trim(), instruction, text: review.target.text }, token => {
      if (pending.get(id) !== controller || controller.signal.aborted) return;
      if (reviews[id].output.length + token.length > 65_536) {
        controller.abort(); pending.delete(id);
        setReviews(id, { status: "failed", error: "The response exceeded the output limit. Try a shorter instruction." }); return;
      }
      setReviews(id, "output", text => text + token);
    }, controller.signal).then(() => {
      if (pending.get(id) !== controller || controller.signal.aborted) return;
      setReviews(id, { status: reviews[id].output.trim() ? "completed" : "failed", error: reviews[id].output.trim() ? "" : "The model returned no text." });
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
    for (const id of Object.keys(reviews)) if (reviews[id].tabId && !deps.hasTab(reviews[id].tabId)) {
      cancel(id); setReviews(id, undefined!);
    }
  }
  function discard(id: string) {
    const tabId = requireReview(id).tabId;
    cancel(id); deps.closePanel(tabId); setReviews(id, undefined!);
    return { reviewId: id, discarded: true };
  }
  function dispose() { for (const controller of pending.values()) controller.abort(); pending.clear(); }
  return { reviews, start, generate, cancel, apply, returnToSource, stale, reconcile, discard, dispose };
}
export type WritingReviewService = ReturnType<typeof createWritingReview>;

export function registerWritingReviewCommands(service: FeatureCommands, review: WritingReviewService) {
  const string: CommandSchema = { type: "string", minLength: 1 };
  const obj = (properties: Record<string, CommandSchema>): CommandSchema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
  const id = obj({ reviewId: string });
  const result: CommandSchema = { type: "object", additionalProperties: true };
  const add = (name: string, description: string, inputSchema: CommandSchema, run: (args: any) => unknown, effect: "read" | "write" = "write") =>
    service.register({ name, description, inputSchema, outputSchema: result, run, effect, version: 1, examples: [name] });
  add("selection lookup", "Look up a captured word or phrase in local macOS dictionaries, beside the source note.", snapshotSchema, target => review.start(target, "lookup"));
  add("selection ai", "Open an AI review beside a captured selection. Does not send text until review generate is invoked.", snapshotSchema, target => review.start(target, "ai"));
  add("review generate", "Send only the captured passage and instruction to the explicitly chosen configured provider/model. Returns immediately; inspect review read for progress.",
    obj({ reviewId: string, provider: { type: "string", enum: ["ollama", "anthropic", "openai"] }, model: string, instruction: string }),
    args => review.generate(args.reviewId, args.provider, args.model, args.instruction));
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
