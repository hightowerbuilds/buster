# Phase 1 — lookup and AI writing review

Status: **COMPLETED** for this increment. Voice, speech model discovery, and the
remaining Phase 1 checklist are still open.

## Delivered

- [x] **COMPLETED** — Enabled Look up and AI in the automatic selection toolbar.
  Both open a supporting pane beside the captured source, preserving document,
  revision, and range. Empty panes are reused; the six-pane limit reports a
  recoverable error instead of replacing the source view.
- [x] **COMPLETED** — Offline macOS DictionaryServices integration with Unicode
  ranges, single-line query bounds, no-definition guidance, and explicit errors
  on unsupported platforms. This Mac has no downloaded dictionary definitions.
- [x] **COMPLETED** — AI review with Rewrite, Explain, Summarize, Expand, and
  custom instructions. Provider/model and exact captured text are visible before
  Generate. Opening the pane sends nothing. Only selection and instruction enter
  the request; document IDs, surrounding notes, terminal, and clipboard stay out.
- [x] **COMPLETED** — Ollama, Anthropic, and OpenAI streaming adapters reuse
  existing settings and credentials, with independent cancellation and bounded
  requests. No automatic provider fallback. Failed or incomplete streams cannot
  be applied. Closing a review tab cancels its job; closing a pane retains it.
- [x] **COMPLETED** — Provider connections are configurable with automatic inline
  suggestions disabled. Provider switching clears visible credentials/model so
  keys are not copied into another provider's saved settings; existing Keychain
  entries remain usable. Cloud model IDs are explicit inputs rather than an
  outdated fixed list. Inline token-budget UI identifies its limited scope.
- [x] **COMPLETED** — Replace selection and Insert after validate the captured
  revision/range and form one undoable edit. Current focus does not redirect the
  edit. Stale/closed sources still allow Keep as new note. Discard leaves the
  source intact. Return to source restores its range only while current.
- [x] **COMPLETED** — Eight shared commands bring the catalog to 31:
  `selection lookup`, `selection ai`, `review generate`, `review read`,
  `review cancel`, `review discard`, `review apply`, and `review source`.
  Generation returns immediately so cancellation remains available. Duplicate
  request IDs do not duplicate jobs, panes, or edits.

Review results are temporary. Apply or keep as a note to retain them after an
app restart. Saving a retained note follows the normal draft/save workflow.

## Verification

- TypeScript check passed.
- Frontend suite: **343 tests across 33 files passed**, including 14 review
  lifecycle tests, eight streaming adapter tests, and four dictionary adapter tests.
- Native library suite: **84 tests passed**, including six writing transport and
  three dictionary tests. Native DictionaryServices was exercised on this Mac.
- Isolated desktop debug build passed. Visual inspection confirmed AI opens
  beside the selected source, shows the captured passage/provider/model, waits
  for Generate, and remains usable in narrow and maximized panes.
- Desktop automation was limited by host-driven window movement/resizing; do not
  treat it as full end-to-end generation/apply verification. Provider failure,
  cancellation/late events, stale targeting, and single-step undo were verified
  through automated tests. No paid-provider or live model generation was run.
- A regular debug bundle is built with the original application identifier after
  the isolated smoke run; user profile data was not used for the smoke test.

API references checked during implementation:
[Apple DictionaryServices](https://developer.apple.com/documentation/coreservices/1446842-dcscopytextdefinition?language=objc),
[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create),
[Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming),
[Ollama chat](https://docs.ollama.com/api/chat).

Next: prove the macOS speech bridge (voice list, speak/stop, progress, audio capture),
then connect selection reading and shared speech commands.
