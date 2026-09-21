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

Phase 2 expands the catalog to **66 commands**. `panel list` lists stable pane
IDs and their current tab IDs, including empty panes. `panel focus` accepts either
`paneId` or the legacy `tabId`, never both. `document create` accepts an optional
`paneId`; `panel split` accepts `direction` (left/right/up/down), optional `paneId`,
and `content` (note/terminal/empty). New splits default to a note.

New notes now provision a Markdown file in the persistent Notes home. The returned
tab exists immediately; disk creation follows asynchronously. Inspect
`document list` for its assigned path. On creation failure the draft remains open
with no path and the UI reports the error. Managed notes autosave; the Desktop
BusterMark symlink points to the same files.

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

## Markdown formatting

The compact toolbar and five formatting commands share one service. Inspect a
Markdown pane first, then pass the returned `target` unchanged to a mutation:

```text
format inspect {"paneId":"<pane ID>"}
format heading {"target":<returned target>,"level":2}
format bold {"target":<returned target>}
format italic {"target":<returned target>}
format list {"target":<returned target>,"kind":"ordered"}
```

Replace `<returned target>` with the actual JSON object; it contains pane/tab IDs,
document revision, range, and captured text, including a collapsed caret. Inspect
also returns active/mixed heading, emphasis, and list states. A changed note or
selection returns `STALE_FORMAT_TARGET`; moved/replaced panes cannot redirect an
edit. Each formatting change is one undo step and restores a predictable caret
or selection. Heading level 0 removes heading formatting; levels 1–6 set it.

Bold and italic toggle complete emphasis spans. With a collapsed caret they insert
paired markers and place the caret inside; a second toggle can remove that empty
pair before typing. Lists toggle existing matching markers or convert between
ordered/unordered forms. Conversion numbers from 1 at each indentation depth;
blank lines and indentation are retained. Multiline selections ending at column
zero exclude that final line. Trailing spaces and backslash hard breaks are retained.

Ambiguous partial emphasis, code fences, code spans, indented code, and complex
block syntax return readable `UNSUPPORTED_FORMAT` errors. Remove list formatting
before making an item a heading, and choose Paragraph before converting headings
to lists. Direct Markdown typing remains available. Formatting is disabled for
terminals, supporting panels, and non-Markdown files.

## Local search portal

The **AI search** toolbar button opens a supporting search pane. Its initial scope
is **open notes**, including unsaved engine text; it makes no network requests.
Selecting a passage only seeds an editable query. Opening never submits it.

```text
search portal open {"paneId":"<pane ID>"}
search query {"portalId":"<portal ID>","query":"clear writing"}
search read {"portalId":"<portal ID>"}
search source {"portalId":"<portal ID>","resultId":"<result ID>"}
search keep {"portalId":"<portal ID>","resultId":"<result ID>"}
search review {"portalId":"<portal ID>","resultId":"<result ID>"}
search source {"portalId":"<portal ID>"}
search portal close {"portalId":"<portal ID>"}
```

Search uses literal case-insensitive single-line phrases (1–256 UTF-16 code units),
up to 100 matches and one million scanned code units. Missing/loading engines are
reported as skipped. Stable result IDs carry document revisions; stale matches
cannot position a changed note or start a review. Keep retains the captured
passage with its source label as a new unsaved note; it does not modify the source.
AI review opens the existing review workflow and waits for explicit Generate.

Reopening from the same source focuses its existing portal; changed source context
refreshes the query without searching. At six panes the portal temporarily uses
its source pane while preserving the source tab and engine. Return to source
remains available. Starting review at the limit reuses the portal's view while
retaining its tab. Results are temporary; keep a note to retain a passage. Model
and web search follow the Claude/Codex connection milestone.

## Writing appearance, previews, presets, and effects

**Writing appearance** controls and commands share the same service. App defaults
persist locally. Workspace overrides persist by workspace path. Pane overrides
last the session and win over workspace, then app defaults. Unmodified fields
inherit future changes. Obtain the workspace ID from capabilities or workspace
inspection and pane IDs from `panel list`.

```text
appearance capabilities
appearance inspect
appearance inspect {"workspaceId":"<workspace path>"}
appearance inspect {"paneId":"<pane ID>"}
appearance apply {"scope":"app","revision":0,"changes":{"columnWidth":760,"alignment":"center","fontSize":16,"lineHeight":1.6}}
appearance preview {"scope":"pane","paneId":"<pane ID>","revision":1,"changes":{"background":"paper"}}
appearance preview cancel {"previewId":"<preview ID>","revision":2}
appearance reset {"scope":"pane","paneId":"<pane ID>","revision":3}
appearance revert {"revision":4}
appearance presets list
appearance presets save {"scope":"app","revision":5,"name":"My writing desk"}
appearance presets apply {"scope":"workspace","workspaceId":"<workspace path>","revision":6,"name":"Reading room"}
appearance presets delete {"revision":7,"name":"My writing desk"}
effects list
effects inspect {"paneId":"<pane ID>"}
effects set {"scope":"app","revision":8,"changes":{"typingPulse":0.15,"effectDuration":240,"motion":true}}
effects stop {"revision":9}
```

These revisions illustrate a fresh sequence; always use the current revision
returned by inspection/mutation. `STALE_APPEARANCE` means inspect again before
choosing a new patch. All patches validate completely before publication. Missing
panes/workspaces return `NOT_FOUND`. Failed preference writes return
`PERSISTENCE_UNAVAILABLE` and preserve appearance, preview, and history. Malformed
saved preferences fall back to defaults with a warning and remain untouched until
an explicit persistent change. Version-1 layout-only preferences still load.

| Property | Supported values |
| --- | --- |
| Four padding properties | 0–160 px; default 20 top/bottom, 24 left/right |
| `columnWidth` | 0 fills the pane; otherwise 320–1600 px including gutter |
| `alignment` | `left`, `center` |
| `fontSize` | 0 inherits editor settings; otherwise 10–32 px |
| `lineHeight` | 0 uses font size + 8 px; otherwise 1.2–2.4 × font size |
| `background` | `theme`, `paper`, `midnight`, `sage` |
| `focusDim` | 0–0.45; readable surrounding-line dimming |
| `cursorGlow`, `vignette`, `grain` | 0–100; -1 inherits existing theme settings |
| `typingPulse` | 0–1 |
| `effectDuration` | 100–1000 ms; default 240 |
| `motion` | Boolean; OS Reduce Motion also suppresses typing animation |

Only Markdown viewports use these controls. Narrow panes reduce padding; inspect
reports inherited requested values rather than measured geometry or contrast
clamping. Font family continues to use the existing global editor setting.
Per-heading fonts, paragraph spacing, arbitrary CSS, caret trails, and character
entrance effects are outside the implemented catalog. Capability discovery makes
that boundary explicit. Palette text contrast is protected, and paper limits
vignette strength. Selection and speech highlights remain separate overlays.

One preview can be active. It is not saved or added to appearance history; updating
it requires its `previewId`. Cancel restores committed values. Apply with an
explicit patch commits and clears the preview; reset, revert, preset mutations,
and Stop effects also end it. Closing the appearance dialog cancels its own
preview. UI drafts reject stale revisions rather than overwriting newer changes.

Quiet, Reading room, and Night focus are built-in presets. Up to 30 named custom
appearances persist locally; saving an existing custom name replaces it. Saving
captures effective applied/previewed values, not unsubmitted dialog fields.
App reset restores factory defaults; workspace/pane reset removes that scope's
overrides. Other scopes and presets remain intact. Revert restores one of the
last 20 committed appearance changes, separate from document undo. Stop effects
clears effects and motion across all stored scopes and ends a preview. It can be
reverted explicitly. These operations never edit note text.

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
