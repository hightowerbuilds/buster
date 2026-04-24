import { Component, For, Show, createEffect, on } from "solid-js";

interface CommandLineSwitchboardProps {
  visible: boolean;
  onClose: () => void;
  onOpenExtensions: () => void;
  onOpenDebug: () => void;
  onOpenSettings: () => void;
  onOpenGit: () => void;
  onOpenBrowser: () => void;
  onOpenConsole: () => void;
}

interface CommandOption {
  key: string;
  description: string;
  action: string;
}

const COMMAND_OPTIONS: CommandOption[] = [
  { key: "e", description: "Extensions", action: "extensions" },
  { key: "g", description: "Git", action: "git" },
  { key: "b", description: "Browser", action: "browser" },
  { key: "l", description: "Console", action: "console" },
  { key: "s", description: "Settings", action: "settings" },
];

const VALID_COMMAND_KEYS = new Set(COMMAND_OPTIONS.map((o) => o.key));

const CommandLineSwitchboard: Component<CommandLineSwitchboardProps> = (props) => {
  let inputRef: HTMLInputElement | undefined;

  createEffect(
    on(
      () => props.visible,
      (visible) => {
        if (!inputRef) return;
        if (visible) {
          inputRef.value = "";
          requestAnimationFrame(() => inputRef?.focus({ preventScroll: true }));
        } else {
          inputRef.value = "";
        }
      },
    ),
  );

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
      return;
    }
    if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;
    if (["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Home", "End", "Tab"].includes(e.key)) return;
    if (e.key === "Enter") { e.preventDefault(); return; }

    const key = e.key.toLowerCase();
    if (!VALID_COMMAND_KEYS.has(key)) e.preventDefault();
  }

  function handleInput(e: InputEvent & { currentTarget: HTMLInputElement }) {
    const key = e.currentTarget.value.toLowerCase().replace(/[^egblsf]/g, "").slice(-1);
    e.currentTarget.value = key;
    if (!key) return;

    const option = COMMAND_OPTIONS.find((c) => c.key === key);
    if (!option) return;

    switch (option.action) {
      case "extensions": props.onOpenExtensions(); break;
      case "debug": props.onOpenDebug(); break;
      case "git": props.onOpenGit(); break;
      case "browser": props.onOpenBrowser(); break;
      case "console": props.onOpenConsole(); break;
      case "settings": props.onOpenSettings(); break;
    }
  }

  return (
    <Show when={props.visible}>
      <div
        class="command-line-backdrop"
        onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
      >
        <div class="command-line-shell" role="dialog" aria-label="Command switchboard">
          <div class="command-line-bar">
            <span class="command-line-prompt" aria-hidden="true">~~~</span>
            <input
              ref={inputRef}
              class="command-line-input"
              type="text"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              aria-label="Command line input"
              placeholder="E / G / B / L / S"
              onKeyDown={handleKeyDown}
              onInput={handleInput}
            />
          </div>
          <div class="command-line-caption">E=Extensions, G=Git, B=Browser, L=Console, S=Settings</div>
          <div class="command-line-options" role="list">
            <For each={COMMAND_OPTIONS}>
              {(option) => (
                <div class="command-line-option" role="listitem">
                  <span class="command-line-option-key">{option.key.toUpperCase()}</span>
                  <span class="command-line-option-desc">{option.description}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default CommandLineSwitchboard;
