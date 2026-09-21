# BusterMark internal commands

Phase 0 provides a command service inside the application. It operates the same
state and actions used by the UI. It does not execute shell command strings.

## Human command entry

Open the command line with **Ctrl+`**, enter an app command, and press Enter.
Arguments are an optional JSON object after the command name:

```text
help
commands describe {"name":"document read"}
app status
workspace inspect
document list
document create
document read {"tabId":"file_1"}
terminal create
terminal list
terminal focus {"tabId":"term_tab_1"}
panel list
panel focus {"tabId":"file_1"}
panel split {"direction":"right","content":"note"}
layout inspect
history list
```

Use IDs returned by discovery/list operations. A document read returns the live
editor text, including unsaved edits, and its revision. A terminal creation result
confirms the tab was created; PTY initialization happens asynchronously. Use
`terminal list` to inspect whether a PTY ID has been assigned. An initialized PTY
ID does not certify that its shell process is still running.

Phase 1 expands the catalog to **39 commands**. `panel list` lists stable pane
IDs and their current tab IDs, including empty panes. `panel focus` accepts either
`paneId` or the legacy `tabId`, never both. `document create` accepts an optional
`paneId`; `panel split` accepts `direction` (left/right/up/down), optional `paneId`,
and `content` (note/terminal/empty). New splits default to a note.

Use the IDs from `layout inspect` for these operations:

```text
panel focus {"paneId":"<pane ID>"}
panel swap {"first":"<pane ID>","second":"<another pane ID>"}
panel resize {"splitId":"<split ID>","ratio":0.6}
panel zoom {"paneId":"<pane ID>"}
panel close {"paneId":"<pane ID>"}
```

Resize ratios are between 0.1 and 0.9; displayed geometry also enforces minimum
pane dimensions. Zoom toggles maximize/restore. Closing a pane retains its draft
or running terminal in the tab bar. Closing the document/terminal tab is a
separate operation, with existing unsaved-change protection for documents.
There is a six-pane limit (`LIMIT_REACHED`). Each document currently has one live
view; opening an already visible document focuses its pane. Layouts are saved
with the periodic session snapshot. Named `layout save`/`layout restore` commands
and simultaneous views of one document remain planned.

## In-app AI entry point

The shared `BusterContext` exposes `commands`. An in-app tool adapter uses the
catalog directly and submits structured arguments:

```ts
const { commands } = useBuster();
const catalog = commands.describe();
const result = await commands.dispatch({
  requestId: "agent-turn-12-create-terminal",
  command: "terminal create",
  args: {},
}, "ai");
```

The caller identity is supplied by trusted application code, not inferred from
document content. This API is in-process. It does not open a network listener,
publish an MCP server, expose a global browser bridge, or install a shell CLI.
Connecting a model's tool-call loop to this entry point remains part of the AI
integration. External terminal-agent transport is deferred to a separate task.

## Selection actions

Selecting note text opens Voice, Copy/Paste, Look up, and AI actions after selection settles. Escape
dismisses the toolbar while keeping the selection; **⌘⇧Space** reopens it and
focuses its controls. Voice opens the playback strip without starting audio.

`selection read {"paneId":"<pane ID>"}` returns the captured target:

```json
{
  "paneId": "<pane ID>",
  "tabId": "file_1",
  "revision": 3,
  "range": {"anchor":{"line":0,"col":0},"head":{"line":0,"col":5}},
  "text": "Hello"
}
```

Pass that result as the arguments to `selection copy` or `selection paste`.
The dispatcher rechecks the note, pane, revision, selected text, and exact range.
Paste repeats the check after asynchronous clipboard access and commits one
undoable edit. Focus changes never redirect the operation to a different note.
Retries with the same request ID share one result and do not paste twice.

`selection set` takes `paneId`, `tabId`, `revision`, and `range` (without `text`).
Positions are zero-based UTF-16 line/column offsets and must be in bounds and
nonempty. It updates the source selection without changing pane focus.

Opening or inspecting the toolbar does not access the clipboard. Paste uses the
system clipboard and reports denied/unavailable access or empty text; it never
silently substitutes the app's older internal clipboard contents. Multiple cursor
actions are unavailable in this increment. New errors are `STALE_SELECTION`,
`CLIPBOARD_UNAVAILABLE`, and `EMPTY_CLIPBOARD`.

## Lookup and AI review

`selection lookup` and `selection ai` take the same captured target as Copy/Paste
and return `{reviewId, tabId}`. Results open beside the source in an empty or new
pane. At the six-pane limit, close a pane view first; its note remains in a tab.
Lookup uses active macOS dictionaries offline, for single-line queries up to 256
Unicode characters. An absent definition provides dictionary setup guidance.

Opening AI review does not send a request. These commands operate its lifecycle:

```text
review generate {"reviewId":"<ID>","provider":"ollama","model":"<installed model>","instruction":"Rewrite clearly. Return only the revised passage."}
review read {"reviewId":"<ID>"}
review cancel {"reviewId":"<ID>"}
review apply {"reviewId":"<ID>","mode":"replace"}
review source {"reviewId":"<ID>"}
review discard {"reviewId":"<ID>"}
```

Providers are `ollama`, `anthropic`, or `openai`; the provider must match the
configured connection. The model is explicit. Only the captured text and
instruction are sent. Generate returns immediately; Read reports running,
completed, failed, canceled, or applied state and includes the captured passage
and streamed result. Request IDs protect retries from starting duplicate jobs.
Cancel and Discard ignore late output. Discard also closes the review tab.

Apply accepts `replace`, `insert-after`, or `new-note`. Source edits recheck the
captured revision and range, regardless of current focus or selection, and form
one undo group. New-note retains a completed result even when its source is
stale/closed. A result can be used only once. Return to source restores the range
only if the source revision still matches. Closing a review tab cancels its job;
closing only its pane retains the tab and job. Review tabs/results are temporary
and do not survive restart; apply or keep a note to retain output.

Selection input is limited to 32 KiB, instructions to 4 KiB, output to 64 KiB,
and native generation to 120 seconds with at most four concurrent requests.
Missing connections, failed/truncated streams, and canceled output cannot be
applied. No provider fallback or automatic external search occurs.

## macOS selected-text speech

`selection voice` takes the captured selection target above and opens playback
controls. It preserves the note's selection and does not start audio. List voices
before choosing an installed voice identifier:

```text
speech voices list
speech read {"target":{"paneId":"<pane ID>","tabId":"file_1","revision":3,"range":{"anchor":{"line":0,"col":0},"head":{"line":0,"col":5}},"text":"Hello"},"voiceId":"<installed voice ID>","rate":0.5,"volume":1}
speech status
speech pause {"jobId":"<returned job ID>"}
speech resume {"jobId":"<returned job ID>"}
speech stop {"jobId":"<returned job ID>"}
speech source {"jobId":"<returned job ID>"}
```

Read returns immediately with a job ID and `starting` state. Native lifecycle
events report when playback actually starts, pauses, completes, stops, or fails.
Only one passage plays at a time. Stop the current job before another Read.
Requests are idempotent through the shared dispatcher; controls for an old job
cannot retarget a newer job. Stop works during startup and ignores late callbacks.

The source revision and UTF-16 range are checked before asynchronous startup and
again before speech begins. Later editing or closing the source does not change
the captured audio text. Word progress appears only in the playback preview and
is suppressed when its source becomes stale. Speech never edits the document or
changes its cursor/selection. `speech source {}` focuses the prepared passage or
active job without moving the caret.

This increment reads plain selected text as written, up to 32 KiB UTF-8, through
Apple AVSpeechSynthesizer. Voice metadata includes stable ID, name, language, and
native quality. Rate uses Apple's normalized 0.1–1 range (default 0.5); volume is
0–1. The UI retains the last voice/rate/volume locally, but not passage text or
playback jobs. Missing voices require a new explicit choice. Refresh voices after
managing downloads in macOS Accessibility settings. No cloud fallback occurs.

Whole-document/paragraph/cursor reading, source-editor speech overlays, audio
export, reusable presets, non-Apple engines, and generic job subscriptions remain
planned. Non-macOS builds report that Apple speech is unavailable.

## Contract

`src/lib/workbench-commands.ts` is the initial catalog: names, descriptions,
versions, read/write effects, examples, JSON input/output schemas, and handlers.
The catalog drives human help and AI tool descriptions. The dispatcher validates
both inputs and outputs. It currently supports object, array, string, number,
boolean, and null schemas, required properties, additional-property checks,
string enums, and minimum string lengths.

Results contain `version`, `requestId`, `command`, and `ok`, followed by either
`data` or `error: { code, message }`. Errors include `INVALID_REQUEST`,
`INVALID_ARGUMENTS`, `UNKNOWN_COMMAND`, `UNAVAILABLE`, `NOT_FOUND`, `NOT_READY`,
`REQUEST_ID_CONFLICT`, `BUSY`, `LIMIT_REACHED`, `INVALID_RESULT`, and `INTERNAL_ERROR`.

Operations execute in submission order. Concurrent retries with the same caller,
request ID, command, and arguments share one result. Reusing that ID for different
arguments fails. The most recent 128 completed requests are retained in memory;
this protection expires on eviction or app restart. Use a new request ID for a
fresh read or a deliberate retry after a previous failure. Up to 64 requests may
be pending. This foundation does not claim durable exactly-once execution.

History retains the most recent 128 command names, caller identities, request IDs,
and outcomes. It omits arguments, document text, and settings. App-state commands
select their output fields explicitly rather than serializing the entire store.

## Extending the catalog

Register a feature's schema and handler in the catalog and delegate to its owning
application service. Validate stable target IDs before mutation. Test that UI and
AI invocation reach the same behavior, including failure cases and repeated
requests. Writing review jobs now implement cancellation and revision-checked
edits. Selected-text speech now has its own lifecycle controls. General job/event
subscriptions and additional speech scopes remain planned.
