# Phase 3 — Claude and Codex connections

Status: **IN PROGRESS — connections and the assistant-to-app tool loop work end to end; chat UI and the acceptance workflows remain.**

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

- [x] **COMPLETED** — Verified against the installed CLIs. The connection uses each
  assistant's headless command-line mode: `claude --print --output-format stream-json`
  and `codex exec --json`. Both own their sign-in, so BusterMark stores no assistant
  credential. The Assistants panel names the CLI and its account.
- [x] **COMPLETED** — `agent detect` reports the binary path, version and sign-in
  separately and makes no model request; a provider is offered only when both are
  present. The panel's **Test** button runs the harmless round trip.
- [x] **COMPLETED** — Provider cards in the Assistants panel show state, the CLI path
  and the sign-in command to run when signed out. Model discovery is not implemented;
  the CLI's own default model is used unless a request names one.
- [x] **COMPLETED** — Sign-in happens in `claude auth login` and `codex login`. The app
  reads status only; it never stores, forwards or infers a credential.
- [x] **COMPLETED** — `agent send`, `agent cancel`, `agent connect`, `agent disconnect`.
  Child processes are killed on cancel, timeout and drop; at most two run at once.

## Assistant-to-app command loop

- [x] **COMPLETED** — The catalog is published as MCP tools by a loopback HTTP server
  (`src-tauri/src/mcp.rs`) bound to 127.0.0.1 on an OS-assigned port, with a bearer
  token minted per app session. Catalog names are underscored into tool names.
- [x] **COMPLETED** — Tool calls are forwarded to the frontend and run through the
  existing dispatcher as the `ai` caller, so an assistant reaches nothing the
  writer's own controls cannot. The six `agent *` commands are withheld. Verified
  live: the assistant called `mcp__bustermark__document_list` and answered from it.
- [x] **COMPLETED** — Calls inherit the dispatcher's schema validation, revision
  checks and request-ID deduplication unchanged. `agent send` returns as soon as a
  run is registered; awaiting the whole reply deadlocked the shared queue against
  the tool calls that reply needed, and a regression test now covers that.
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

The remaining work is the conversation surface and the acceptance workflows. Claude
Code's headless runs cannot answer a permission prompt, so its spawn passes
`--allowedTools mcp__bustermark`: this server's tools are allowed and nothing else,
alongside `--restricted`, which removes the shell. The equivalent Codex path is
configured but has not been exercised live.

The next milestone is [Phase 4 — AI command bar and assistant chat panes](phase-4.md),
which replaces the AI search entry point with a single input that either runs an
app command or opens an assistant conversation. It depends on the connection and
tool loop specified here.
