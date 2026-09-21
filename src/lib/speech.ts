import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EditorEngine, Pos } from "../editor/engine";
import type { PaneWorkspace } from "./writing-panes";
import { captureSelection, snapshotSchema, type SelectionTarget } from "./selection-commands";
import { CommandFailure, emptyArgs, objectResult, type FeatureCommands, type CommandSchema } from "./feature-commands";

export interface SpeechVoice { id: string; name: string; language: string; quality: number }
export type SpeechStatus = "starting" | "speaking" | "paused" | "completed" | "stopped" | "failed";
export type SpeechAction = "pause" | "resume" | "stop";
export interface SpeechRequest { jobId: string; text: string; voiceId: string; rate: number; volume: number }
export interface SpeechEvent { jobId: string; state: Exclude<SpeechStatus, "starting">; start?: number; length?: number; error?: string }
export interface SpeechJob {
  id: string; target: SelectionTarget; voiceId: string; rate: number; volume: number;
  status: SpeechStatus; start: number; length: number; error: string;
}
export interface SpeechTransport {
  voices(): Promise<SpeechVoice[]>;
  start(request: SpeechRequest): Promise<void>;
  control(jobId: string, action: SpeechAction): Promise<void>;
  listen(receive: (event: SpeechEvent) => void): Promise<() => void>;
}
export const nativeSpeechTransport: SpeechTransport = {
  voices: () => invoke<SpeechVoice[]>("speech_voices"),
  start: request => invoke<void>("speech_start", { request }),
  control: (jobId, action) => invoke<void>("speech_control", { jobId, action }),
  listen: receive => listen<SpeechEvent>("speech-event", event => receive(event.payload)),
};
export interface SpeechDeps {
  workspace(): PaneWorkspace;
  engine(tabId: string): EditorEngine | undefined;
  hasTab(tabId: string): boolean;
  focusSource(target: SelectionTarget): void;
  transport: SpeechTransport;
}
const fail = (code: string, message: string): never => { throw new CommandFailure(code, message); };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const active = (status: SpeechStatus) => status === "starting" || status === "speaking" || status === "paused";
const copyTarget = (target: SelectionTarget): SelectionTarget => JSON.parse(JSON.stringify(target));
const samePos = (a: Pos, b: Pos) => a.line === b.line && a.col === b.col;
// Speech delegate offsets and editor columns are UTF-16. Never highlight half an emoji.
function boundary(text: string, offset: number) {
  return offset <= 0 || offset >= text.length || !(text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);
}

export function createSpeech(deps: SpeechDeps) {
  const [state, setState] = createStore<{
    voices: SpeechVoice[]; loading: boolean; error: string; visible: boolean;
    prepared: SelectionTarget | null; job: SpeechJob | null;
  }>({ voices: [], loading: false, error: "", visible: false, prepared: null, job: null });
  let disposed = false;
  let unlisten: (() => void) | undefined;
  let listener: Promise<void> | undefined;
  let voiceRequest: Promise<SpeechVoice[]> | undefined;
  let transition: { id: string; canceled: boolean; canceledFrom: SpeechStatus } | undefined;
  let controls: Promise<unknown> = Promise.resolve();
  const stopping = new Set<string>();
  const resuming = new Set<string>();
  const nativeTerminal = new Set<string>();

  function validate(target: SelectionTarget, current = false) {
    if (disposed) fail("UNAVAILABLE", "Speech controls are no longer available.");
    const engine = deps.hasTab(target.tabId) ? deps.engine(target.tabId) : undefined;
    if (!engine) return fail("NOT_FOUND", "The source note is no longer open.");
    if (!target.text.trim()) fail("INVALID_ARGUMENTS", "Select a passage containing text to read.");
    if (new TextEncoder().encode(target.text).length > 32_768) fail("LIMIT_REACHED", "Select a shorter passage (up to 32 KiB).");
    const valid = [target.range.anchor, target.range.head].every(p => Number.isInteger(p.line) && Number.isInteger(p.col) && p.line >= 0 && p.line < engine.lineCount() && p.col >= 0 && p.col <= engine.getLine(p.line).length && boundary(engine.getLine(p.line), p.col));
    if (!valid || engine.editSeq() !== target.revision || engine.getTextRange(target.range.anchor, target.range.head) !== target.text)
      fail("STALE_SELECTION", "The source note changed. Select the passage again before reading it.");
    if (current) {
      const captured = captureSelection(target.paneId, target.tabId, engine);
      if (!deps.workspace().panes.some(p => p.id === target.paneId && p.tabId === target.tabId) || !captured ||
        captured.revision !== target.revision || captured.text !== target.text || !samePos(captured.range.anchor, target.range.anchor) || !samePos(captured.range.head, target.range.head))
        fail("STALE_SELECTION", "The selection changed. Select the passage again.");
      if (engine.hasMultiCursors()) fail("UNAVAILABLE", "Use one selection for reading aloud.");
    }
    return engine;
  }
  function stale(target = state.job?.target ?? state.prepared) {
    if (!target) return false;
    try { validate(target); return false; } catch { return true; }
  }
  function receive(event: SpeechEvent) {
    const job = state.job;
    if (disposed || !job || event.jobId !== job.id) return;
    if (!["speaking", "paused", "completed", "stopped", "failed"].includes(event.state)) return;
    if (!active(event.state)) nativeTerminal.add(job.id);
    if (!active(job.status)) return;
    if (stopping.has(job.id) && (event.state === "speaking" || event.state === "paused")) return;
    if (job.status === "paused" && event.state === "speaking" && !resuming.has(job.id)) return;
    const update: Partial<SpeechJob> = { status: event.state };
    if (event.state === "completed" || event.state === "stopped") update.error = "";
    if (event.state === "failed") update.error = event.error || "macOS could not read this passage.";
    if (Number.isInteger(event.start) && Number.isInteger(event.length)) {
      const start = event.start!, length = event.length!;
      if (start >= job.start && length > 0 && start + length <= job.target.text.length && boundary(job.target.text, start) && boundary(job.target.text, start + length)) {
        update.start = start; update.length = length;
      }
    }
    setState("job", update);
  }
  async function ensureListener() {
    if (!listener) {
      listener = deps.transport.listen(receive).then(stop => {
        if (disposed) stop(); else unlisten = stop;
      }).catch(error => { listener = undefined; throw error; });
    }
    await listener;
    if (disposed) fail("UNAVAILABLE", "Speech controls are no longer available.");
  }
  function refreshVoices(): Promise<SpeechVoice[]> {
    if (disposed) return Promise.reject(new CommandFailure("UNAVAILABLE", "Speech controls are no longer available."));
    if (voiceRequest) return voiceRequest;
    setState({ loading: true, error: "" });
    voiceRequest = deps.transport.voices().then(voices => {
      if (!disposed) setState("voices", voices);
      return voices;
    }).catch(error => {
      if (!disposed) setState("error", message(error));
      throw error;
    }).finally(() => { voiceRequest = undefined; if (!disposed) setState("loading", false); });
    return voiceRequest;
  }
  function prepare(target: SelectionTarget) {
    validate(target, true);
    setState({ visible: true, prepared: copyTarget(target), error: "" });
    if (state.job && !active(state.job.status) && !transition) setState("job", null);
    if (!state.voices.length) void refreshVoices().catch(() => {});
    return { tabId: target.tabId, ready: true };
  }
  function requireJob(jobId: string) {
    if (!state.job || state.job.id !== jobId) return fail("NOT_FOUND", "This speech job is no longer current.");
    return state.job;
  }
  function read(target: SelectionTarget, voiceId: string, rate: number, volume: number) {
    validate(target);
    if (!voiceId.trim() || !Number.isFinite(rate) || rate < 0.1 || rate > 1 || !Number.isFinite(volume) || volume < 0 || volume > 1)
      fail("INVALID_ARGUMENTS", "Choose an installed voice, rate between 0.1 and 1, and volume between 0 and 1.");
    if (transition || (state.job && active(state.job.status))) fail("BUSY", "Stop the current passage before starting another.");
    const id = crypto.randomUUID();
    const operation = { id, canceled: false, canceledFrom: "starting" as SpeechStatus };
    nativeTerminal.clear();
    transition = operation;
    const captured = copyTarget(target);
    setState({ visible: true, error: "", prepared: captured, job: { id, target: captured, voiceId, rate, volume, status: "starting", start: 0, length: 0, error: "" } });
    let accepted = false;
    void (async () => {
      try {
        await controls.catch(() => {});
        if (operation.canceled || disposed) return { jobId: id, status: "stopped" as SpeechStatus };
        await ensureListener();
        if (operation.canceled || disposed) return { jobId: id, status: "stopped" as SpeechStatus };
        validate(captured); // A focus change is fine; a changed or closed source is not.
        await deps.transport.start({ jobId: id, text: captured.text, voiceId, rate, volume });
        accepted = true;
        if ((operation.canceled || disposed) && !nativeTerminal.has(id)) {
          await deps.transport.control(id, "stop");
        }
        return { jobId: id, status: state.job?.id === id ? state.job.status : "stopped" };
      } catch (error) {
        if (operation.canceled && (!accepted || nativeTerminal.has(id))) return;
        if (!disposed && state.job?.id === id) {
          // Failed stop must remain controllable because the native utterance may still be audible.
          setState("job", { status: accepted && operation.canceled ? operation.canceledFrom : "failed", error: message(error) });
          setState("error", message(error));
        }
        throw error;
      } finally {
        if (transition === operation) transition = undefined;
      }
    })().catch(() => {});
    return { jobId: id, status: "starting" as SpeechStatus };
  }
  function control(jobId: string, action: SpeechAction): Promise<{ jobId: string; status: SpeechStatus }> {
    const job = requireJob(jobId);
    if (disposed) return Promise.reject(new CommandFailure("UNAVAILABLE", "Speech controls are no longer available."));
    if (action === "stop" && transition?.id === jobId) {
      if (!transition.canceled) transition.canceledFrom = job.status;
      transition.canceled = true;
      setState("job", { status: "stopped", error: "" });
      return Promise.resolve({ jobId, status: "stopped" });
    }
    if (!active(job.status)) return Promise.resolve({ jobId, status: job.status });
    if (job.status === "starting" && action !== "stop") return Promise.reject(new CommandFailure("BUSY", "Wait until reading starts, or stop it."));
    if (action === "stop") stopping.add(jobId);
    const task = controls.catch(() => {}).then(async () => {
      try {
        const current = requireJob(jobId);
        if (!active(current.status)) return { jobId, status: current.status };
        if ((action === "pause" && current.status === "paused") || (action === "resume" && current.status === "speaking")) return { jobId, status: current.status };
        if (action === "resume") resuming.add(jobId);
        await deps.transport.control(jobId, action);
        if (state.job?.id === jobId && active(state.job.status)) {
          setState("job", { status: action === "stop" ? "stopped" : action === "pause" ? "paused" : "speaking", error: "" });
          setState("error", "");
        }
        return { jobId, status: requireJob(jobId).status };
      } catch (error) {
        if (state.job?.id === jobId && !active(state.job.status)) return { jobId, status: state.job.status };
        if (state.job?.id === jobId) setState("job", "error", message(error));
        throw error;
      } finally { stopping.delete(jobId); resuming.delete(jobId); }
    });
    controls = task;
    return task;
  }
  function source(jobId?: string) {
    const target = jobId ? requireJob(jobId).target : state.job && active(state.job.status) ? state.job.target : state.prepared ?? state.job?.target;
    if (!target || !deps.hasTab(target.tabId) || !deps.engine(target.tabId)) fail("NOT_FOUND", "The source note is no longer open.");
    deps.focusSource(target!); // Speech progress never changes the editor's cursor or selection.
    return { tabId: target!.tabId };
  }
  function hide() {
    if (state.job && active(state.job.status)) fail("BUSY", "Stop reading before closing speech controls.");
    setState("visible", false);
    return { visible: false };
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    unlisten?.(); unlisten = undefined;
    if (transition) transition.canceled = true;
    else if (state.job && active(state.job.status)) {
      const id = state.job.id;
      void controls.catch(() => {}).then(() => deps.transport.control(id, "stop")).catch(() => {});
    }
  }
  return { state, prepare, refreshVoices, read, control, source, stale, hide, dispose };
}
export type SpeechService = ReturnType<typeof createSpeech>;

export function registerSpeechCommands(commands: FeatureCommands, speech: SpeechService) {
  const string: CommandSchema = { type: "string", minLength: 1 };
  const obj = (properties: Record<string, CommandSchema>): CommandSchema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
  const job = obj({ jobId: string });
  const add = (name: string, description: string, inputSchema: CommandSchema, run: (args: any) => unknown, effect: "read" | "write" = "write") =>
    commands.register({ name, description, inputSchema, outputSchema: objectResult, run, effect, version: 1, examples: [name] });
  add("selection voice", "Open local macOS voice controls for a captured selection. Does not start audio.", snapshotSchema, target => speech.prepare(target));
  add("speech voices list", "List installed macOS voices without sending text or starting audio.", emptyArgs, async () => ({ voices: await speech.refreshVoices() }), "read");
  add("speech read", "Read only the captured, unchanged passage with an installed macOS voice. Rate is 0.1–1 and volume is 0–1. Returns a job immediately. Stop the current passage before starting another.",
    obj({ target: snapshotSchema, voiceId: string, rate: { type: "number" }, volume: { type: "number" } }), args => speech.read(args.target, args.voiceId, args.rate, args.volume));
  for (const action of ["pause", "resume", "stop"] as const)
    add(`speech ${action}`, `${action[0].toUpperCase() + action.slice(1)} a specific speech job; never retarget a newer passage.`, job, args => speech.control(args.jobId, action));
  add("speech status", "Read speech state, captured passage, progress, and whether the source has changed.", emptyArgs,
    () => ({ ...JSON.parse(JSON.stringify(speech.state)), stale: speech.stale() }), "read");
  add("speech source", "Focus a speech job's source note without changing its cursor or selection. With no jobId, focus the prepared passage or active reading.",
    { type: "object", properties: { jobId: string }, additionalProperties: false }, args => speech.source(args.jobId));
}
