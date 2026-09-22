# Phase 4 — AI command bar and assistant chat panes

Status: **PLANNED — depends on Phase 3.**

Replace the AI search entry point with one line of text input. A typed app
command runs immediately and opens nothing. Any other request goes to the
assistant connected in [Phase 3](phase-3.md), which opens a pane and shows its
chat activity there.

This phase is deliberately sequenced after Phase 3. The routing it describes
needs a connected assistant and the assistant-to-app tool loop; neither exists
while Phase 3 is planned.

## Dependencies

- Phase 3 connection UI, credentials, and the assistant-to-app command loop.
- The shared catalog and dispatcher in `src/lib/feature-commands.ts`, including
  its schema validation, request-ID deduplication, and revision-checked targets.

## Confirmed direction

- One single-line input opened from the writing toolbar. The input is not a pane.
- A recognized app command runs inline and reports its result in the bar.
- Any other request opens or focuses an assistant pane showing the conversation.
- One text input serves both. The old Ctrl+` command line has been removed, so this
  bar is the only writer-facing command entry.
- The writer sees which writing context is included before anything is sent.

## 4.1 — The input bar

- [ ] Open a single-line input from the toolbar's AI entry point, over the
  writing area rather than as a pane. Escape dismisses it without side effects.
- [ ] Capture the source pane, note, revision, and selection before focus moves,
  so a later dispatch cannot be redirected to whichever pane has focus.
- [ ] Give the bar an accessible name, keyboard access, and a visible hint that
  explains which input starts a command and which starts a request.
- [ ] Return focus to the source note after the bar closes.

## 4.2 — Deterministic command routing

- [ ] Decide the rule separating a command from a request. The proposed default
  is a leading `/`: explicit, free of false positives when a writer searches for
  a phrase that matches a command name, and correct without a model. Alternatives
  are a catalog-prefix match with a confirmation step, or letting the model route
  every input. Record the decision and its failure modes before building.
- [ ] Complete and describe command names from the catalog as the writer types,
  so the implemented commands become discoverable.
- [ ] Dispatch through the existing service as the `user` caller, so human and
  assistant invocation keep sharing one handler.
- [ ] Report success or failure inline in the bar. A command must never open a
  chat pane, including when it fails.
- [ ] Decide how arguments are supplied. Commands currently take JSON objects,
  which is unreasonable to type while writing. Either accept a friendlier
  argument form for common commands, restrict the bar to commands that need no
  arguments, or require the assistant to translate a request into a tool call.

## 4.3 — Assistant chat panes

- [ ] Open or focus one pane per conversation and show the assistant's activity:
  streamed text, tool calls, their results, and errors.
- [ ] Show the included writing context before sending it, and make running
  actions, cancellation, and results visible.
- [ ] Keep the explicit apply/reject workflow and single-step undo for generated
  writing. A late response must not overwrite newer writing.
- [ ] Respect the six-pane limit with a defined fallback, as the search portal
  and review panes already do.
- [ ] Define the behavior with no connected provider: the bar explains what is
  missing and links to the Phase 3 setup panel rather than opening a dead pane.
- [ ] Decide whether conversations survive restart. Review and portal panes are
  currently temporary and excluded from session restore.

## 4.4 — Relationship to existing surfaces

- [x] **RESOLVED** — The Ctrl+` command line was removed for exposing raw JSON to
  writers, so this bar is the only command entry to build. Its parser
  (`FeatureCommands.executeLine`) is retained and tested for that purpose.
- [ ] Decide the future of Phase 2's local open-note search portal. The bar may
  subsume it, or local search may become one assistant capability among others.
- [ ] Keep selection actions, writing review, speech, and formatting working
  alongside the bar.

## Acceptance examples

- [ ] A typed command splits a pane, and no chat pane opens.
- [ ] A typed request opens a chat pane and streams the assistant's reply.
- [ ] An unknown command reports a readable error and opens nothing.
- [ ] A search phrase that happens to match a command name is not executed.
- [ ] Cancelling mid-response leaves no partial edit and no orphaned pane.
- [ ] With no provider connected, the bar explains the gap without opening a pane.
- [ ] Repeating the same request ID does not run an action or open a pane twice.

## Open decisions

- The routing rule, and whether the model participates in routing at all.
- The argument form for commands typed by a person.
- Whether this bar replaces Phase 2's local open-note search portal.

Nothing in this phase is implemented. The AI search button currently opens the
Phase 2 local open-note search portal, which makes no network request.
