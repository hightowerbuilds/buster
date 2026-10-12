import { WebSearchSettings } from "./WebSearchSettings";
import { Component, For, Show, createSignal, onMount } from "solid-js";
import type { AppSettings } from "../lib/ipc";
import { AI_PROVIDERS, aiProvidersStatus, type AiProvider, type ProviderStatus } from "../lib/ai-oneshot";

interface AiSettingsPanelProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

/** Writing actions (Rephrase, AI review) run on the writer's own AI command-line tool and subscription. */
const AiSettingsPanel: Component<AiSettingsPanelProps> = (props) => {
  const [statuses, setStatuses] = createSignal<ProviderStatus[] | null>(null);
  const [checking, setChecking] = createSignal(false);

  async function refresh() {
    setChecking(true);
    try { setStatuses(await aiProvidersStatus()); }
    catch { setStatuses([]); }
    finally { setChecking(false); }
  }
  onMount(() => void refresh());

  const status = (provider: AiProvider) => statuses()?.find(entry => entry.provider === provider);
  const state = (provider: AiProvider) => {
    const entry = status(provider);
    if (!entry) return { tone: "checking", text: "Checking…" };
    if (!entry.installed) return { tone: "disconnected", text: "Not installed" };
    if (!entry.signedIn) return { tone: "disconnected", text: "Not signed in" };
    return { tone: "connected", text: "Ready" };
  };

  return (
    <div class="ai-settings-panel">
      <div class="ai-settings-header">
        <h2>AI Settings</h2>
        <p class="ai-settings-subtitle">Rephrase and AI review run on your own AI command-line tool and subscription. Nothing is sent until you choose an action, and then only the selected passage goes.</p>
      </div>

      <div class="ai-settings-section">
        <h3>Provider</h3>
        <div class="ai-provider-buttons" role="radiogroup" aria-label="AI provider">
          <For each={AI_PROVIDERS}>{provider =>
            <button role="radio" aria-checked={props.settings.ai_provider === provider.id}
              class={`ai-provider-btn ${props.settings.ai_provider === provider.id ? "ai-provider-active" : ""}`}
              onClick={() => props.onChange({ ...props.settings, ai_provider: provider.id })}>
              {provider.name}
            </button>}
          </For>
        </div>
      </div>

      <div class="ai-settings-section">
        <For each={AI_PROVIDERS}>{provider =>
          <div class="ai-settings-row">
            <div class="ai-settings-label">
              <span class="ai-settings-title">{provider.name} <span class="ai-settings-desc">· {provider.company}</span></span>
              <Show when={status(provider.id)?.detail}><span class="ai-settings-desc">{status(provider.id)!.detail}</span></Show>
            </div>
            <span class={`ai-status ai-status-${state(provider.id).tone}`}>{state(provider.id).text}</span>
          </div>}
        </For>
        <div class="ai-status-actions">
          <button class="ai-action-btn" disabled={checking()} onClick={() => void refresh()}>{checking() ? "Checking…" : "Check again"}</button>
        </div>
      </div>

      <div class="ai-settings-section ai-settings-info">
        <p><strong>Claude</strong> runs through Claude Code on your Claude subscription. Rephrase starts with Haiku 5.5 and can step up to Sonnet 5.5, then Opus 5.5.</p>
        <p><strong>Codex</strong> runs through the Codex CLI on your ChatGPT plan, read-only, stepping up its reasoning effort from low to high.</p>
        <p><strong>OpenCode</strong> runs your default OpenCode model with every tool turned off.</p>
        <p>Each request starts the tool once, in an empty folder, with no access to your notes or files.</p>
      </div>

      <WebSearchSettings />
    </div>
  );
};

export default AiSettingsPanel;
