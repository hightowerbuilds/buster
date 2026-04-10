import { Component, For, Show } from "solid-js";
import type { Accessor, Setter } from "solid-js";
import { ALL_MODELS } from "./ai-models";
import ApiKeysPanel from "./ApiKeysPanel";

interface ModelGalleryProps {
  modelQueue: Accessor<string[]>;
  setModelQueue: Setter<string[]>;
  activeModelId: Accessor<string>;
  setActiveModelId: Setter<string>;
  onFlipBack: () => void;
  hasKey: () => boolean;
  saveKeyMutation: { mutate: (key: string) => void };
  settings?: import("../lib/ipc").AppSettings;
  onSettingsChange?: (settings: import("../lib/ipc").AppSettings) => void;
}

const ModelGallery: Component<ModelGalleryProps> = (props) => {
  const queuedModels = () => props.modelQueue().map(id => ALL_MODELS.find(m => m.id === id)!).filter(Boolean);

  function addToQueue(modelId: string) {
    if (!props.modelQueue().includes(modelId)) {
      props.setModelQueue(prev => [...prev, modelId]);
    }
  }

  function removeFromQueue(modelId: string) {
    props.setModelQueue(prev => {
      const next = prev.filter(id => id !== modelId);
      if (next.length === 0) return prev;
      if (props.activeModelId() === modelId) props.setActiveModelId(next[0]);
      return next;
    });
  }

  function selectModel(modelId: string) {
    props.setActiveModelId(modelId);
  }

  return (
    <div class="ai-card-face ai-card-back">
      <div class="ai-gallery-header">
        <span class="ai-gallery-title">Models</span>
        <button class="ai-flip-btn" onClick={props.onFlipBack}>Back to Chat</button>
      </div>

      {/* Current queue */}
      <div class="ai-gallery-section-label">Your Queue</div>
      <div class="ai-queue">
        <For each={queuedModels()}>
          {(model) => (
            <div
              class={`ai-queue-item${props.activeModelId() === model.id ? " ai-queue-active" : ""}`}
              onClick={() => selectModel(model.id)}
            >
              <span class="ai-queue-item-label">{model.label}</span>
              <span class="ai-queue-item-provider">{model.provider}</span>
              <Show when={props.modelQueue().length > 1}>
                <button class="ai-queue-remove" onClick={() => removeFromQueue(model.id)}>x</button>
              </Show>
            </div>
          )}
        </For>
      </div>

      {/* All models grid */}
      <div class="ai-gallery-section-label">All Models</div>
      <div class="ai-gallery-grid">
        <For each={ALL_MODELS}>
          {(model) => {
            const inQueue = () => props.modelQueue().includes(model.id);
            return (
              <div class={`ai-gallery-card${inQueue() ? " ai-gallery-card-queued" : ""}`}>
                <div class="ai-gallery-card-provider">{model.provider}</div>
                <div class="ai-gallery-card-name">{model.label}</div>
                <div class="ai-gallery-card-desc">{model.desc}</div>
                <Show when={!inQueue()}>
                  <button class="ai-gallery-add" onClick={() => addToQueue(model.id)}>Add</button>
                </Show>
                <Show when={inQueue()}>
                  <span class="ai-gallery-in-queue">In Queue</span>
                </Show>
              </div>
            );
          }}
        </For>
      </div>

      {/* API Keys */}
      <ApiKeysPanel
        hasKey={props.hasKey}
        saveKeyMutation={props.saveKeyMutation}
      />

      {/* Agent Limits */}
      <Show when={props.settings && props.onSettingsChange}>
        <div class="ai-gallery-section-label">Agent Limits</div>
        <div class="ai-agent-limits">
          <For each={[
            { key: "agent_max_tool_calls" as const, label: "Tool Calls", desc: "Max tool calls per session", min: 5, max: 200, step: 5 },
            { key: "agent_max_writes" as const, label: "File Writes", desc: "Max file writes per session", min: 1, max: 50, step: 1 },
            { key: "agent_max_commands" as const, label: "Commands", desc: "Max shell commands per session", min: 1, max: 20, step: 1 },
            { key: "agent_timeout_secs" as const, label: "Timeout", desc: "Session timeout in seconds", min: 60, max: 1800, step: 30 },
          ]}>
            {(item) => {
              const val = () => (props.settings![item.key] as number) ?? item.min;
              return (
                <div class="ai-agent-limit-row">
                  <div class="ai-agent-limit-info">
                    <span class="ai-agent-limit-label">{item.label}</span>
                    <span class="ai-agent-limit-desc">{item.desc}</span>
                  </div>
                  <div class="ai-agent-limit-controls">
                    <button
                      class="ai-agent-limit-btn"
                      onClick={() => {
                        const v = val() - item.step;
                        if (v >= item.min) props.onSettingsChange!({ ...props.settings!, [item.key]: v });
                      }}
                    >-</button>
                    <span class="ai-agent-limit-value">{val()}</span>
                    <button
                      class="ai-agent-limit-btn"
                      onClick={() => {
                        const v = val() + item.step;
                        if (v <= item.max) props.onSettingsChange!({ ...props.settings!, [item.key]: v });
                      }}
                    >+</button>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default ModelGallery;
