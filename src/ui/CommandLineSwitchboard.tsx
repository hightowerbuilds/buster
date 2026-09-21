import { Component, For, Show, createEffect, createSignal, on } from "solid-js";
import { useBuster } from "../lib/buster-context";
import type { CommandResult } from "../lib/feature-commands";

interface CommandLineSwitchboardProps {
  visible: boolean;
  onClose: () => void;
  onOpenExtensions: () => void;
  onOpenSettings: () => void;
  onOpenGit: () => void;
  onOpenBrowser: () => void;
  onOpenConsole: () => void;
  onOpenAi: () => void;
}

const CommandLineSwitchboard: Component<CommandLineSwitchboardProps> = (props) => {
  const { commands } = useBuster();
  const [line, setLine] = createSignal("");
  const [result, setResult] = createSignal<CommandResult | null>(null);
  const [busy, setBusy] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  const shortcuts = [
    { label: "AI", run: props.onOpenAi },
    { label: "Extensions", run: props.onOpenExtensions },
    { label: "Git", run: props.onOpenGit },
    { label: "Browser", run: props.onOpenBrowser },
    { label: "Console", run: props.onOpenConsole },
    { label: "Settings", run: props.onOpenSettings },
  ];

  createEffect(on(() => props.visible, visible => {
    if (visible) requestAnimationFrame(() => inputRef?.focus());
  }));

  async function runLine(commandLine = line()) {
    if (busy() || !commandLine.trim()) return;
    setBusy(true);
    try {
      const outcome = await commands.executeLine(commandLine, crypto.randomUUID());
      setResult(outcome);
      if (outcome.ok && ["terminal create", "terminal focus", "panel focus", "panel split", "document create", "panel zoom", "panel swap", "panel close", "selection lookup", "selection ai", "selection voice", "speech source", "review source", "review discard", "review apply"].includes(outcome.command)) {
        props.onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={props.visible}>
      <div class="command-line-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) props.onClose(); }}>
        <div class="command-line-shell" role="dialog" aria-label="BusterMark command line"
          onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); props.onClose(); } }}>
          <form class="command-line-bar" onSubmit={e => { e.preventDefault(); void runLine(); }}>
            <span class="command-line-prompt" aria-hidden="true">&gt;</span>
            <input ref={inputRef} class="command-line-input" value={line()}
              onInput={e => setLine(e.currentTarget.value)}
              autocomplete="off" autocapitalize="off" spellcheck={false}
              aria-label="App command" placeholder="help, app status, terminal create…" />
            <button type="submit" disabled={busy() || !line().trim()}>{busy() ? "Running…" : "Run"}</button>
          </form>
          <div class="command-line-caption">
            App commands accept an optional JSON object. Press Enter to run, Escape to close.
          </div>
          <div class="command-line-examples">
            <For each={["help", "document create", 'panel split {"direction":"right"}', "layout inspect", "terminal create"]}>
              {example => <button type="button" disabled={busy()} onClick={() => { setLine(example); void runLine(example); }}>{example}</button>}
            </For>
          </div>
          <Show when={result()}>
            <pre class="command-line-result" tabindex={0} aria-label="Command result">{JSON.stringify(result(), null, 2)}</pre>
          </Show>
          <div class="command-line-caption" role="status" aria-live="polite">
            {busy() ? "Running command" : result() ? (result()!.ok ? "Command completed" : "Command failed — see result") : "Ready"}
          </div>
          <div class="command-line-options" role="group" aria-label="Open a tool">
            <For each={shortcuts}>{shortcut => <button type="button" class="command-line-option" onClick={shortcut.run}>{shortcut.label}</button>}</For>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default CommandLineSwitchboard;
