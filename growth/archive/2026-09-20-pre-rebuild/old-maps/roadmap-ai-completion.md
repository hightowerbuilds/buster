# AI Code Completion Roadmap

> Status: Implementation Complete; live provider checks pending
> Last updated: 2026-04-28

Ghost text / inline AI code completion with support for local models (Ollama) and cloud providers (Anthropic, OpenAI). Streams tokens as they arrive so users see completions building in real-time.

---

## Architecture

```
User types → dismiss ghost + cancel in-flight → debounce (500ms cloud / 1.5s local)
→ build context (50 lines before + 10 after cursor) → invoke ai_completion_request
→ Rust spawns streaming task → tokens emitted via Tauri events
→ frontend accumulates tokens → canvas renders semi-transparent ghost text
→ Tab accepts / Escape dismisses / next keystroke cancels and restarts
```

**Rust backend:** `commands/ai_completion.rs` — two commands (`ai_completion_request`, `ai_completion_cancel`), provider logic as a match on settings, streaming via `tokio::select!` with watch channel cancellation.

**Frontend:** `editor-ghost-text.ts` — debounce, invoke, listen for streamed `ai-completion-token` events, accumulate into PhantomText for canvas rendering.

**Settings:** AI provider, model, debounce, stop-on-newline, caching, language allow/disable, token budget, and secure key persistence fields are part of AppSettings (Rust + TypeScript). On macOS, cloud API keys are persisted via Keychain instead of `settings.json`.

---

## Phase 1: Settings & Configuration

- [x] Add AI settings fields to Rust `AppSettings` struct (`ai_completion_enabled`, `ai_provider`, `ai_api_key`, `ai_model`, `ai_local_model`, `ai_ollama_url`)
- [x] Add matching fields to TypeScript `AppSettings` interface
- [x] Add defaults to `BusterProvider.tsx`
- [x] Add AI Settings tab (`AiSettingsPanel.tsx`) with toggle, provider selector, API key input, model selection, Ollama status check
- [x] Test: settings serialization/default round-trip with AI fields

---

## Phase 2: Rust Backend — Ollama Provider

- [x] Create `src-tauri/src/commands/ai_completion.rs` with `AiCompletionState` (watch channel + atomic request ID)
- [x] Implement `ai_completion_request` command — spawns tokio task, emits `ai-completion-token` events
- [x] Implement `ai_completion_cancel` command — sends cancel signal via watch channel
- [x] Implement `stream_ollama()` — POST to `localhost:11434/api/generate` with streaming NDJSON parsing
- [x] Build FIM prompt: `prefix` + `suffix` context from request
- [x] Configure for slow hardware: `num_predict: 20`, `num_ctx: 512`, `temperature: 0.2`
- [x] Register `AiCompletionState` and commands in `lib.rs`
- [x] Unit tests: Ollama stream line parsing and prompt construction
- [ ] Live test: verify streaming tokens arrive from Ollama via Tauri events

---

## Phase 3: Frontend — Ghost Text Rewrite

- [x] Rewrite `editor-ghost-text.ts` from stub to full implementation
- [x] Add debounce timer (1.5s for Ollama, 500ms for cloud) in `scheduleRequest()`
- [x] Build context extraction: 50 lines before cursor + 10 lines after
- [x] Fire `ai_completion_request` via invoke after debounce
- [x] Listen for `ai-completion-token` events, accumulate into ghost text signals
- [x] Ignore stale responses via monotonic `requestId` matching
- [x] Cancel in-flight on dismiss, new keystroke, or tab switch
- [x] Generate `PhantomText[]` from accumulated text (handle multiline)
- [x] Thread `settings` accessor through `CanvasEditor.tsx` to ghost text deps
- [x] Unit tests: context extraction, short-prefix guard, disabled-language guard, cache keys
- [ ] Live test: type in editor → pause → ghost text appears → Tab accepts

---

## Phase 4: Cloud Providers

- [x] Implement `stream_anthropic()` — SSE streaming from `api.anthropic.com/v1/messages`
- [x] Parse Anthropic SSE events: extract `content_block_delta` text chunks
- [x] Implement `stream_openai()` — SSE streaming from `api.openai.com/v1/chat/completions`
- [x] Parse OpenAI SSE events: extract `choices[0].delta.content` chunks
- [x] Validate API key before making requests (return error if empty)
- [ ] Test with Anthropic Haiku (fast, cheap)
- [ ] Test with OpenAI GPT-4o-mini

---

## Phase 5: Polish & Optimization

- [x] Stop-on-newline option for single-line completions (especially useful for slow local models)
- [x] Improved FIM prompt with language-specific formatting
- [x] Loading indicator (subtle ghost dot while waiting)
- [x] Graceful handling: Ollama not running, API key missing, network errors — silent inline failure path
- [x] Tune debounce timers via settings (`ai_debounce_local_ms`, `ai_debounce_cloud_ms`)
- [x] Skip requests for very short prefixes (`ai_min_prefix_chars`)
- [x] Cache recent completions to avoid re-requesting the same context

---

## Phase 6: Security & UX

- [x] Secure API key storage via macOS Keychain
- [x] API key validation button in settings (test the key against the provider)
- [x] Token usage tracking / budget display
- [x] Per-language enable/disable (e.g. disable for markdown, enable for code)
- [x] Keyboard shortcut to manually trigger completion (`Ctrl+Space` when AI completion is enabled)
- [x] Settings UI: show Ollama connection status and available models

---

## Hardware Context

Testing on 2019 MacBook Pro (Intel, no discrete GPU):

| Model | Size | Tokens/sec | 15-token completion |
|-------|------|------------|-------------------|
| gemma3:4b | 3.3 GB | ~3.1 tok/s | ~5 seconds |
| gemma4:e2b | 7.2 GB | ~2.3 tok/s | ~6.5 seconds |
| gemma4:latest | 9.6 GB | ~2.0 tok/s | ~7.5 seconds |
| Haiku 4.5 (cloud) | — | ~50 tok/s | ~660ms |

Local model completions will feel slow but usable with streaming (first token visible after ~1.8s including debounce). Cloud completions will feel near-instant.
