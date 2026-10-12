import { invoke } from "@tauri-apps/api/core";

/**
 * One question, one answer, through the writer's logged-in AI command-line
 * tools — Claude Code, Codex, or OpenCode — on their subscriptions, never API
 * keys or local models. See src-tauri/src/commands/ai_cli.rs.
 */
export type AiProvider = "claude" | "codex" | "opencode";
export const AI_PROVIDERS: Array<{ id: AiProvider; name: string; company: string }> = [
  { id: "claude", name: "Claude", company: "Anthropic" },
  { id: "codex", name: "Codex", company: "OpenAI" },
  { id: "opencode", name: "OpenCode", company: "OpenCode" },
];
export const isAiProvider = (value: unknown): value is AiProvider => AI_PROVIDERS.some(provider => provider.id === value);
export const providerName = (provider: AiProvider) => AI_PROVIDERS.find(entry => entry.id === provider)?.name ?? provider;

export interface OneShotRequest {
  requestId: string;
  provider: AiProvider;
  /** The CLI's default model when absent. */
  model?: string;
  /** Claude: low…max. Codex: minimal…high. OpenCode: none. */
  effort?: string;
  /** The instruction. */
  system: string;
  /** The writer's passage — the only content sent; it goes to the CLI on stdin. */
  text: string;
  /** JSON Schema the answer must match; plain text when absent. */
  schema?: Record<string, unknown>;
}
export interface OneShotReply { output: unknown; model: string | null }
export interface ProviderStatus { provider: AiProvider; installed: boolean; signedIn: boolean; detail: string | null }

export function aiOneShot(request: OneShotRequest, signal: AbortSignal): Promise<OneShotReply> {
  if (signal.aborted) return Promise.reject(new Error("Cancelled"));
  const cancel = () => { void invoke("ai_oneshot_cancel", { requestId: request.requestId }).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  return invoke<OneShotReply>("ai_oneshot", { request }).finally(() => signal.removeEventListener("abort", cancel));
}

export const aiProvidersStatus = () => invoke<ProviderStatus[]>("ai_providers_status");
