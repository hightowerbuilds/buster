import { Component, For, Show, createSignal, onMount } from "solid-js";
import type { AppSettings } from "../lib/ipc";
import {
  aiCompletionOllamaModels,
  aiCompletionUsage,
  aiCompletionValidateProvider,
} from "../lib/ipc";

interface AiSettingsPanelProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

const PROVIDERS = [
  { id: "ollama", label: "Ollama (Local)" },
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
];

const AiSettingsPanel: Component<AiSettingsPanelProps> = (props) => {
  const [ollamaStatus, setOllamaStatus] = createSignal<"checking" | "connected" | "disconnected">("checking");
  const [ollamaModels, setOllamaModels] = createSignal<string[]>([]);
  const [validationStatus, setValidationStatus] = createSignal<"idle" | "checking" | "ok" | "error">("idle");
  const [validationMessage, setValidationMessage] = createSignal("");
  const [usage, setUsage] = createSignal<{ estimated_tokens: number; monthly_budget: number } | null>(null);

  function update(patch: Partial<AppSettings>) {
    props.onChange({ ...props.settings, ...patch });
  }

  async function refreshOllamaModels() {
    setOllamaStatus("checking");
    try {
      const models = await aiCompletionOllamaModels(props.settings.ai_ollama_url);
      setOllamaModels(models);
      setOllamaStatus("connected");
    } catch {
      setOllamaStatus("disconnected");
    }
  }

  async function validateProvider() {
    setValidationStatus("checking");
    setValidationMessage("");
    try {
      const model = props.settings.ai_provider === "ollama"
        ? props.settings.ai_local_model
        : props.settings.ai_model;
      const result = await aiCompletionValidateProvider({
        provider: props.settings.ai_provider,
        api_key: props.settings.ai_api_key,
        model,
        ollama_url: props.settings.ai_ollama_url,
      });
      setValidationStatus(result.ok ? "ok" : "error");
      setValidationMessage(result.message);
    } catch (err) {
      setValidationStatus("error");
      setValidationMessage(err instanceof Error ? err.message : String(err));
    }
  }

  function toggleDisabledLanguage(languageId: string) {
    const disabled = new Set(props.settings.ai_disabled_languages ?? []);
    if (disabled.has(languageId)) disabled.delete(languageId);
    else disabled.add(languageId);
    update({ ai_disabled_languages: [...disabled].sort() });
  }

  onMount(() => {
    refreshOllamaModels();
    aiCompletionUsage().then(setUsage).catch(() => {});
  });

  return (
    <div class="ai-settings-panel">
      <div class="ai-settings-header">
        <h2>AI Settings</h2>
        <p class="ai-settings-subtitle">Configure the connection used by writing review and optional inline suggestions. Writing review sends a selection only when you choose Generate.</p>
      </div>

      <div class="ai-settings-section">
        <div class="ai-settings-row">
          <div class="ai-settings-label">
            <span class="ai-settings-title">Enable inline suggestions</span>
            <span class="ai-settings-desc">Automatically send surrounding text as you type. Writing review works with this off.</span>
          </div>
          <button
            class={`ai-toggle ${props.settings.ai_completion_enabled ? "ai-toggle-on" : ""}`}
            onClick={() => update({ ai_completion_enabled: !props.settings.ai_completion_enabled })}
          >
            {props.settings.ai_completion_enabled ? "ON" : "OFF"}
          </button>
        </div>
      </div>

        <div class="ai-settings-section">
          <h3>Provider</h3>
          <div class="ai-provider-buttons">
            {PROVIDERS.map(p => (
              <button
                class={`ai-provider-btn ${props.settings.ai_provider === p.id ? "ai-provider-active" : ""}`}
                onClick={() => {
                  if (props.settings.ai_provider !== p.id) update({ ai_provider: p.id, ai_api_key: "", ai_model: "" });
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <Show when={props.settings.ai_provider === "ollama"}>
          <div class="ai-settings-section">
            <h3>Local Model (Ollama)</h3>

            <div class="ai-settings-row">
              <div class="ai-settings-label">
                <span class="ai-settings-title">Status</span>
              </div>
              <div class="ai-status-actions">
                <span class={`ai-status ai-status-${ollamaStatus()}`}>
                  {ollamaStatus() === "checking" ? "Checking..." :
                   ollamaStatus() === "connected" ? "Connected" : "Not Running"}
                </span>
                <button class="ai-action-btn" onClick={refreshOllamaModels}>Refresh</button>
              </div>
            </div>

            <div class="ai-settings-row">
              <div class="ai-settings-label">
                <span class="ai-settings-title">Server URL</span>
                <span class="ai-settings-desc">Ollama API endpoint</span>
              </div>
              <input
                class="ai-input"
                type="text"
                value={props.settings.ai_ollama_url}
                onInput={(e) => update({ ai_ollama_url: e.currentTarget.value })}
                placeholder="http://localhost:11434"
              />
            </div>

            <div class="ai-settings-row">
              <div class="ai-settings-label">
                <span class="ai-settings-title">Model</span>
                <span class="ai-settings-desc">
                  {ollamaModels().length > 0
                    ? `${ollamaModels().length} model${ollamaModels().length === 1 ? "" : "s"} available`
                    : "Enter model name"}
                </span>
              </div>
              <Show when={ollamaModels().length > 0} fallback={
                <input
                  class="ai-input"
                  type="text"
                  value={props.settings.ai_local_model}
                  onInput={(e) => update({ ai_local_model: e.currentTarget.value })}
                  placeholder="gemma3:4b"
                />
              }>
                <select
                  class="ai-select"
                  value={props.settings.ai_local_model}
                  onChange={(e) => update({ ai_local_model: e.currentTarget.value })}
                >
                  {ollamaModels().map(m => (
                    <option value={m}>{m}</option>
                  ))}
                </select>
              </Show>
            </div>
          </div>
        </Show>

        <Show when={props.settings.ai_provider === "anthropic"}>
          <div class="ai-settings-section">
            <h3>Anthropic</h3>

            <div class="ai-settings-row">
              <div class="ai-settings-label">
                <span class="ai-settings-title">API Key</span>
                <span class="ai-settings-desc">Enter to replace your Anthropic key. Saved keys remain in macOS Keychain.</span>
              </div>
              <input
                class="ai-input ai-input-key"
                type="password"
                value={props.settings.ai_api_key}
                onInput={(e) => update({ ai_api_key: e.currentTarget.value })}
                placeholder="sk-ant-..."
              />
            </div>

            <div class="ai-settings-row">
              <div class="ai-settings-label">
                <span class="ai-settings-title">Model</span>
                <span class="ai-settings-desc">Model ID available to your account</span>
              </div>
              <input
                class="ai-input"
                value={props.settings.ai_model}
                onInput={(e) => update({ ai_model: e.currentTarget.value })}
                placeholder="Enter model ID"
              />
            </div>
          </div>
        </Show>

        <Show when={props.settings.ai_provider === "openai"}>
          <div class="ai-settings-section">
            <h3>OpenAI</h3>

            <div class="ai-settings-row">
              <div class="ai-settings-label">
                <span class="ai-settings-title">API Key</span>
                <span class="ai-settings-desc">Enter to replace your OpenAI key. Saved keys remain in macOS Keychain.</span>
              </div>
              <input
                class="ai-input ai-input-key"
                type="password"
                value={props.settings.ai_api_key}
                onInput={(e) => update({ ai_api_key: e.currentTarget.value })}
                placeholder="sk-..."
              />
            </div>

            <div class="ai-settings-row">
              <div class="ai-settings-label">
                <span class="ai-settings-title">Model</span>
              </div>
              <input
                class="ai-input"
                value={props.settings.ai_model}
                onInput={(e) => update({ ai_model: e.currentTarget.value })}
                placeholder="Enter model ID"
              />
            </div>
          </div>
        </Show>

      <Show when={props.settings.ai_completion_enabled}>
        <div class="ai-settings-section">
          <h3>Inline suggestion behavior</h3>

          <div class="ai-settings-row">
            <div class="ai-settings-label">
              <span class="ai-settings-title">Stop On Newline</span>
              <span class="ai-settings-desc">Keep inline suggestions to one line</span>
            </div>
            <button
              class={`ai-toggle ${props.settings.ai_stop_on_newline ? "ai-toggle-on" : ""}`}
              onClick={() => update({ ai_stop_on_newline: !props.settings.ai_stop_on_newline })}
            >
              {props.settings.ai_stop_on_newline ? "ON" : "OFF"}
            </button>
          </div>

          <div class="ai-settings-row">
            <div class="ai-settings-label">
              <span class="ai-settings-title">Local Debounce</span>
              <span class="ai-settings-desc">Milliseconds before Ollama requests</span>
            </div>
            <input
              class="ai-input ai-input-small"
              type="number"
              min="0"
              max="5000"
              step="100"
              value={props.settings.ai_debounce_local_ms}
              onInput={(e) => update({ ai_debounce_local_ms: Number(e.currentTarget.value) || 0 })}
            />
          </div>

          <div class="ai-settings-row">
            <div class="ai-settings-label">
              <span class="ai-settings-title">Cloud Debounce</span>
              <span class="ai-settings-desc">Milliseconds before cloud requests</span>
            </div>
            <input
              class="ai-input ai-input-small"
              type="number"
              min="0"
              max="5000"
              step="100"
              value={props.settings.ai_debounce_cloud_ms}
              onInput={(e) => update({ ai_debounce_cloud_ms: Number(e.currentTarget.value) || 0 })}
            />
          </div>

          <div class="ai-settings-row">
            <div class="ai-settings-label">
              <span class="ai-settings-title">Minimum Prefix</span>
              <span class="ai-settings-desc">Non-whitespace characters before requesting</span>
            </div>
            <input
              class="ai-input ai-input-small"
              type="number"
              min="0"
              max="80"
              step="1"
              value={props.settings.ai_min_prefix_chars}
              onInput={(e) => update({ ai_min_prefix_chars: Number(e.currentTarget.value) || 0 })}
            />
          </div>

          <div class="ai-settings-row">
            <div class="ai-settings-label">
              <span class="ai-settings-title">Completion Cache</span>
              <span class="ai-settings-desc">Reuse recent matching suggestions</span>
            </div>
            <button
              class={`ai-toggle ${props.settings.ai_cache_enabled ? "ai-toggle-on" : ""}`}
              onClick={() => update({ ai_cache_enabled: !props.settings.ai_cache_enabled })}
            >
              {props.settings.ai_cache_enabled ? "ON" : "OFF"}
            </button>
          </div>

          <Show when={props.settings.ai_cache_enabled}>
            <div class="ai-settings-row">
              <div class="ai-settings-label">
                <span class="ai-settings-title">Cache Size</span>
                <span class="ai-settings-desc">Number of suggestions to keep</span>
              </div>
              <input
                class="ai-input ai-input-small"
                type="number"
                min="0"
                max="100"
                step="1"
                value={props.settings.ai_cache_size}
                onInput={(e) => update({ ai_cache_size: Number(e.currentTarget.value) || 0 })}
              />
            </div>
          </Show>
        </div>

        <div class="ai-settings-section">
          <h3>Languages</h3>
          <div class="ai-language-grid">
            <For each={[
              ["typescript", "TypeScript"],
              ["javascript", "JavaScript"],
              ["rust", "Rust"],
              ["python", "Python"],
              ["go", "Go"],
              ["html", "HTML"],
              ["css", "CSS"],
              ["json", "JSON"],
              ["markdown", "Markdown"],
            ]}>
              {([id, label]) => {
                const enabled = () => !(props.settings.ai_disabled_languages ?? []).includes(id);
                return (
                  <button
                    class={`ai-language-btn ${enabled() ? "ai-language-enabled" : ""}`}
                    onClick={() => toggleDisabledLanguage(id)}
                  >
                    {label}
                  </button>
                );
              }}
            </For>
          </div>
        </div>

        <div class="ai-settings-section">
          <h3>Validation & Usage</h3>
          <div class="ai-settings-row">
            <div class="ai-settings-label">
              <span class="ai-settings-title">Provider Check</span>
              <span class="ai-settings-desc">{validationMessage() || "Validate the current provider configuration"}</span>
            </div>
            <button class="ai-action-btn" disabled={validationStatus() === "checking"} onClick={validateProvider}>
              {validationStatus() === "checking" ? "Checking..." : "Validate"}
            </button>
          </div>

          <div class="ai-settings-row">
            <div class="ai-settings-label">
              <span class="ai-settings-title">Monthly inline suggestion budget</span>
              <span class="ai-settings-desc">
                {usage()
                  ? `${usage()!.estimated_tokens} estimated tokens used`
                  : "Estimated from streamed completion text"}. Writing review requests are excluded.
              </span>
            </div>
            <input
              class="ai-input ai-input-small"
              type="number"
              min="0"
              step="1000"
              value={props.settings.ai_token_budget_monthly}
              onInput={(e) => update({ ai_token_budget_monthly: Number(e.currentTarget.value) || 0 })}
            />
          </div>
        </div>

        <div class="ai-settings-section ai-settings-info">
          <h3>How it works</h3>
          <p>After you stop typing, BusterMark sends the surrounding code context to your chosen AI provider. Suggestions appear as ghost text — press <kbd>Tab</kbd> to accept or keep typing to dismiss.</p>
          <p>
            <strong>Ollama models</strong> run at your configured server address. Use a local address to keep requests on your machine.
            <br />
            <strong>Cloud models</strong> send code context to the provider's API. On macOS, your API key is stored in Keychain.
          </p>
        </div>
      </Show>
    </div>
  );
};

export default AiSettingsPanel;
