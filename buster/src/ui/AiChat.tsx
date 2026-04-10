import { Component, createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { aiApproveTool, aiCancel } from "../lib/ipc";
import type { AgentEvent } from "../lib/ipc";
import { useApiKeyQuery, useSaveApiKeyMutation, useAiChatMutation } from "../lib/ai-queries";
import { ALL_MODELS } from "./ai-models";
import ModelGallery from "./ModelGallery";

interface AiChatProps {
  active: boolean;
  workspaceRoot?: string;
  settings?: import("../lib/ipc").AppSettings;
  onSettingsChange?: (settings: import("../lib/ipc").AppSettings) => void;
}

interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
}

interface PendingApproval {
  requestId: string;
  toolName: string;
  toolInput: string;
}

const AiChat: Component<AiChatProps> = (props) => {
  let inputRef: HTMLTextAreaElement | undefined;
  let scrollRef: HTMLDivElement | undefined;

  // TanStack Query for API key
  const apiKeyQuery = useApiKeyQuery();
  const saveKeyMutation = useSaveApiKeyMutation();
  const chatMutation = useAiChatMutation();

  const hasKey = () => !!apiKeyQuery.data;
  const apiKey = () => apiKeyQuery.data ?? "";

  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [input, setInput] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [pendingApproval, setPendingApproval] = createSignal<PendingApproval | null>(null);

  // Flip state + model queue
  const [flipped, setFlipped] = createSignal(false);
  const [modelQueue, setModelQueue] = createSignal<string[]>(["claude-sonnet-4-6"]);
  const [activeModelId, setActiveModelId] = createSignal("claude-sonnet-4-6");

  const selectedModel = () => activeModelId();
  const queuedModels = () => modelQueue().map(id => ALL_MODELS.find(m => m.id === id)!).filter(Boolean);

  function selectModel(modelId: string) {
    setActiveModelId(modelId);
  }

  let unlisten: (() => void) | null = null;

  onMount(async () => {
    unlisten = (await listen<AgentEvent>("ai-event", (event) => {
      const e = event.payload;

      switch (e.kind) {
        case "text":
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant") {
              return [...prev.slice(0, -1), { ...last, content: last.content + e.content }];
            }
            return [...prev, { role: "assistant", content: e.content }];
          });
          break;
        case "tool_call":
          setMessages((prev) => [
            ...prev,
            { role: "tool", content: `> ${e.content}`, toolName: e.tool_name || undefined },
          ]);
          break;
        case "tool_result":
          setMessages((prev) => [
            ...prev,
            { role: "tool", content: e.content, toolName: e.tool_name || undefined },
          ]);
          break;
        case "tool_approval": {
          try {
            const data = JSON.parse(e.content);
            setPendingApproval({
              requestId: data.request_id,
              toolName: data.tool_name,
              toolInput: JSON.stringify(data.tool_input, null, 2),
            });
          } catch {}
          break;
        }
        case "done":
          setLoading(false);
          break;
        case "error":
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Error: ${e.content}` },
          ]);
          setLoading(false);
          break;
      }

      requestAnimationFrame(() => {
        if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
      });
    })) as unknown as () => void;
  });

  onCleanup(() => {
    if (unlisten) unlisten();
  });

  async function sendMessage() {
    const prompt = input().trim();
    const key = apiKey().trim();
    if (!prompt || loading() || !key) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: prompt }]);
    setLoading(true);

    chatMutation.mutate({
      prompt,
      api_key: key,
      model: selectedModel(),
      workspace_root: props.workspaceRoot,
    });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function handleApproval(approved: boolean) {
    const approval = pendingApproval();
    if (!approval) return;
    setPendingApproval(null);
    try {
      await aiApproveTool(approval.requestId, approved);
    } catch {}
  }

  return (
    <div class="ai-chat" style={{ display: props.active ? "flex" : "none" }}>
      <div class={`ai-card-scene${flipped() ? " ai-flipped" : ""}`}>
        {/* ═══ FRONT: Chat ═══ */}
        <div class="ai-card-face ai-card-front">
          {/* Messages area */}
          <div class="ai-messages" ref={scrollRef}>
            <Show when={messages().length === 0}>
              <div class="ai-empty">
                <span class="ai-empty-title">{">_"} AI Agent</span>
                <Show when={hasKey()}>
                  <span class="ai-empty-hint">Ask me to read, write, search, or run commands in your workspace.</span>
                </Show>
                <Show when={!hasKey() && !apiKeyQuery.isLoading}>
                  <span class="ai-empty-hint">Connect a model to get started.</span>
                </Show>
                <Show when={apiKeyQuery.isLoading}>
                  <span class="ai-empty-hint">Loading...</span>
                </Show>
              </div>
            </Show>
            <For each={messages()}>
              {(msg) => (
                <div class={`ai-msg ai-msg-${msg.role}`}>
                  <Show when={msg.role === "user"}>
                    <span class="ai-msg-label">you</span>
                  </Show>
                  <Show when={msg.role === "assistant"}>
                    <span class="ai-msg-label">buster</span>
                  </Show>
                  <Show when={msg.role === "tool"}>
                    <span class="ai-msg-label">{msg.toolName || "tool"}</span>
                  </Show>
                  <pre class="ai-msg-content">{msg.content}</pre>
                </div>
              )}
            </For>
            <Show when={loading()}>
              <div class="ai-msg ai-msg-loading">
                <span class="ai-loading-dot">.</span>
                <span class="ai-loading-dot">.</span>
                <span class="ai-loading-dot">.</span>
              </div>
            </Show>
          </div>

          {/* Input bar */}
          <Show when={hasKey()}>
            <div class="ai-input-bar">
              <textarea
                ref={inputRef}
                class="ai-input"
                placeholder="Ask the AI agent..."
                value={input()}
                onInput={(e) => setInput(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={loading()}
              />
              <Show when={!loading()}>
                <button class="ai-send-btn" onClick={sendMessage}>
                  {">"}
                </button>
              </Show>
              <Show when={loading()}>
                <button class="ai-send-btn ai-cancel-btn" onClick={() => aiCancel()}>
                  x
                </button>
              </Show>
            </div>
          </Show>

          {/* Model queue bar */}
          <div class="ai-model-bar">
            <Show when={hasKey()}>
              <For each={queuedModels()}>
                {(model) => (
                  <button
                    class={`ai-model-bar-item${activeModelId() === model.id ? " ai-model-bar-item-active" : ""}`}
                    onClick={() => selectModel(model.id)}
                  >
                    {model.label}
                  </button>
                )}
              </For>
            </Show>
            <button class="ai-flip-btn" onClick={() => setFlipped(true)}>Models</button>
          </div>
        </div>

        {/* ═══ BACK: Model Gallery ═══ */}
        <ModelGallery
          modelQueue={modelQueue}
          setModelQueue={setModelQueue}
          activeModelId={activeModelId}
          setActiveModelId={setActiveModelId}
          onFlipBack={() => setFlipped(false)}
          hasKey={hasKey}
          saveKeyMutation={saveKeyMutation}
          settings={props.settings}
          onSettingsChange={props.onSettingsChange}
        />
      </div>

      {/* Tool approval modal */}
      <Show when={pendingApproval()}>
        {(approval) => (
          <div class="ai-approval-overlay">
            <div class="ai-approval-dialog">
              <div class="ai-approval-title">Approve tool execution?</div>
              <div class="ai-approval-tool">{approval().toolName}</div>
              <pre class="ai-approval-input">{approval().toolInput}</pre>
              <div class="ai-approval-buttons">
                <button class="ai-approval-btn ai-approval-deny" onClick={() => handleApproval(false)}>Deny</button>
                <button class="ai-approval-btn ai-approval-approve" onClick={() => handleApproval(true)}>Approve</button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

export default AiChat;
