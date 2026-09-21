import { describe, expect, it, vi } from "vitest";
import { createEditorEngine } from "../editor/engine";
import { FeatureCommands } from "./feature-commands";
import { captureSelection } from "./selection-commands";
import { newPaneWorkspace, showTabInPane } from "./writing-panes";
import { createSpeech, registerSpeechCommands, type SpeechEvent, type SpeechTransport } from "./speech";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const engine = createEditorEngine("Private prefix. Hello 🌎 reader! Private suffix.");
  engine.setSelection({ line: 0, col: 16 }, { line: 0, col: 32 });
  let workspace = newPaneWorkspace("note");
  const target = captureSelection(workspace.activePaneId, "note", engine)!;
  const tabs = new Set(["note"]);
  let receive!: (event: SpeechEvent) => void;
  const unlisten = vi.fn();
  const transport = {
    voices: vi.fn(async () => [{ id: "voice", name: "Local voice", language: "en-US", quality: 1 }]),
    start: vi.fn<SpeechTransport["start"]>(async request => { receive({ jobId: request.jobId, state: "speaking" }); }),
    control: vi.fn<SpeechTransport["control"]>(async () => {}),
    listen: vi.fn<SpeechTransport["listen"]>(async handler => { receive = handler; return unlisten; }),
  };
  const focusSource = vi.fn();
  const speech = createSpeech({ workspace: () => workspace, engine: id => id === "note" ? engine : undefined,
    hasTab: id => tabs.has(id), focusSource, transport });
  const commands = new FeatureCommands(); registerSpeechCommands(commands, speech);
  const run = (command: string, args: object = {}, requestId = crypto.randomUUID()) => commands.dispatch({ command, args: { ...args }, requestId }, "ai");
  const start = () => speech.read(target, "voice", 0.5, 1);
  const speaking = async () => { const result = start(); await vi.waitFor(() => expect(speech.state.job?.status).toBe("speaking")); return result.jobId; };
  return { engine, target, tabs, speech, transport, focusSource, unlisten, commands, run, start, speaking,
    event: (event: SpeechEvent) => receive(event), focusElsewhere: () => { workspace = showTabInPane(workspace, "other"); } };
}

describe("local selection speech", () => {
  it("prepares without speaking, lists installed voices, and captures immutable text", async () => {
    const f = fixture();
    expect(f.speech.prepare(f.target)).toEqual({ tabId: "note", ready: true });
    await vi.waitFor(() => expect(f.speech.state.voices).toHaveLength(1));
    expect(f.transport.start).not.toHaveBeenCalled();
    expect(f.transport.listen).not.toHaveBeenCalled();
    const original = f.target.text;
    f.target.text = "tampered";
    expect(f.speech.state.prepared?.text).toBe(original);
  });

  it("sends only the capture after focus and selection move; source navigation never moves the caret", async () => {
    const f = fixture(); f.speech.prepare(f.target);
    f.focusElsewhere(); f.engine.setCursor({ line: 0, col: 0 });
    const id = await f.speaking();
    expect(f.transport.start).toHaveBeenCalledExactlyOnceWith({ jobId: id, text: f.target.text, voiceId: "voice", rate: 0.5, volume: 1 });
    expect(f.transport.listen.mock.invocationCallOrder[0]).toBeLessThan(f.transport.start.mock.invocationCallOrder[0]);
    f.speech.source(id);
    expect(f.focusSource).toHaveBeenCalledExactlyOnceWith(f.target);
    expect(f.engine.cursor()).toEqual({ line: 0, col: 0 });
    expect(f.engine.sel()).toBeNull();
  });

  it("requires an exact live selection for prepare, but keeps playing capture separate from the next one", async () => {
    const f = fixture(); const id = await f.speaking();
    f.engine.setSelection({ line: 0, col: 0 }, { line: 0, col: 7 });
    expect(() => f.speech.prepare(f.target)).toThrow("selection changed");
    const next = captureSelection(f.target.paneId, "note", f.engine)!;
    f.speech.prepare(next);
    expect(f.speech.state.prepared?.text).toBe("Private");
    expect(f.speech.state.job?.target.text).toBe(f.target.text);
    f.speech.source(); expect(f.focusSource).toHaveBeenLastCalledWith(f.target);
    await f.speech.control(id, "stop");
    f.speech.source(); expect(f.focusSource).toHaveBeenLastCalledWith(next);
    f.speech.prepare(next); expect(f.speech.state.job).toBeNull();
  });

  it("rejects stale or closed source after listener startup before sending audio", async () => {
    for (const close of [false, true]) {
      const f = fixture(); const listening = deferred<() => void>();
      f.transport.listen.mockReturnValue(listening.promise);
      f.start(); await vi.waitFor(() => expect(f.transport.listen).toHaveBeenCalled());
      if (close) f.tabs.delete("note"); else f.engine.insert("changed");
      listening.resolve(f.unlisten);
      await vi.waitFor(() => expect(f.speech.state.job?.status).toBe("failed"));
      expect(f.transport.start).not.toHaveBeenCalled();
      expect(f.speech.stale()).toBe(true);
    }
  });

  it("rejects empty, oversized, invalid voice options and split-surrogate captures", () => {
    const f = fixture();
    expect(() => f.speech.read(f.target, "", 0.5, 1)).toThrow("installed voice");
    for (const rate of [NaN, Infinity, 0, 1.1]) expect(() => f.speech.read(f.target, "voice", rate, 1)).toThrow();
    for (const volume of [NaN, -0.1, 1.1]) expect(() => f.speech.read(f.target, "voice", 0.5, volume)).toThrow();
    expect(() => f.speech.read({ ...f.target, text: " " }, "voice", 0.5, 1)).toThrow("containing text");
    expect(() => f.speech.read({ ...f.target, text: "a".repeat(32769) }, "voice", 0.5, 1)).toThrow("32 KiB");
    f.engine.setSelection({ line: 0, col: 22 }, { line: 0, col: 23 });
    const split = captureSelection(f.target.paneId, "note", f.engine)!;
    expect(() => f.speech.read(split, "voice", 0.5, 1)).toThrow("source note changed");
    expect(f.transport.start).not.toHaveBeenCalled();
  });

  it("pauses/resumes/stops only the intended job and ignores late terminal callbacks", async () => {
    const f = fixture(); const id = await f.speaking();
    await f.speech.control(id, "pause"); expect(f.speech.state.job?.status).toBe("paused");
    f.event({ jobId: id, state: "speaking", start: 0, length: 5 });
    expect(f.speech.state.job?.status).toBe("paused");
    await f.speech.control(id, "resume"); expect(f.speech.state.job?.status).toBe("speaking");
    await f.speech.control(id, "stop"); expect(f.speech.state.job?.status).toBe("stopped");
    for (const state of ["speaking", "paused", "completed", "failed"] as const) f.event({ jobId: id, state, error: "late" });
    expect(f.speech.state.job?.status).toBe("stopped");
    expect(() => f.speech.control("other", "stop")).toThrow("no longer current");
    expect(f.transport.control.mock.calls).toEqual([[id, "pause"], [id, "resume"], [id, "stop"]]);
  });

  it("validates UTF-16 progress, never highlights half a surrogate or regresses, and never changes the source selection", async () => {
    const f = fixture(); const id = await f.speaking();
    expect(f.target.text.indexOf("🌎")).toBe(6);
    f.event({ jobId: id, state: "speaking", start: 6, length: 2 });
    expect(f.speech.state.job).toMatchObject({ start: 6, length: 2 });
    for (const [start, length] of [[-1, 1], [0, 999], [7, 1], [6, 1], [8.5, 1], [0, 5], [8, -1]]) {
      f.event({ jobId: id, state: "speaking", start, length });
      expect(f.speech.state.job).toMatchObject({ start: 6, length: 2 });
    }
    expect(f.engine.sel()).toEqual(f.target.range);
    f.event({ jobId: id, state: "completed" });
    f.event({ jobId: id, state: "speaking", start: 9, length: 3 });
    expect(f.speech.state.job).toMatchObject({ status: "completed", start: 6, length: 2 });
  });

  it("returns startup immediately so shared commands can stop before listener readiness", async () => {
    const f = fixture(); const listener = deferred<() => void>(); f.transport.listen.mockReturnValue(listener.promise);
    const result = await f.run("speech read", { target: f.target, voiceId: "voice", rate: 0.5, volume: 1 });
    expect(result).toMatchObject({ ok: true, data: { status: "starting" } });
    const id = f.speech.state.job!.id;
    expect(await f.run("speech stop", { jobId: id })).toMatchObject({ ok: true, data: { status: "stopped" } });
    listener.resolve(f.unlisten); await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.transport.start).not.toHaveBeenCalled();
    expect(f.speech.state.job?.status).toBe("stopped");
  });

  it("stops an in-flight native start as soon as it returns and blocks late events", async () => {
    const f = fixture(); const starting = deferred<void>(); f.transport.start.mockReturnValue(starting.promise);
    const { jobId } = f.start(); await vi.waitFor(() => expect(f.transport.start).toHaveBeenCalled());
    await f.speech.control(jobId, "stop"); f.event({ jobId, state: "speaking" });
    expect(f.speech.state.job?.status).toBe("stopped");
    starting.resolve(); await vi.waitFor(() => expect(f.transport.control).toHaveBeenCalledExactlyOnceWith(jobId, "stop"));
    expect(f.speech.state.job?.status).toBe("stopped");
  });

  it("surfaces startup errors and keeps failed pause/stop retryable", async () => {
    const f = fixture(); f.transport.start.mockRejectedValueOnce(new Error("Voice unavailable"));
    f.start(); await vi.waitFor(() => expect(f.speech.state.job).toMatchObject({ status: "failed", error: "Voice unavailable" }));
    const id = await f.speaking();
    f.transport.control.mockRejectedValueOnce(new Error("Pause failed"));
    await expect(f.speech.control(id, "pause")).rejects.toThrow("Pause failed");
    expect(f.speech.state.job).toMatchObject({ status: "speaking", error: "Pause failed" });
    f.transport.control.mockRejectedValueOnce(new Error("Stop failed"));
    await expect(f.speech.control(id, "stop")).rejects.toThrow("Stop failed");
    expect(f.speech.state.job?.status).toBe("speaking");
    await f.speech.control(id, "stop"); expect(f.speech.state.job).toMatchObject({ status: "stopped", error: "" });
  });

  it("does not resurrect a canceled job when its pending native start rejects", async () => {
    const f = fixture(); const starting = deferred<void>(); f.transport.start.mockReturnValue(starting.promise);
    const { jobId } = f.start(); await vi.waitFor(() => expect(f.transport.start).toHaveBeenCalled());
    await f.speech.control(jobId, "stop"); starting.reject(new Error("Voice not installed"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.speech.state.job).toMatchObject({ status: "stopped", error: "" });
    expect(f.transport.control).not.toHaveBeenCalled();
  });

  it("does not resurrect a short job that completed before or during cancellation cleanup", async () => {
    for (const duringCleanup of [false, true]) {
      const f = fixture(); const starting = deferred<void>(); const stopping = deferred<void>();
      f.transport.start.mockReturnValue(starting.promise); f.transport.control.mockReturnValue(stopping.promise);
      const { jobId } = f.start(); await vi.waitFor(() => expect(f.transport.start).toHaveBeenCalled());
      await f.speech.control(jobId, "stop");
      if (!duringCleanup) f.event({ jobId, state: "completed" });
      starting.resolve();
      if (duringCleanup) {
        await vi.waitFor(() => expect(f.transport.control).toHaveBeenCalled());
        f.event({ jobId, state: "completed" }); stopping.reject(new Error("No active speech"));
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(f.speech.state.job).toMatchObject({ status: "stopped", error: "" });
      if (!duringCleanup) expect(f.transport.control).not.toHaveBeenCalled();
    }
  });

  it("retains Stop when cancellation cleanup fails for an accepted but not yet speaking job", async () => {
    const f = fixture(); const starting = deferred<void>(); f.transport.start.mockReturnValue(starting.promise);
    const { jobId } = f.start(); await vi.waitFor(() => expect(f.transport.start).toHaveBeenCalled());
    await f.speech.control(jobId, "stop");
    f.transport.control.mockRejectedValueOnce(new Error("Cannot stop yet")); starting.resolve();
    await vi.waitFor(() => expect(f.speech.state.job).toMatchObject({ status: "starting", error: "Cannot stop yet" }));
    await f.speech.control(jobId, "stop"); expect(f.speech.state.job?.status).toBe("stopped");
  });

  it("requires Stop before another read and ignores callbacks from the old job", async () => {
    const f = fixture(); const first = await f.speaking();
    expect(() => f.start()).toThrow("Stop the current passage");
    await f.speech.control(first, "stop");
    const second = await f.speaking();
    f.event({ jobId: first, state: "completed" });
    expect(f.speech.state.job).toMatchObject({ id: second, status: "speaking" });
    expect(f.transport.start).toHaveBeenCalledTimes(2);
    expect(() => f.speech.control(first, "stop")).toThrow("no longer current");
  });

  it("keeps an accepted request starting until native didStart, with Stop still available", async () => {
    const f = fixture(); f.transport.start.mockResolvedValueOnce();
    const { jobId } = f.start();
    await vi.waitFor(() => expect(f.transport.start).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.speech.state.job?.status).toBe("starting");
    await expect(f.speech.control(jobId, "pause")).rejects.toThrow("Wait until reading");
    await f.speech.control(jobId, "stop");
    expect(f.transport.control).toHaveBeenCalledExactlyOnceWith(jobId, "stop");
    f.event({ jobId, state: "speaking" });
    expect(f.speech.state.job?.status).toBe("stopped");
  });

  it.each(["user", "ai"] as const)("deduplicates %s dispatcher retries without replaying audio", async caller => {
    const f = fixture(); const args = { target: f.target, voiceId: "voice", rate: 0.5, volume: 1 };
    const request = { requestId: "once", command: "speech read", args };
    const [a, b] = await Promise.all([f.commands.dispatch(request, caller), f.commands.dispatch(request, caller)]);
    expect(a).toEqual(b);
    await vi.waitFor(() => expect(f.transport.start).toHaveBeenCalledTimes(1));
    expect(await f.run("speech voices list")).toMatchObject({ ok: true, data: { voices: [{ id: "voice" }] } });
    expect(await f.run("speech status")).toMatchObject({ ok: true, data: { stale: false, job: { status: "speaking" } } });
    expect(f.commands.describe()).toHaveLength(8);
  });

  it("handles listener and voice discovery failures, allowing retry", async () => {
    const f = fixture(); f.transport.voices.mockRejectedValueOnce(new Error("No voice access")); f.speech.prepare(f.target);
    await vi.waitFor(() => expect(f.speech.state).toMatchObject({ loading: false, error: "No voice access" }));
    await f.speech.refreshVoices(); expect(f.speech.state.error).toBe("");
    f.transport.listen.mockRejectedValueOnce(new Error("Cannot listen")); f.start();
    await vi.waitFor(() => expect(f.speech.state.job?.status).toBe("failed"));
    expect(f.transport.start).not.toHaveBeenCalled();
    await f.speaking(); expect(f.transport.listen).toHaveBeenCalledTimes(2);
  });

  it("disposes a delayed listener and cancels startup without sending audio", async () => {
    const f = fixture(); const listener = deferred<() => void>(); f.transport.listen.mockReturnValue(listener.promise);
    f.start(); await vi.waitFor(() => expect(f.transport.listen).toHaveBeenCalled());
    f.speech.dispose(); listener.resolve(f.unlisten);
    await vi.waitFor(() => expect(f.unlisten).toHaveBeenCalledTimes(1));
    expect(f.transport.start).not.toHaveBeenCalled();
  });

  it("disposes an in-flight native start and stops it once ready", async () => {
    const f = fixture(); const starting = deferred<void>(); f.transport.start.mockReturnValue(starting.promise);
    const { jobId } = f.start(); await vi.waitFor(() => expect(f.transport.start).toHaveBeenCalled());
    f.speech.dispose(); starting.resolve();
    await vi.waitFor(() => expect(f.transport.control).toHaveBeenCalledExactlyOnceWith(jobId, "stop"));
    expect(f.unlisten).toHaveBeenCalledTimes(1);
  });

  it("requires stopping active speech before hiding controls; source stays immutable when closed or edited", async () => {
    const f = fixture(); const id = await f.speaking();
    expect(() => f.speech.hide()).toThrow("Stop reading");
    f.engine.insert("edited"); expect(f.speech.stale()).toBe(true);
    expect(f.speech.state.job?.target.text).toBe(f.target.text);
    f.tabs.delete("note"); expect(() => f.speech.source(id)).toThrow("no longer open");
    await f.speech.control(id, "stop"); expect(f.speech.hide()).toEqual({ visible: false });
    expect(f.speech.state.visible).toBe(false);
  });
});
