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

/** One step of a provider's ladder: cheapest and fastest first, each offered when the last falls short (Rephrase, Spelling). */
export interface AiRung { label: string; short: string; model?: string; effort?: string }
export const AI_LADDERS: Record<AiProvider, AiRung[]> = {
  claude: [
    { label: "Claude Haiku 5.5", short: "Haiku 5.5", model: "claude-haiku-5-5", effort: "low" },
    { label: "Claude Sonnet 5.5", short: "Sonnet 5.5", model: "claude-sonnet-5-5", effort: "low" },
    { label: "Claude Opus 5.5", short: "Opus 5.5", model: "claude-opus-5-5", effort: "low" },
  ],
  // Codex escalates its reasoning effort on the writer's default model.
  codex: [
    { label: "Codex · low effort", short: "low effort", effort: "low" },
    { label: "Codex · medium effort", short: "medium effort", effort: "medium" },
    { label: "Codex · high effort", short: "high effort", effort: "high" },
  ],
  // OpenCode's models are whatever the writer configured; it uses their default.
  opencode: [{ label: "OpenCode", short: "OpenCode" }],
};

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
