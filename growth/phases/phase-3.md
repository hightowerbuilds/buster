# Phase 3 — Claude and Codex connections

Status: **IN PROGRESS — Claude Code, Codex, and OpenCode all drive the Assistant end to end (verified live 2026-10-12); appearance actions, phrase search, and failure-path demos remain.**

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
- [x] **COMPLETED** (2026-10-12) — The composer says where messages go ("to
  OpenAI through Codex on your subscription") and that notes are shared only
  through the actions listed in the chat; each read the model received is marked
  "sent to Codex". Running actions, approvals, Stop, and results show in the chat.
- [x] **COMPLETED** (2026-10-12) — Changes wait for Allow or Deny with a before/after
  view, and an allowed edit undoes in one step.
- [x] **COMPLETED** (2026-10-12) — Codex and OpenCode in the sidebar. A Provider
  picker sits beside Model and Effort; a chat keeps its provider, new chats take
  the last one (the first takes Settings › AI). Codex runs `codex exec --json`
  per message (resuming its thread) with the shell, apps, plugins, web search,
  and user config off and only BusterMark's MCP server, pre-approved there so the
  app asks the writer instead. OpenCode runs `opencode run --format json` per
  message (`--session`) with a `bustermark` agent whose only tools are
  BusterMark's. Switching provider mid-chat starts fresh there and says so.
- [ ] Connect selection review and the search portal to the chosen assistant.
  Define model/web search separately from Phase 2's local open-note search.

## Acceptance examples

- [x] **COMPLETED** — Connect Claude, edit a note after approval, and undo
  (`scripts/native-macos-assistant-smoke.js`, live on the writer's subscription).
- [x] **COMPLETED** — Codex and OpenCode run the same workflow through their adapters.
- [ ] Ask the selected assistant to center a draft, adjust line spacing, and apply
  a saved appearance using the shared commands; revert from the visible UI.
- [ ] Ask it to find a phrase in open notes and open the correct result.
- [ ] Demonstrate cancellation, expired sign-in, missing runtime, process failure,
  stale document revision, and provider switching without leaking context.
  Cancellation, a declined action, and provider switching are verified live; the
  failure paths are covered by unit tests only.
- [x] **COMPLETED** (2026-10-12) — Live end-to-end tests with each connection: 30
  checks across Claude Code (Haiku 5.5, ~2.5s per read), Codex (~9s), and OpenCode
  (~9s). Nothing there is mocked.

Writing actions (Rephrase, Spelling, writing review) no longer use API keys or
local models: they run one-shot through the writer's Claude Code, Codex, or
OpenCode subscription (`src-tauri/src/commands/ai_cli.rs`). The Assistant sidebar
runs on all three (`src-tauri/src/commands/assistant.rs`).

The remaining work is the conversation surface and the acceptance workflows. Claude
Code's headless runs cannot answer a permission prompt, so its spawn passes
`--allowedTools mcp__bustermark`: this server's tools are allowed and nothing else,
alongside `--restricted`, which removes the shell. Codex and OpenCode get the
same server with their own tools switched off (see above).

The next milestone is [Phase 4 — AI command bar and assistant chat panes](phase-4.md),
which replaces the AI search entry point with a single input that either runs an
app command or opens an assistant conversation. It depends on the connection and
tool loop specified here.
