import { Component, For, Show, createEffect, on } from "solid-js";
import type { PanelCount } from "../lib/panel-count";
import { PRIMARY_LAYOUT_OPTIONS } from "./LayoutPicker";

interface CommandLineSwitchboardProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (count: PanelCount) => void;
  onOpenExtensions: () => void;
  onOpenDebug: () => void;
  onOpenSettings: () => void;
  onOpenGit: () => void;
  onOpenBrowser: () => void;
  onOpenConsole: () => void;
}

type CommandOption =
  | {
      key: string;
      label: string;
      description: string;
      action: "layout";
      count: PanelCount;
    }
  | {
      key: string;
      label: string;
      description: string;
      action: "extensions";
    }
  | {
      key: string;
      label: string;
      description: string;
      action: "debug";
    }
  | {
      key: string;
      label: string;
      description: string;
      action: "settings";
    }
  | {
      key: string;
      label: string;
      description: string;
      action: "git";
    }
  | {
      key: string;
      label: string;
      description: string;
      action: "browser";
    }
  | {
      key: string;
      label: string;
      description: string;
      action: "console";
    }
const COMMAND_OPTIONS: CommandOption[] = [
  ...PRIMARY_LAYOUT_OPTIONS.map((layout) => ({
    key: layout.label.slice(1),
    label: layout.label,
    description: layout.description,
    action: "layout" as const,
    count: layout.count,
  })),
  {
    key: "e",
    label: "ext",
    description: "Extensions",
    action: "extensions" as const,
  },
  {
    key: "d",
    label: "dbg",
    description: "Debugger",
    action: "debug" as const,
  },
  {
    key: "g",
    label: "git",
    description: "Git",
    action: "git" as const,
  },
  {
    key: "b",
    label: "brw",
    description: "Browser",
    action: "browser" as const,
  },
  {
    key: "l",
    label: "log",
    description: "Console",
    action: "console" as const,
  },
  {
    key: "s",
    label: "set",
    description: "Settings",
    action: "settings" as const,
  },
];

const VALID_COMMAND_KEYS = new Set(COMMAND_OPTIONS.map((option) => option.key));

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
    if (e.key === "Enter") {
      e.preventDefault();
      return;
    }

    const key = e.key.toLowerCase();
    if (!VALID_COMMAND_KEYS.has(key)) {
      e.preventDefault();
    }
  }

  function handleInput(e: InputEvent & { currentTarget: HTMLInputElement; target: Element }) {
    const key = e.currentTarget.value.toLowerCase().replace(/[^1-6edgbls]/g, "").slice(-1);
    e.currentTarget.value = key;
    if (!key) return;

    const option = COMMAND_OPTIONS.find((candidate) => candidate.key === key);
    if (!option) return;

    if (option.action === "layout") props.onSelect(option.count);
    else if (option.action === "extensions") props.onOpenExtensions();
    else if (option.action === "debug") props.onOpenDebug();
    else if (option.action === "git") props.onOpenGit();
    else if (option.action === "browser") props.onOpenBrowser();
    else if (option.action === "console") props.onOpenConsole();
    else if (option.action === "settings") props.onOpenSettings();
  }

  return (
    <Show when={props.visible}>
      <div
        class="command-line-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
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
              placeholder="1-6 / E / D / G / B / L / S"
              onKeyDown={handleKeyDown}
              onInput={handleInput}
            />
          </div>
          <div class="command-line-caption">Press 1-6 for panel layouts, E for Extensions, D for Debug, G for Git, B for Browser, L for Console, or S for Settings.</div>
          <div class="command-line-options" role="list">
            <For each={COMMAND_OPTIONS}>
              {(option) => (
                <div class="command-line-option" role="listitem">
                  <span class="command-line-option-key">{option.key.toUpperCase()}</span>
                  <span class="command-line-option-label">{option.label}</span>
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
