import { Component, createSignal, createEffect, on, For, Show } from "solid-js";
import { gitStatus, gitStage, gitUnstage, gitCommit, gitCommitAmend, gitPush, gitPull, gitFetch, gitAheadBehind, gitStashSave, gitStashPop, gitStashList, gitStashDrop, gitRemoteList, gitRemoteAdd, gitRemoteRemove } from "../lib/ipc";
import type { GitStatusResult, GitRemote } from "../lib/ipc";
import DiffView from "./DiffView";
import { showError, showSuccess } from "../lib/notify";

interface GitPanelProps {
  workspaceRoot: string | null;
  onFileSelect?: (path: string) => void;
  onResolveConflict?: (filePath: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  "M": "#fab387",  // Peach
  "A": "#a6e3a1",  // Green
  "D": "#f38ba8",  // Red
  "R": "#89b4fa",  // Blue
  "??": "#a6adc8", // Subtext
};

import type { GitStashEntry } from "../lib/ipc";
import { basename } from "buster-path";

const GitPanel: Component<GitPanelProps> = (props) => {
  const [status, setStatus] = createSignal<GitStatusResult | null>(null);
  const [commitMsg, setCommitMsg] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [commitResult, setCommitResult] = createSignal<string | null>(null);
  const [amend, setAmend] = createSignal(false);
  const [ahead, setAhead] = createSignal(0);
  const [behind, setBehind] = createSignal(0);
  const [stashes, setStashes] = createSignal<GitStashEntry[]>([]);
  const [syncing, setSyncing] = createSignal(false);
  const [diffFile, setDiffFile] = createSignal<{ path: string; staged: boolean } | null>(null);
  const [remotes, setRemotes] = createSignal<GitRemote[]>([]);
  const [addingRemote, setAddingRemote] = createSignal(false);
  const [newRemoteName, setNewRemoteName] = createSignal("");
  const [newRemoteUrl, setNewRemoteUrl] = createSignal("");

  async function refresh() {
    if (!props.workspaceRoot) return;
    try {
      const result = await gitStatus(props.workspaceRoot);
      setStatus(result);
    } catch (e) {
      setStatus(null);
      showError("Git status failed", e);
    }
    refreshAheadBehind();
    refreshStashes();
    refreshRemotes();
  }

  async function refreshAheadBehind() {
    if (!props.workspaceRoot) return;
    try {
      const [a, b] = await gitAheadBehind(props.workspaceRoot);
      setAhead(a);
      setBehind(b);
    } catch (e) {
      setAhead(0);
      setBehind(0);
      showError("Failed to check ahead/behind", e);
    }
  }

  async function refreshStashes() {
    if (!props.workspaceRoot) return;
    try {
      setStashes(await gitStashList(props.workspaceRoot));
    } catch (e) {
      setStashes([]);
      showError("Failed to list stashes", e);
    }
  }

  async function refreshRemotes() {
    if (!props.workspaceRoot) return;
    try {
      setRemotes(await gitRemoteList(props.workspaceRoot));
    } catch (e) {
      setRemotes([]);
    }
  }

  async function handleAddRemote() {
    if (!props.workspaceRoot || !newRemoteName().trim() || !newRemoteUrl().trim()) return;
    try {
      await gitRemoteAdd(props.workspaceRoot, newRemoteName().trim(), newRemoteUrl().trim());
      setNewRemoteName("");
      setNewRemoteUrl("");
      setAddingRemote(false);
      await refreshRemotes();
      showSuccess("Remote added");
    } catch (e) { showError("Failed to add remote", e); }
  }

  async function handleRemoveRemote(name: string) {
    if (!props.workspaceRoot) return;
    const ok = window.confirm(`Remove remote "${name}"? This will lose tracking branch associations.`);
    if (!ok) return;
    try {
      await gitRemoteRemove(props.workspaceRoot, name);
      await refreshRemotes();
      showSuccess("Remote removed");
    } catch (e) { showError("Failed to remove remote", e); }
  }

  async function handleFetchRemote(name: string) {
    if (!props.workspaceRoot) return;
    try {
      await gitFetch(props.workspaceRoot, name);
      refreshAheadBehind();
      showSuccess(`Fetched ${name}`);
    } catch (e) { showError("Fetch failed", e); }
  }

  // Refresh when workspace changes
  createEffect(on(
    () => props.workspaceRoot,
    () => {
      if (props.workspaceRoot) refresh();
    }
  ));

  async function handleStage(path: string) {
    if (!props.workspaceRoot) return;
    try {
      await gitStage(props.workspaceRoot, path);
      await refresh();
    } catch (e) { showError("Stage failed", e); }
  }

  async function handleUnstage(path: string) {
    if (!props.workspaceRoot) return;
    try {
      await gitUnstage(props.workspaceRoot, path);
      await refresh();
    } catch (e) { showError("Unstage failed", e); }
  }

  async function handleCommit() {
    if (!props.workspaceRoot || !commitMsg().trim()) return;
    setLoading(true);
    setCommitResult(null);
    try {
      if (amend()) {
        await gitCommitAmend(props.workspaceRoot, commitMsg().trim());
      } else {
        await gitCommit(props.workspaceRoot, commitMsg().trim());
      }
      setCommitMsg("");
      setAmend(false);
      setCommitResult("committed");
      await refresh();
      setTimeout(() => setCommitResult(null), 2000);
    } catch (e) {
      setCommitResult("error");
      showError("Commit failed", e);
    }
    setLoading(false);
  }

  async function handlePush() {
    if (!props.workspaceRoot) return;
    setSyncing(true);
    try {
      await gitPush(props.workspaceRoot);
      await refreshAheadBehind();
    } catch (e) { showError("Push failed", e); }
    setSyncing(false);
  }

  async function handlePull() {
    if (!props.workspaceRoot) return;
    setSyncing(true);
    try {
      await gitPull(props.workspaceRoot);
      await refresh();
    } catch (e) { showError("Pull failed", e); }
    setSyncing(false);
  }

  async function handleFetch() {
    if (!props.workspaceRoot) return;
    setSyncing(true);
    try {
      await gitFetch(props.workspaceRoot);
      await refreshAheadBehind();
    } catch (e) { showError("Fetch failed", e); }
    setSyncing(false);
  }

  async function handleStashSave() {
    if (!props.workspaceRoot) return;
    try {
      await gitStashSave(props.workspaceRoot, undefined, true);
      await refresh();
    } catch (e) { showError("Stash save failed", e); }
  }

  async function handleStashPop(index: number) {
    if (!props.workspaceRoot) return;
    try {
      await gitStashPop(props.workspaceRoot, index);
      await refresh();
    } catch (e) { showError("Stash pop failed", e); }
  }

  async function handleStashDrop(index: number) {
    if (!props.workspaceRoot) return;
    try {
      await gitStashDrop(props.workspaceRoot, index);
      await refreshStashes();
    } catch (e) { showError("Stash drop failed", e); }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleCommit();
    }
  }

  const conflictedFiles = () => status()?.files.filter(f => f.conflicted) ?? [];
  const stagedFiles = () => status()?.files.filter(f => f.staged && !f.conflicted) ?? [];
  const unstagedFiles = () => status()?.files.filter(f => !f.staged && !f.conflicted) ?? [];
  const fileName = (path: string) => basename(path) || path;

  return (
    <div class="git-tab">
      {/* Sync buttons + ahead/behind */}
      <div class="git-sync-row">
        <button class="git-sync-btn" onClick={handleFetch} disabled={syncing()} title="Fetch">Fetch</button>
        <button class="git-sync-btn" onClick={handlePull} disabled={syncing()} title="Pull">Pull</button>
        <button class="git-sync-btn" onClick={handlePush} disabled={syncing()} title="Push">Push</button>
        <Show when={syncing()}>
          <span class="git-syncing-indicator"><span class="spinner spinner-sm" /> Syncing</span>
        </Show>
        <Show when={ahead() > 0 || behind() > 0}>
          <span class="git-ahead-behind">
            <Show when={ahead() > 0}><span class="git-ahead">{ahead()}&uarr;</span></Show>
            <Show when={behind() > 0}><span class="git-behind">{behind()}&darr;</span></Show>
          </span>
        </Show>
      </div>

      <div class="git-commit-section">
        <input
          class="git-commit-input"
          type="text"
          placeholder={amend() ? "Amend commit message" : "Commit message"}
          value={commitMsg()}
          onInput={(e) => setCommitMsg(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        <div class="git-commit-actions">
          <label class="git-amend-label">
            <input
              type="checkbox"
              checked={amend()}
              onChange={(e) => setAmend(e.currentTarget.checked)}
            />
            Amend
          </label>
          <button
            class="git-commit-btn"
            onClick={handleCommit}
            disabled={loading() || !commitMsg().trim() || (!amend() && stagedFiles().length === 0)}
          >
            {loading() ? "..." : amend() ? "Amend" : "Commit"}
          </button>
          <Show when={commitResult()}>
            <span class="git-commit-result" style={{
              color: commitResult() === "committed" ? "#a6e3a1" : "#f38ba8"
            }}>
              {commitResult() === "committed" ? "done" : "failed"}
            </span>
          </Show>
        </div>
      </div>

      <button class="git-refresh-btn" onClick={refresh}>Refresh</button>

      <Show when={conflictedFiles().length > 0}>
        <div class="git-section-header">Conflicts</div>
        <For each={conflictedFiles()}>
          {(file) => (
            <div class="git-file-row">
              <span class="git-file-status" style={{ color: "var(--yellow)" }}>
                {"⚠"}
              </span>
              <span
                class="git-file-name"
                style={{ color: "var(--yellow)" }}
                onClick={() => props.onResolveConflict?.(file.path)}
                title={file.path + " (conflicted - click to resolve)"}
              >
                {fileName(file.path)}
              </span>
            </div>
          )}
        </For>
      </Show>

      <Show when={stagedFiles().length > 0}>
        <div class="git-section-header">Staged</div>
        <For each={stagedFiles()}>
          {(file) => (
            <div class="git-file-row">
              <span class="git-file-status" style={{ color: STATUS_COLORS[file.status] || "#cdd6f4" }}>
                {file.status}
              </span>
              <span
                class="git-file-name"
                onClick={() => setDiffFile({ path: file.path, staged: true })}
                title={`${file.path} — click to view diff`}
              >
                {fileName(file.path)}
              </span>
              <button class="git-action-btn" onClick={() => handleUnstage(file.path)} title="Unstage">-</button>
            </div>
          )}
        </For>
      </Show>

      <Show when={unstagedFiles().length > 0}>
        <div class="git-section-header">Changes</div>
        <For each={unstagedFiles()}>
          {(file) => (
            <div class="git-file-row">
              <span class="git-file-status" style={{ color: STATUS_COLORS[file.status] || "#cdd6f4" }}>
                {file.status}
              </span>
              <span
                class="git-file-name"
                onClick={() => setDiffFile({ path: file.path, staged: false })}
                title={`${file.path} — click to view diff`}
              >
                {fileName(file.path)}
              </span>
              <button
                class="git-action-btn"
                onClick={() => handleStage(file.path)}
                title={file.status === "??" ? "Track" : "Stage"}
              >+</button>
            </div>
          )}
        </For>
      </Show>

      <Show when={status() && stagedFiles().length === 0 && unstagedFiles().length === 0 && conflictedFiles().length === 0}>
        <div class="git-empty">No changes</div>
      </Show>

      <Show when={!status() && props.workspaceRoot}>
        <div class="git-empty">Not a git repository</div>
      </Show>

      {/* Stash section */}
      <div class="git-section-header git-stash-header">
        Stash
        <button class="git-action-btn" onClick={handleStashSave} title="Stash changes">+</button>
      </div>
      <Show when={stashes().length > 0}>
        <For each={stashes()}>
          {(entry) => (
            <div class="git-file-row git-stash-row">
              <span class="git-stash-msg">{entry.message}</span>
              <button class="git-action-btn" onClick={() => handleStashPop(entry.index)} title="Pop">Pop</button>
              <button class="git-action-btn" onClick={() => handleStashDrop(entry.index)} title="Drop">x</button>
            </div>
          )}
        </For>
      </Show>
      <Show when={stashes().length === 0}>
        <div class="git-empty">No stashes</div>
      </Show>

      {/* Remotes section */}
      <div class="git-section-header git-stash-header">
        Remotes
        <button class="git-action-btn" onClick={() => setAddingRemote(!addingRemote())} title="Add remote">+</button>
      </div>
      <Show when={addingRemote()}>
        <div class="git-remote-add-form">
          <input
            class="git-commit-input"
            type="text"
            placeholder="Name (e.g. upstream)"
            value={newRemoteName()}
            onInput={(e) => setNewRemoteName(e.currentTarget.value)}
          />
          <input
            class="git-commit-input"
            type="text"
            placeholder="URL"
            value={newRemoteUrl()}
            onInput={(e) => setNewRemoteUrl(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddRemote(); }}
          />
          <div class="git-commit-actions">
            <button class="git-action-btn" onClick={() => setAddingRemote(false)}>Cancel</button>
            <button class="git-commit-btn" onClick={handleAddRemote} disabled={!newRemoteName().trim() || !newRemoteUrl().trim()}>Add</button>
          </div>
        </div>
      </Show>
      <For each={remotes()}>
        {(remote) => (
          <div class="git-file-row">
            <span class="git-file-name" title={remote.url}>{remote.name}</span>
            <span class="git-stash-msg" style={{ opacity: "0.6" }}>{remote.url}</span>
            <button class="git-action-btn" onClick={() => handleFetchRemote(remote.name)} title="Fetch this remote">fetch</button>
            <button class="git-action-btn" onClick={() => handleRemoveRemote(remote.name)} title="Remove remote">x</button>
          </div>
        )}
      </For>
      <Show when={remotes().length === 0 && !addingRemote()}>
        <div class="git-empty">No remotes</div>
      </Show>

      {/* Inline diff view */}
      <Show when={diffFile() && props.workspaceRoot}>
        <DiffView
          workspaceRoot={props.workspaceRoot!}
          filePath={diffFile()!.path}
          staged={diffFile()!.staged}
          onClose={() => setDiffFile(null)}
        />
      </Show>
    </div>
  );
};

export default GitPanel;
