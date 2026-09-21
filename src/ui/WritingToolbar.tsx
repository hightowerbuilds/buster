import { createMemo, createSignal, For, Show, onMount, type Component } from "solid-js";
import { useBuster } from "../lib/buster-context";
import type { FormatTarget } from "../lib/writing-format";
import "./WritingToolbar.css";

const WritingToolbar: Component<{ requestPortal: (target?: FormatTarget) => void }> = props => {
  const { store, formatting, commands, actions } = useBuster();
  const [message, setMessage] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [mounted, setMounted] = createSignal(false);
  onMount(() => queueMicrotask(() => setMounted(true)));
  let captured: FormatTarget | undefined;
  let toolbar!: HTMLDivElement;
  const current = createMemo(() => {
    // Cursor reports and the injected engine registry revision refresh availability after mounting.
    void mounted(); void store.cursorLine; void store.cursorCol; void store.fileLoading;
    try { return formatting.inspect(store.paneWorkspace.activePaneId); } catch { return undefined; }
  });
  const remember = () => { try { captured = formatting.capture(store.paneWorkspace.activePaneId); } catch { captured = undefined; } };
  function returnToNote(target = captured) {
    if (!target || !store.paneWorkspace.panes.some(p => p.id === target.paneId && p.tabId === target.tabId)) return;
    actions.panes.focusPane(target.paneId);
    const host = [...document.querySelectorAll<HTMLElement>("[data-tab-panel-id]")].find(el => el.dataset.tabPanelId === target.tabId);
    host?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
  }
  async function run(command: string, extra: Record<string, unknown> = {}) {
    if (!captured) remember();
    const target = captured;
    if (!target) { setMessage("Return to a Markdown note to format your writing."); return; }
    setBusy(true); setMessage("");
    try {
      const result = await commands.dispatch({ command, args: { target, ...extra }, requestId: crypto.randomUUID() }, "user");
      if (!result.ok) setMessage(result.error.message);
      else { captured = formatting.capture(target.paneId); returnToNote(captured); }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }
  const pressed = (state: boolean | "mixed" | undefined) => state === "mixed" ? "mixed" as const : !!state;
  const unavailable = () => !current() || busy();
  const note = () => store.tabs.find(t => t.id === current()?.target.tabId)?.name;
  return <div class="writing-format-bar" ref={toolbar} role="toolbar" aria-label="Markdown formatting"
    onPointerDown={() => { if (!toolbar.contains(document.activeElement)) remember(); }}
    onFocusIn={e => { if (!toolbar.contains(e.relatedTarget as Node | null)) remember(); }}
    onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); returnToNote(); } }}>
    <label class="writing-heading-label"><span class="sr-only">Heading level</span>
      <select aria-label="Heading level" title="Paragraph or heading for the selected lines" disabled={unavailable()}
        value={String(current()?.heading ?? 0)} onChange={e => { const value = e.currentTarget.value; if (value !== "mixed") void run("format heading", { level: Number(value) }); }}>
        <option value="mixed" disabled>Mixed headings</option><option value="0">Paragraph</option>
        <For each={[1, 2, 3, 4, 5, 6]}>{level => <option value={level}>Heading {level}</option>}</For>
      </select>
    </label>
    <button disabled={unavailable()} title="Toggle bold — paired ** markers" aria-label="Bold" aria-pressed={pressed(current()?.bold)} onClick={() => void run("format bold")}><strong>B</strong></button>
    <button disabled={unavailable()} title="Toggle italic — paired * markers" aria-label="Italic" aria-pressed={pressed(current()?.italic)} onClick={() => void run("format italic")}><em>I</em></button>
    <button disabled={unavailable()} title="Toggle unordered list" aria-label="Unordered list" aria-pressed={current()?.list === "mixed" ? "mixed" : current()?.list === "unordered"} onClick={() => void run("format list", { kind: "unordered" })}>• List</button>
    <button disabled={unavailable()} title="Toggle ordered list" aria-label="Ordered list" aria-pressed={current()?.list === "mixed" ? "mixed" : current()?.list === "ordered"} onClick={() => void run("format list", { kind: "ordered" })}>1. List</button>
    <button class="writing-search-button" title="Open AI search; review scope and context before searching" onClick={() => props.requestPortal(captured || current()?.target)}>AI search</button>
    <Show when={current()} fallback={<span class="writing-format-hint">Choose a Markdown note to format.</span>}><span class="writing-format-hint" title={note()}>{note()}</span></Show>
    <Show when={message()}><span class="writing-format-error" role="alert">{message()} <button onClick={() => { remember(); returnToNote(); setMessage(""); }}>Return to note</button></span></Show>
  </div>;
};
export default WritingToolbar;
