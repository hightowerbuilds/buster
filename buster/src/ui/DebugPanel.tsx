/**
 * DebugPanel — Debug controls, stack trace, variables, and breakpoint management.
 * Opens as a tab panel like Settings, Git, or Manual.
 */

import { Component, createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import {
  debugState, debugLaunch, debugContinue, debugStepOver, debugStepInto,
  debugStepOut, debugPause, debugStop, debugStackTrace, debugVariables,
  type DebugStackFrame, type DebugVariable,
} from "../lib/ipc";
import { basename } from "buster-path";
import "../styles/debug.css";

const DebugPanel: Component = () => {
  const [state, setState] = createSignal<string>("Idle");
  const [stackFrames, setStackFrames] = createSignal<DebugStackFrame[]>([]);
  const [variables, setVariables] = createSignal<DebugVariable[]>([]);
  const [selectedFrame, setSelectedFrame] = createSignal<number | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  // Launch config
  const [adapterCmd, setAdapterCmd] = createSignal("");
  const [adapterArgs, setAdapterArgs] = createSignal("");
  const [program, setProgram] = createSignal("");

  // Poll debug state
  let pollTimer: ReturnType<typeof setInterval>;

  async function refreshState() {
    try {
      const s = await debugState();
      setState(s);

      if (s === "Paused") {
        const frames = await debugStackTrace();
        setStackFrames(frames);
        if (frames.length > 0 && selectedFrame() === null) {
          setSelectedFrame(frames[0]!.id);
          loadVariables(frames[0]!.id);
        }
      } else if (s === "Idle" || s === "Stopped") {
        setStackFrames([]);
        setVariables([]);
        setSelectedFrame(null);
      }
    } catch {
      // State query failed — likely no session
    }
  }

  async function loadVariables(frameId: number) {
    try {
      const vars = await debugVariables(frameId);
      setVariables(vars);
    } catch {
      setVariables([]);
    }
  }

  // Poll every 500ms for state changes (until event forwarding is implemented)
  pollTimer = setInterval(refreshState, 500);
  onCleanup(() => clearInterval(pollTimer));
  refreshState();

  async function handleLaunch() {
    setError(null);
    const cmd = adapterCmd().trim();
    const prog = program().trim();
    if (!cmd || !prog) {
      setError("Adapter command and program path are required.");
      return;
    }
    const args = adapterArgs().trim() ? adapterArgs().trim().split(/\s+/) : [];
    try {
      await debugLaunch(cmd, args, prog, "");
      setState("Running");
    } catch (e: any) {
      setError(e?.toString() || "Launch failed");
    }
  }

  async function handleAction(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      setTimeout(refreshState, 100);
    } catch (e: any) {
      setError(e?.toString() || "Action failed");
    }
  }

  function selectFrame(frame: DebugStackFrame) {
    setSelectedFrame(frame.id);
    loadVariables(frame.id);
  }

  const isRunning = () => state() === "Running";
  const isPaused = () => state() === "Paused";
  const isActive = () => isRunning() || isPaused();

  return (
    <div class="debug-panel">
      <div class="debug-header">
        <h1 class="debug-title">Debugger</h1>
        <span class={`debug-state debug-state-${state().toLowerCase()}`}>
          {state()}
        </span>
      </div>

      <div class="debug-body">
        {/* ── Launch Configuration ────────────────────── */}
        <Show when={!isActive()}>
          <section class="debug-section">
            <h2>Launch Configuration</h2>
            <div class="debug-form">
              <label class="debug-label">
                Debug Adapter
                <input
                  class="debug-input"
                  type="text"
                  placeholder="e.g. codelldb, python -m debugpy.adapter, dlv dap"
                  value={adapterCmd()}
                  onInput={(e) => setAdapterCmd(e.currentTarget.value)}
                />
              </label>
              <label class="debug-label">
                Adapter Arguments
                <input
                  class="debug-input"
                  type="text"
                  placeholder="e.g. --port 0 (optional)"
                  value={adapterArgs()}
                  onInput={(e) => setAdapterArgs(e.currentTarget.value)}
                />
              </label>
              <label class="debug-label">
                Program to Debug
                <input
                  class="debug-input"
                  type="text"
                  placeholder="e.g. ./target/debug/myapp, main.py, ./main"
                  value={program()}
                  onInput={(e) => setProgram(e.currentTarget.value)}
                />
              </label>
              <button class="debug-launch-btn" onClick={handleLaunch}>
                Launch
              </button>
            </div>
            <Show when={error()}>
              <div class="debug-error">{error()}</div>
            </Show>
          </section>

          <section class="debug-section">
            <h2>Supported Adapters</h2>
            <table class="debug-table">
              <thead><tr><th>Language</th><th>Adapter</th><th>Command</th></tr></thead>
              <tbody>
                <tr><td>Rust / C / C++</td><td>CodeLLDB</td><td><code>codelldb</code></td></tr>
                <tr><td>Python</td><td>debugpy</td><td><code>python -m debugpy.adapter</code></td></tr>
                <tr><td>Go</td><td>Delve</td><td><code>dlv dap</code></td></tr>
                <tr><td>JavaScript / TypeScript</td><td>js-debug</td><td><code>js-debug-adapter</code></td></tr>
              </tbody>
            </table>
            <p class="debug-hint">
              Set breakpoints by clicking the line numbers in the editor gutter before launching.
            </p>
          </section>
        </Show>

        {/* ── Active Session Controls ─────────────────── */}
        <Show when={isActive()}>
          <section class="debug-section">
            <h2>Controls</h2>
            <div class="debug-controls">
              <Show when={isPaused()}>
                <button class="debug-ctrl-btn" onClick={() => handleAction(debugContinue)} title="Continue (F5)">
                  Continue
                </button>
                <button class="debug-ctrl-btn" onClick={() => handleAction(debugStepOver)} title="Step Over (F10)">
                  Step Over
                </button>
                <button class="debug-ctrl-btn" onClick={() => handleAction(debugStepInto)} title="Step Into (F11)">
                  Step Into
                </button>
                <button class="debug-ctrl-btn" onClick={() => handleAction(debugStepOut)} title="Step Out (Shift+F11)">
                  Step Out
                </button>
              </Show>
              <Show when={isRunning()}>
                <button class="debug-ctrl-btn" onClick={() => handleAction(debugPause)} title="Pause (F6)">
                  Pause
                </button>
              </Show>
              <button class="debug-ctrl-btn debug-stop-btn" onClick={() => handleAction(debugStop)} title="Stop (Shift+F5)">
                Stop
              </button>
            </div>
            <Show when={error()}>
              <div class="debug-error">{error()}</div>
            </Show>
          </section>

          {/* ── Stack Trace ────────────────────────────── */}
          <Show when={stackFrames().length > 0}>
            <section class="debug-section">
              <h2>Call Stack</h2>
              <div class="debug-stack">
                <For each={stackFrames()}>
                  {(frame) => (
                    <div
                      class={`debug-stack-frame ${selectedFrame() === frame.id ? "selected" : ""}`}
                      onClick={() => selectFrame(frame)}
                    >
                      <span class="debug-frame-name">{frame.name}</span>
                      <Show when={frame.file_path}>
                        <span class="debug-frame-loc">
                          {basename(frame.file_path!)}:{frame.line}
                        </span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </Show>

          {/* ── Variables ──────────────────────────────── */}
          <Show when={variables().length > 0}>
            <section class="debug-section">
              <h2>Variables</h2>
              <div class="debug-variables">
                <For each={variables()}>
                  {(v) => (
                    <div class="debug-variable">
                      <span class="debug-var-name">{v.name}</span>
                      <span class="debug-var-value">{v.value}</span>
                      <Show when={v.var_type}>
                        <span class="debug-var-type">{v.var_type}</span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default DebugPanel;
