import { For, Show, createSignal, onMount, type Component } from "solid-js";
import { useBuster } from "../lib/buster-context";
import { isReady, PROVIDERS, type AgentProvider } from "../lib/agent-connection";

/**
 * Connection cards for the headless assistants.
 *
 * Sign-in belongs to each CLI, so this panel never asks for a credential. A
 * connection is only called ready once its CLI reports an account.
 */
const AgentConnections: Component = () => {
  const { agent, commands } = useBuster();
  const [message, setMessage] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [probeId, setProbeId] = createSignal("");

  async function run(command: string, args: Record<string, unknown> = {}) {
    if (busy()) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await commands.dispatch({ requestId: crypto.randomUUID(), command, args }, "user");
      if (!result.ok) setMessage(result.error.message);
      return result;
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  onMount(() => { void run("agent detect"); });

  const status = (provider: AgentProvider) => agent.status(provider);
  const active = () => agent.state.active;
  const probe = () => (probeId() ? agent.state.runs[probeId()] : undefined);

  function cancelProbe() {
    const id = probeId();
    if (id) return run("agent cancel", { requestId: id });
  }

  /**
   * A harmless round trip that also proves the tool loop: the assistant must
   * reach back into BusterMark through the local MCP server to answer.
   */
  async function verify(provider: AgentProvider) {
    const id = `probe-${crypto.randomUUID()}`;
    setProbeId(id);
    await run("agent send", {
      requestId: id,
      provider,
      prompt: "Call the document_list tool. Reply with only the number of open notes.",
    });
  }

  return (
    <div class="ai-settings-panel">
      <div class="ai-settings-header">
        <h1>Assistants</h1>
        <p class="ai-settings-subtitle">
          BusterMark drives the Claude Code and Codex command-line tools. Each one manages its own
          sign-in, so no account details are stored here.
        </p>
      </div>

      <div class="ai-settings-section">
        <div class="ai-settings-row">
          <div class="ai-settings-label">
            <div class="ai-settings-title">Installed assistants</div>
            <div class="ai-settings-desc">Checks the CLI and its sign-in. Makes no model request. <strong>Test</strong> sends one real request and costs a little.</div>
          </div>
          <button disabled={busy()} onClick={() => void run("agent detect")}>
            {agent.state.detecting ? "Checking…" : "Recheck"}
          </button>
        </div>
      </div>

      <For each={PROVIDERS}>{provider => {
        const item = () => status(provider);
        const connected = () => active() === provider;
        return (
          <div class="ai-settings-section">
            <div class="ai-settings-row">
              <div class="ai-settings-label">
                <div class="ai-settings-title">
                  {item()?.label ?? provider}
                  <Show when={connected()}><span> · connected</span></Show>
                </div>
                <div class="ai-settings-desc">
                  <Show when={item()} fallback="Not checked yet.">
                    <Show when={isReady(item())} fallback={item()!.problem ?? "Unavailable."}>
                      Signed in{item()!.account ? ` with ${item()!.account}` : ""}
                      {item()!.version ? ` · ${item()!.version}` : ""}
                    </Show>
                  </Show>
                </div>
              </div>
              <div class="ai-provider-buttons">
                <Show
                  when={connected()}
                  fallback={
                    <button disabled={busy() || !isReady(item())} onClick={() => void run("agent connect", { provider })}>
                      Connect
                    </button>
                  }
                >
                  <button disabled={busy()} onClick={() => void run("agent disconnect")}>Disconnect</button>
                </Show>
                <button disabled={busy() || !isReady(item())} onClick={() => void verify(provider)}>
                  Test
                </button>
              </div>
            </div>
            <Show when={item()?.binary_path}>
              <div class="ai-settings-desc" title={item()!.binary_path!}>{item()!.binary_path}</div>
            </Show>
          </div>
        );
      }}</For>

      <Show when={probe()}>{current => (
        <div class="ai-settings-section">
          <div class="ai-settings-title">Test request</div>
          <div class="ai-settings-desc" role="status">
            {current().state === "running"
              ? "Waiting for a reply…"
              : `${current().state}${current().error ? `: ${current().error}` : ""}`}
          </div>
          <Show when={current().transcript}><pre>{current().transcript}</pre></Show>
          <Show when={current().tools.length} fallback={
            <Show when={current().state === "completed"}>
              <div class="ai-settings-desc">The assistant answered without calling a BusterMark tool.</div>
            </Show>
          }>
            <div class="ai-settings-desc">Tools used: {current().tools.join(", ")}</div>
          </Show>
          <Show when={current().state === "running"}>
            <button onClick={() => void cancelProbe()}>Cancel</button>
          </Show>
        </div>
      )}</Show>

      <Show when={message()}><p class="ai-settings-desc" role="alert">{message()}</p></Show>
    </div>
  );
};

export default AgentConnections;
