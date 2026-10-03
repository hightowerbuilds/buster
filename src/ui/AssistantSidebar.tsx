import { For, Match, Show, Switch, createEffect, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";
import { useBuster } from "../lib/buster-context";
import { ASSISTANT_MODELS, EFFORTS, formatElapsed, supportsEffort, type AssistantEntry, type Effort } from "../lib/assistant";
import { diffWordsWithSpace } from "diff";
import ShaderPreview from "./ShaderPreview";
import { isLocalModel, LOCAL_PREFIX } from "../lib/local-model-transport";
import "../styles/assistant.css";

const CONNECTION = {
  unknown: { tone: "idle", label: "Checking Claude Code" },
  checking: { tone: "idle", label: "Checking Claude Code…" },
  missing: { tone: "bad", label: "Claude Code is not installed. Click to check again." },
  "logged-out": { tone: "bad", label: "Claude Code is not signed in. Click to check again." },
  ready: { tone: "good", label: "Connected through Claude Code" },
  error: { tone: "bad", label: "Could not reach Claude Code. Click to check again." },
} as const;

const TOOL_STATUS = { running: "running", awaiting: "needs approval", done: "done", failed: "failed", denied: "declined", cancelled: "cancelled" } as const;
const EFFORT_LABEL: Record<Effort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };

const Icon = (props: { children: JSX.Element }) =>
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{props.children}</svg>;
const PlusIcon = () => <Icon><path d="M8 3v10M3 8h10" /></Icon>;
const CloseIcon = () => <Icon><path d="M4 4l8 8M12 4l-8 8" /></Icon>;
const SendIcon = () => <Icon><path d="M8 13V3M4 7l4-4 4 4" /></Icon>;
const StopIcon = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="1.5" fill="currentColor" /></svg>;

// Ghost blocks that ripple along the empty line while the input waits for text.
const CARET_GHOSTS = Array.from({ length: 22 }, (_, i) => i + 1);

const pretty = (value: unknown) => { try { return JSON.stringify(value, null, 2); } catch { return String(value); } };
const prettyResult = (text: string) => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } };

type EditArgs = { tabId?: string; edits?: Array<{ find?: string; replace?: string; occurrence?: number }> };
const noteArg = (args: unknown, key: string) => { const value = (args as Record<string, unknown> | null)?.[key]; return typeof value === "string" ? value : ""; };
const editList = (args: unknown) => Array.isArray((args as EditArgs | null)?.edits) ? (args as EditArgs).edits! : [];

/** Before/after view of document edits: removed words struck through, added words highlighted. */
function EditPreview(props: { args: unknown }) {
  return (
    <ol class="as-diff">
      <For each={editList(props.args)}>{edit =>
        <li>
          <For each={diffWordsWithSpace(String(edit.find ?? ""), String(edit.replace ?? ""))}>{part =>
            part.removed ? <del>{part.value}</del> : part.added ? <ins>{part.value}</ins> : <span>{part.value}</span>
          }</For>
          <Show when={edit.occurrence}><span class="as-diff-note"> (occurrence {edit.occurrence})</span></Show>
        </li>
      }</For>
    </ol>
  );
}

export default function AssistantSidebar(props: { onClose: () => void }) {
  const { assistant, store, backgrounds } = useBuster();
  const noteName = (args: unknown) => store.tabs.find(tab => tab.id === (args as EditArgs | null)?.tabId)?.name ?? "this note";
  const isEdit = (command: string) => command === "document edit";
  const state = assistant.state;
  const draft = () => state.draft;
  const setDraft = assistant.setDraft;
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [historyQuery, setHistoryQuery] = createSignal("");
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [chatTitle, setChatTitle] = createSignal("");
  const [deleting, setDeleting] = createSignal<string | null>(null);
  const visibleChats = () => state.chats.filter(chat => assistant.matches(chat.id, historyQuery()));
  const activeTitle = () => state.chats.find(chat => chat.id === state.activeId)?.title ?? "New chat";
  async function switchChat(id: string) {
    await assistant.switchChat(id);
    if (state.activeId === id) { setHistoryOpen(false); input?.focus(); }
  }
  // Block caret: the native caret is hidden and a block is drawn in a mirror of the text.
  const [caret, setCaret] = createSignal<{ index: number; scroll: number } | null>(null);
  const [typing, setTyping] = createSignal(false);
  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  let transcript: HTMLDivElement | undefined;
  let input: HTMLTextAreaElement | undefined;

  function syncCaret(moved = true) {
    if (!input || document.activeElement !== input || input.selectionStart !== input.selectionEnd) { setCaret(null); return; }
    setCaret({ index: input.selectionStart, scroll: input.scrollTop });
    if (!moved) return;
    // Hold the caret solid while typing or moving, then resume blinking.
    setTyping(true);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => setTyping(false), 600);
  }
  const onSelectionChange = () => syncCaret();
  document.addEventListener("selectionchange", onSelectionChange);
  onCleanup(() => { document.removeEventListener("selectionchange", onSelectionChange); clearTimeout(typingTimer); });

  onMount(() => { if (state.connection === "unknown") void assistant.refreshStatus(); });
  // Follow new output unless the writer has scrolled up to read.
  createEffect(on(() => state.entries.map(e => e.kind === "assistant" ? e.text.length + e.thinking.length : e.kind === "tool" ? e.status : e.id), () => {
    if (!transcript) return;
    if (transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 120) queueMicrotask(() => transcript!.scrollTo({ top: transcript!.scrollHeight }));
  }));
  // Grow the composer with its content up to a limit.
  createEffect(on(draft, () => { if (!input) return; input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 240)}px`; }));
  createEffect(on(() => state.activeId, () => queueMicrotask(() => {
    transcript?.scrollTo({ top: transcript.scrollHeight }); syncCaret(false);
  })));

  // Turn timer: ticks while Claude works, then shows the total briefly.
  const [now, setNow] = createSignal(Date.now());
  const [showDone, setShowDone] = createSignal(false);
  createEffect(() => {
    if (state.running) {
      setShowDone(false);
      setNow(Date.now());
      const clock = setInterval(() => setNow(Date.now()), 250);
      onCleanup(() => clearInterval(clock));
    } else if (state.lastTurnMs !== null) {
      setShowDone(true);
      const hide = setTimeout(() => setShowDone(false), 4000);
      onCleanup(() => clearTimeout(hide));
    }
  });
  const awaitingApproval = () => state.entries.some(e => e.kind === "tool" && e.status === "awaiting");
  const timerPhase = () => !state.running ? "done" : awaitingApproval() ? "waiting" : "thinking";
  const timerLabel = () => ({ thinking: "Thinking", waiting: "Waiting for your approval", done: "Done in" })[timerPhase()];
  const timerTime = () => formatElapsed(state.running ? now() - (state.turnStartedAt ?? now()) : state.lastTurnMs ?? 0);

  const needsSetup = () => state.connection === "missing" || state.connection === "logged-out";
  const canSend = () => state.ready && !state.switching && !state.running && !!draft().trim() && !needsSetup();
  const connection = () => CONNECTION[state.connection];

  function submit(event?: Event) {
    event?.preventDefault();
    if (!canSend()) return;
    const text = draft();
    setDraft("");
    void assistant.send(text);
  }

  // A click anywhere in the sidebar readies the message box, unless it was on a control or finished a text selection.
  function focusInput(event: MouseEvent) {
    const target = event.target as Element | null;
    if (!input || target?.closest("button, select, input, textarea, a, summary, label, .as-approval, .as-resize")) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && event.currentTarget instanceof Node && event.currentTarget.contains(selection.anchorNode)) return;
    input.focus({ preventScroll: true });
  }

  function resize(event: PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = state.width;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const move = (e: PointerEvent) => assistant.setWidth(startWidth - (e.clientX - startX));
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  const entryView = (entry: AssistantEntry) => (
    <Switch>
      <Match when={entry.kind === "user" && entry}>{e => <div class="as-user">{e().text}</div>}</Match>
      <Match when={entry.kind === "assistant" && (entry.text || entry.thinking || entry.streaming) ? entry : undefined}>{e =>
        <div class="as-reply">
          <Show when={e().thinking}>
            <details class="as-thinking"><summary>{e().streaming && !e().text ? "Thinking…" : "Thought"}</summary><p>{e().thinking}</p></details>
          </Show>
          <Show when={e().text} fallback={<Show when={e().streaming && !e().thinking}><span class="as-pending" aria-label="Waiting for Claude" /></Show>}>
            <p class="as-text">{e().text}</p>
          </Show>
        </div>
      }</Match>
      <Match when={entry.kind === "tool" && entry}>{e =>
        <Show when={e().status === "awaiting"} fallback={
          <details class={`as-tool as-tool-${e().status}`}>
            <summary><span class="as-tool-name">{e().command}</span><span class="as-tool-status">{TOOL_STATUS[e().status]}</span></summary>
            <Show when={isEdit(e().command)} fallback={<pre>{pretty(e().args)}</pre>}><EditPreview args={e().args} /></Show>
            <Show when={e().result}><pre>{prettyResult(e().result)}</pre></Show>
          </details>
        }>
          <div class="as-approval" role="group" aria-label={`Approve ${e().command}`}>
            <Switch fallback={<>
              <div class="as-approval-title">Allow <span class="as-tool-name">{e().command}</span>?</div>
              <pre>{pretty(e().args)}</pre>
            </>}>
              <Match when={isEdit(e().command)}>
                <div class="as-approval-title">Apply {editList(e().args).length === 1 ? "1 edit" : `${editList(e().args).length} edits`} to {noteName(e().args)}?</div>
                <EditPreview args={e().args} />
              </Match>
              <Match when={e().command === "note create"}>
                <div class="as-approval-title">Create the note <strong>{noteArg(e().args, "name") || "with a new element name"}</strong>?</div>
                <Show when={noteArg(e().args, "text")}><pre class="as-note-preview">{noteArg(e().args, "text")}</pre></Show>
              </Match>
              <Match when={e().command === "background create"}>
                <div class="as-approval-title">{(e().args as { apply?: boolean } | null)?.apply === false ? "Save" : "Create and use"} the background <strong>{noteArg(e().args, "name")}</strong>?</div>
                <ShaderPreview wgsl={noteArg(e().args, "wgsl")} />
              </Match>
              <Match when={e().command === "background update"}>
                <div class="as-approval-title">Update the background <strong>{backgrounds.byId(noteArg(e().args, "id"))?.name ?? noteArg(e().args, "id")}</strong>?</div>
                <ShaderPreview wgsl={noteArg(e().args, "wgsl")} />
              </Match>
              <Match when={e().command === "note rename"}>
                <div class="as-approval-title">Rename <strong>{noteArg(e().args, "path")}</strong> to <strong>{noteArg(e().args, "name")}</strong>?</div>
              </Match>
            </Switch>
            <div class="as-approval-buttons">
              <button class="as-button as-button-primary" onClick={() => assistant.approve(e().toolUseId, true)}>Allow</button>
              <button class="as-button" onClick={() => assistant.approve(e().toolUseId, false)}>Deny</button>
            </div>
          </div>
        </Show>
      }</Match>
      <Match when={entry.kind === "notice" && entry}>{e => <p class={`as-notice as-notice-${e().tone}`} role={e().tone === "error" ? "alert" : undefined}>{e().text}</p>}</Match>
    </Switch>
  );

  return (
    <aside class="assistant-sidebar" role="complementary" aria-label="Language Model" style={{ width: `${state.width}px` }} onClick={focusInput}>
      <div class="as-resize" onPointerDown={resize} aria-hidden="true" />
      <header class="as-header">
        <button class={`as-status as-status-${connection().tone}`} title={state.connectionDetail || connection().label}
          aria-label={connection().label} disabled={state.connection === "checking"} onClick={() => void assistant.refreshStatus()} />
        <span class="as-title">Language Model</span>
        <button class="as-button as-history-toggle" title="Chat history" aria-label="Chat history" aria-expanded={historyOpen()}
          onClick={() => setHistoryOpen(value => !value)}>History</button>
        <button class="as-icon" title="New chat" aria-label="New chat" disabled={!state.ready || state.switching}
          onClick={async () => { await assistant.newChat(); setHistoryOpen(false); input?.focus(); }}><PlusIcon /></button>
        <button class="as-icon" title={`Close (${navigator.platform.startsWith("Mac") ? "Cmd" : "Ctrl"}+Shift+A)`} aria-label="Close Language Model" onClick={props.onClose}><CloseIcon /></button>
      </header>
      <div class="as-chat-heading"><span title={activeTitle()}>{activeTitle()}</span>
        <span class="as-chat-save" role="status">{!state.ready ? "Loading…" : state.switching ? "Switching…" : state.saveError ? "Not saved" : state.dirty ? "Saving…" : "Saved"}</span>
      </div>
      <Show when={state.loadError || state.saveError}>
        <div class="as-setup" role="alert"><p>{state.loadError || state.saveError}</p>
          <button class="as-button" onClick={() => void (state.loadError ? assistant.load() : assistant.flush()).catch(() => {})}>Retry</button>
        </div>
      </Show>
      <Show when={historyOpen()}>
        <section class="as-history" aria-label="Saved chats" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setHistoryOpen(false); } }}>
          <input class="as-history-search" type="search" aria-label="Search chats" placeholder="Search chats" value={historyQuery()} onInput={e => setHistoryQuery(e.currentTarget.value)} />
          <ul class="as-chat-list">
            <For each={visibleChats()} fallback={<li class="as-hint">No matching chats.</li>}>{chat => <li class="as-chat-row" classList={{ "as-chat-active": state.activeId === chat.id }}>
              <button class="as-chat-pick" aria-current={state.activeId === chat.id ? "true" : undefined} disabled={state.switching || !state.ready} onClick={() => void switchChat(chat.id)}>
                <strong>{chat.title}</strong><span>{chat.preview}</span>
                <small>{chat.running ? "Replying…" : new Date(chat.updatedAt).toLocaleDateString()} · {chat.model || "Default model"}</small>
              </button>
              <div class="as-chat-actions">
                <button class="as-button" disabled={state.switching} aria-label={`Rename chat ${chat.title}`} onClick={() => { setRenaming(chat.id); setChatTitle(chat.title); setDeleting(null); }}>Rename</button>
                <button class="as-button" disabled={state.switching} aria-label={`Delete chat ${chat.title}`} onClick={() => { setDeleting(chat.id); setRenaming(null); }}>Delete</button>
              </div>
              <Show when={renaming() === chat.id}>
                <form class="as-chat-rename" onSubmit={e => { e.preventDefault(); assistant.renameChat(chat.id, chatTitle()); setRenaming(null); }}>
                  <input aria-label="Chat title" required maxlength={120} value={chatTitle()} ref={el => queueMicrotask(() => { el.focus(); el.select(); })} onInput={e => setChatTitle(e.currentTarget.value)} />
                  <button class="as-button" disabled={!chatTitle().trim() || state.switching}>Save</button>
                  <button class="as-button" type="button" onClick={() => setRenaming(null)}>Cancel</button>
                </form>
              </Show>
              <Show when={deleting() === chat.id}>
                <div class="as-chat-confirm" role="group" aria-label={`Delete chat ${chat.title}?`}>
                  <p>Delete this saved chat? Your notes are kept.</p>
                  <button class="as-button" disabled={state.switching} onClick={async () => { await assistant.deleteChat(chat.id); setDeleting(null); }}>Delete chat</button>
                  <button class="as-button" disabled={state.switching} onClick={() => setDeleting(null)}>Keep</button>
                </div>
              </Show>
            </li>}</For>
          </ul>
        </section>
      </Show>
      <Show when={state.running || showDone()}>
        <div class={`as-timer as-timer-${timerPhase()}`}>
          <span class="as-timer-dot" aria-hidden="true" />
          <span role="status">{timerLabel()}</span>
          <span class="as-timer-time" aria-hidden="true">{timerTime()}</span>
        </div>
      </Show>

      <Show when={needsSetup() || state.connection === "error"}>
        <div class="as-setup" role="alert">
          <p>{state.connectionDetail || connection().label}</p>
          <Show when={state.connection === "logged-out"}><p class="as-hint">In a terminal, run <code>claude</code> and sign in with your Claude account, then check again.</p></Show>
          <button class="as-button" onClick={() => void assistant.refreshStatus()}>Check again</button>
        </div>
      </Show>

      <div class="as-transcript" role="log" aria-live="polite" ref={transcript}>
        <For each={state.entries}>{entryView}</For>
      </div>

      <form class="as-composer" onSubmit={submit}>
        <div class="as-input">
          <textarea ref={input} data-assistant-input rows={1} value={draft()}
            aria-label="Message assistant" aria-keyshortcuts="Enter" disabled={!state.ready || state.switching}
            onInput={e => { setDraft(e.currentTarget.value); syncCaret(); }}
            onFocus={() => syncCaret(false)} onBlur={() => setCaret(null)}
            onScroll={() => syncCaret(false)} onKeyUp={() => syncCaret(false)} onClick={() => syncCaret()}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey && !e.isComposing) submit(e);
              else if (e.key === "Escape" && state.running) { e.preventDefault(); assistant.stop(); }
            }} />
          <Show when={caret()}>{position =>
            <div class="as-caret-layer" aria-hidden="true">
              <div style={{ transform: `translateY(${-position().scroll}px)` }}>
                {draft().slice(0, position().index)}
                <span class="as-caret" classList={{ "as-caret-waiting": !draft(), "as-caret-typing": typing() }}>
                  <Show when={!draft()}>
                    <For each={CARET_GHOSTS}>{i => <span class="as-caret-ghost" style={{ "--i": i, opacity: 1 - i / (CARET_GHOSTS.length + 1) }} />}</For>
                  </Show>
                </span>
                {draft().slice(position().index)}
              </div>
            </div>
          }</Show>
        </div>
        <div class="as-composer-bar">
          <span class="as-picker">
            <select class="as-select" aria-label="Model" title="Model" value={state.model} disabled={state.running || !state.ready || state.switching}
              onFocus={() => { if (!state.running) void assistant.refreshStatus(); }}
              onChange={e => assistant.setModel(e.currentTarget.value)}>
              <optgroup label="Claude (Claude Code)">
                <For each={ASSISTANT_MODELS}>{m => <option value={m.id}>{m.label}</option>}</For>
              </optgroup>
              <optgroup label="Local (Ollama)">
                <For each={state.localModels} fallback={<option disabled value="">No local models found</option>}>{m =>
                  <option value={`${LOCAL_PREFIX}${m.name}`}>{m.name}{m.parameterSize ? ` · ${m.parameterSize}` : ""}{m.tools ? "" : " · chat only"}</option>
                }</For>
              </optgroup>
              <Show when={!ASSISTANT_MODELS.some(m => m.id === state.model) && !state.localModels.some(m => `${LOCAL_PREFIX}${m.name}` === state.model)}>
                <option value={state.model}>{isLocalModel(state.model) ? `${state.model.slice(LOCAL_PREFIX.length)} (not installed)` : state.model}</option>
              </Show>
            </select>
          </span>
          <span class="as-picker">
            <select class="as-select" aria-label="Effort" title={isLocalModel(state.model) ? "Effort: Low turns the local model's thinking off; higher levels let it think first" : supportsEffort(state.model) ? "Effort: how much Claude thinks before answering" : "This model has no effort control"}
              value={state.effort} disabled={state.running || !state.ready || state.switching || !supportsEffort(state.model)}
              onChange={e => assistant.setEffort(e.currentTarget.value as Effort)}>
              <For each={EFFORTS}>{effort => <option value={effort}>{EFFORT_LABEL[effort]}</option>}</For>
            </select>
          </span>
          <span class="as-spacer" />
          <Show when={state.running} fallback={
            <button class="as-send" type="submit" title="Send (Enter)" aria-label="Send" disabled={!canSend()}><SendIcon /></button>
          }>
            <button class="as-send as-stop" type="button" title="Stop (Esc)" aria-label="Stop" onClick={assistant.stop}><StopIcon /></button>
          </Show>
        </div>
      </form>
      <Show when={state.usage.input || state.usage.output}>
        <div class="as-usage">{state.usage.input.toLocaleString()} in · {state.usage.output.toLocaleString()} out · {state.usage.cacheRead.toLocaleString()} cached tokens</div>
      </Show>
    </aside>
  );
}
