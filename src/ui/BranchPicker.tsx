import { Component, createSignal, createEffect, For, Show } from "solid-js";
import { gitBranchList, gitBranchSwitch, gitBranchCreate, gitBranchDelete } from "../lib/ipc";
import type { GitBranchInfo } from "../lib/ipc";
import { showToast } from "./CanvasToasts";
import { createFocusTrap } from "../lib/a11y";
import { useBuster } from "../lib/buster-context";

interface BranchPickerProps {
  workspaceRoot: string;
  onClose: () => void;
  onBranchChanged: () => void;
}

const BranchPicker: Component<BranchPickerProps> = (props) => {
  const { store, engines } = useBuster();
  const [branches, setBranches] = createSignal<GitBranchInfo[]>([]);
  const [filter, setFilter] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;
  let pickerRef: HTMLDivElement | undefined;

  const trap = createFocusTrap(() => pickerRef, () => props.onClose());

  // Activate focus trap on mount
  createEffect(() => { trap.activate(); });

  async function loadBranches() {
    try {
      const list = await gitBranchList(props.workspaceRoot);
      setBranches(list);
    } catch (e) {
      showToast("Failed to load branches: " + String(e), "error");
    }
  }

  loadBranches();

  const filtered = () => {
    const q = filter().toLowerCase();
    if (!q) return branches().filter(b => !b.is_remote);
    return branches().filter(b => b.name.toLowerCase().includes(q));
  };

  // Reset selection when filter changes
  createEffect(() => { filtered(); setSelectedIdx(0); });

  // Check for dirty files
  function hasDirtyFiles(): boolean {
    return store.tabs.some(t => {
      if (t.type !== "file" || !t.dirty) return false;
      const engine = engines.get(t.id);
      return engine ? engine.dirty() : t.dirty;
    });
  }

  async function handleSwitch(name: string) {
    if (hasDirtyFiles()) {
      const ok = window.confirm("You have unsaved changes. Switching branches may discard them. Continue?");
      if (!ok) return;
    }
    try {
      await gitBranchSwitch(props.workspaceRoot, name);
      showToast(`Switched to ${name}`, "success");
      props.onBranchChanged();
      trap.deactivate();
      props.onClose();
    } catch (e) {
      showToast("Switch failed: " + String(e), "error");
    }
  }

  async function handleCreate() {
    const name = newName().trim();
    if (!name) return;
    try {
      await gitBranchCreate(props.workspaceRoot, name);
      showToast(`Created ${name}`, "success");
      setNewName("");
      setCreating(false);
      props.onBranchChanged();
      trap.deactivate();
      props.onClose();
    } catch (e) {
      showToast("Create failed: " + String(e), "error");
    }
  }

  async function handleDelete(name: string) {
    try {
      await gitBranchDelete(props.workspaceRoot, name);
      showToast(`Deleted ${name}`, "success");
      await loadBranches();
    } catch (e) {
      showToast("Delete failed: " + String(e), "error");
    }
  }

  function handleBackdrop(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains("branch-picker-backdrop")) {
      trap.deactivate();
      props.onClose();
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      trap.deactivate();
      props.onClose();
      return;
    }

    if (creating()) {
      if (e.key === "Enter") { e.preventDefault(); handleCreate(); }
      return;
    }

    const list = filtered();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const branch = list[selectedIdx()];
      if (branch && !branch.is_current) handleSwitch(branch.name);
    }
  }

  return (
    <div class="branch-picker-backdrop" onClick={handleBackdrop} onKeyDown={handleKeyDown}>
      <div ref={pickerRef} class="branch-picker" role="dialog" aria-modal="true" aria-label="Branch picker">
        <input
          ref={inputRef}
          class="branch-picker-input"
          type="text"
          placeholder={creating() ? "New branch name..." : "Filter branches..."}
          value={creating() ? newName() : filter()}
          onInput={(e) => creating() ? setNewName(e.currentTarget.value) : setFilter(e.currentTarget.value)}
          autofocus
        />
        <div class="branch-picker-actions">
          <button
            class="git-action-btn"
            onClick={() => { setCreating(!creating()); setNewName(""); setFilter(""); }}
          >
            {creating() ? "Back" : "+ New"}
          </button>
        </div>
        <Show when={!creating()}>
          <div class="branch-picker-list" role="listbox">
            <For each={filtered()}>
              {(branch, idx) => (
                <div
                  class={`branch-picker-item${branch.is_current ? " branch-picker-current" : ""}${idx() === selectedIdx() ? " branch-picker-selected" : ""}`}
                  role="option"
                  aria-selected={idx() === selectedIdx()}
                  onClick={() => { if (!branch.is_current) handleSwitch(branch.name); }}
                  onMouseEnter={() => setSelectedIdx(idx())}
                >
                  <span class="branch-picker-name">
                    {branch.is_current ? "* " : ""}{branch.name}
                  </span>
                  <Show when={!branch.is_current}>
                    <button class="git-action-btn" onClick={(e) => { e.stopPropagation(); handleDelete(branch.name); }} title="Delete branch">x</button>
                  </Show>
                </div>
              )}
            </For>
            <Show when={filtered().length === 0}>
              <div class="branch-picker-empty">No branches found</div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default BranchPicker;
