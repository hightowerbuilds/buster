import { Show, createEffect, createSignal } from "solid-js";
import { useBuster } from "../lib/buster-context";
import "../styles/writing-review.css";

export default function WritingReviewPanel(props: { reviewId: string }) {
  const { store, actions, commands, writing } = useBuster();
  const review = () => writing.reviews[props.reviewId];
  const [model, setModel] = createSignal("");
  const [instruction, setInstruction] = createSignal("Rewrite this passage for clarity while preserving its meaning and voice. Return only the revised passage.");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const provider = () => store.settings.ai_provider;
  const providerName = () => ({ ollama: "Ollama", anthropic: "Anthropic", openai: "OpenAI" })[provider()] ?? provider();
  createEffect(() => setModel(provider() === "ollama" ? store.settings.ai_local_model : store.settings.ai_model));
  const running = () => review()?.status === "running";
  const completed = () => review()?.status === "completed";
  const stale = () => review() ? writing.stale(props.reviewId) : true;
  const sourceName = () => store.tabs.find(tab => tab.id === review()?.target.tabId)?.name ?? "Closed note";
  async function run(command: string, extra: Record<string, unknown> = {}) {
    if (busy()) return;
    setBusy(true); setError("");
    try {
      const result = await commands.dispatch({ requestId: crypto.randomUUID(), command, args: { reviewId: props.reviewId, ...extra } }, "user");
      if (!result.ok) setError(result.error.message);
    } finally { setBusy(false); }
  }
  const preset = (value: string) => {
    const instructions: Record<string, string> = {
      rewrite: "Rewrite this passage for clarity while preserving its meaning and voice. Return only the revised passage.",
      explain: "Explain the meaning and structure of this passage. Distinguish any uncertain interpretation.",
      summarize: "Summarize this passage faithfully and concisely. Return only the summary.",
      expand: "Expand this passage while preserving its meaning and voice. Do not invent factual claims. Return only the expanded passage.",
    };
    if (instructions[value]) setInstruction(instructions[value]);
  };
  return <Show when={review()} fallback={<div class="writing-review">This review is closed.</div>}>{item =>
    <section class="writing-review" aria-label={item().kind === "ai" ? "AI writing review" : "Dictionary lookup"}>
      <header><h2>{item().kind === "ai" ? "AI review" : "Look up"}</h2>
        <button onClick={() => void run("review discard")} disabled={busy()}>Discard</button></header>
      <p class="writing-review-meta">From {sourceName()} · line {item().target.range.anchor.line + 1}</p>
      <label>Selected passage</label>
      <blockquote>{item().target.text}</blockquote>
      <button onClick={() => void run("review source")} disabled={busy()}>Return to source</button>
      <Show when={item().kind === "ai"}>
        <div class="writing-review-provider"><span>Request provider: <strong>{providerName()}</strong></span>
          <button disabled={running()} onClick={actions.createAiTab}>AI settings</button></div>
        <label>Model<input data-tab-focus-target="true" value={model()} disabled={running() || item().status === "applied"} onInput={event => setModel(event.currentTarget.value)} spellcheck={false} /></label>
        <label>Action<select disabled={running() || item().status === "applied"} onChange={event => preset(event.currentTarget.value)}>
          <option value="rewrite">Rewrite</option><option value="explain">Explain</option><option value="summarize">Summarize</option><option value="expand">Expand</option><option value="custom">Custom instruction</option>
        </select></label>
        <label>Instruction<textarea rows={4} value={instruction()} disabled={running() || item().status === "applied"} onInput={event => setInstruction(event.currentTarget.value)} /></label>
        <p class="writing-review-meta">Generate sends only this passage and instruction to {providerName()}{provider() === "ollama" ? " at your configured Ollama server" : " over its cloud API"}. The source stays unchanged until you apply a result.</p>
        <div class="writing-review-buttons"><button class="primary" disabled={busy() || running() || stale() || !model().trim() || !instruction().trim() || item().status === "applied"}
          onClick={() => void run("review generate", { provider: provider(), model: model(), instruction: instruction() })}>{item().output ? "Generate again" : "Generate"}</button>
          <Show when={running()}><button onClick={() => void run("review cancel")} disabled={busy()}>Cancel</button></Show></div>
      </Show>
      <p class="writing-review-status" role="status">{({ ready: "Ready to generate", running: item().kind === "lookup" ? "Looking up…" : "Generating…", completed: "Ready to review", failed: "Request failed", canceled: "Canceled — source unchanged", applied: "Result used" })[item().status]}</p>
      <Show when={item().error || error()}><p class="writing-review-error" role="alert">{error() || item().error}</p></Show>
      <Show when={item().output}><label>{item().kind === "lookup" ? item().source || "Dictionary" : `Result · ${item().provider} / ${item().model}`}</label><pre class="writing-review-result" tabindex="0">{item().output}</pre></Show>
      <Show when={item().kind === "ai" && item().output}>
        <div class="writing-review-buttons">
          <button disabled={busy() || !completed() || stale()} onClick={() => void run("review apply", { mode: "replace" })}>Replace selection</button>
          <button disabled={busy() || !completed() || stale()} onClick={() => void run("review apply", { mode: "insert-after" })}>Insert after</button>
          <button disabled={busy() || !completed()} onClick={() => void run("review apply", { mode: "new-note" })}>Keep as new note</button>
        </div>
      </Show>
      <Show when={stale() && item().status !== "applied"}><p class="writing-review-meta">The source changed or closed. Select the passage again to start a new review. A completed result can still be kept as a new note.</p></Show>
      <Show when={item().kind === "ai"}><p class="writing-review-meta">Review results are temporary and close when the app restarts. Apply a result or keep it as a note to retain it.</p></Show>
    </section>
  }</Show>;
}
