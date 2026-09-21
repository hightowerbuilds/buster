# Phase 3 — Claude and Codex connections

Status: **PLANNED — requested after Phase 2.**

Give writers a clear UI for choosing **Claude** or **Codex**, connecting the chosen
assistant, and using it to operate BusterMark's writing features through the
shared internal command service. Tractor Beam is the development host; these
connections belong to the BusterMark app being built here.

## Confirmed direction

- A visible Claude / Codex choice, with separate connection state for each.
- Guided connection setup, status, reconnect, and disconnect controls.
- The chosen assistant runs writing assistance and uses implemented app commands.
- Keep the Tauri/Rust–SolidJS split and the integrated terminal.
- Reuse the command catalog for documents, panes, formatting, search, speech,
  appearance, effects, and saved appearances.

## Connection design and implementation

- [ ] Verify the current supported integration/authentication methods for each
  assistant from its official documentation before choosing adapters. Decide
  whether the initial connection uses a local CLI/agent runtime, a supported SDK,
  or provider API credentials; explain the actual option in the UI.
- [ ] Distinguish an installed runtime, authenticated account, reachable process,
  selected model, and successful app-tool connection. Do not label a connection
  ready until a harmless round trip succeeds.
- [ ] Create provider cards and a setup panel showing connection state, available
  models where discoverable, and an actionable error/retry path.
- [ ] Keep provider credentials and sessions separate. Use supported sign-in flows
  or explicit credentials; do not infer authorization from the host assistant.
- [ ] Implement start/cancel/reconnect/disconnect and clean up owned processes,
  subscriptions, and outstanding tool calls.

## Assistant-to-app command loop

- [ ] Translate supported command schemas into each assistant's tool format.
- [ ] Dispatch calls through the existing command service; return structured
  results and errors to the same assistant conversation.
- [ ] Preserve stable pane/document targets, revision checks, and request-ID
  deduplication. A late response must not overwrite newer writing or user choices.
- [ ] Show included writing context before sending it and make running actions,
  cancellation, and results visible in the UI.
- [ ] Retain the existing explicit apply/reject workflow and single-step undo for
  generated writing. Define how direct user-requested app actions appear in chat.
- [ ] Connect selection review and the search portal to the chosen assistant.
  Define model/web search separately from Phase 2's local open-note search.

## Acceptance examples

- [ ] Connect Claude, rewrite a selected passage, review it, apply, and undo.
- [ ] Connect Codex and run the same workflow through its adapter.
- [ ] Ask the selected assistant to center a draft, adjust line spacing, and apply
  a saved appearance using the shared commands; revert from the visible UI.
- [ ] Ask it to find a phrase in open notes and open the correct result.
- [ ] Demonstrate cancellation, expired sign-in, missing runtime, process failure,
  stale document revision, and provider switching without leaking context.
- [ ] Complete live end-to-end tests with each supported connection. Clearly
  separate verified flows from mocks and unavailable providers.

No Claude/Codex agent adapter or connection UI is claimed by this roadmap. The
existing Ollama/Anthropic/OpenAI text-generation settings remain the current
writing-review transport until this milestone replaces or extends that workflow.
