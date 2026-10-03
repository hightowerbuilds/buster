# BusterMark internal commands

BusterMark provides a command service inside the application. It operates the same
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
tab focus {"tabId":"file_1"}
history list
```

Use IDs returned by discovery/list operations. A document read returns the live
editor text, including unsaved edits, and its revision.

Use `commands list` for the current catalog and `commands describe` for a
command's exact schema. Tabs are the only workspace targets. `document create`
takes no arguments and appends an active tab; `tab focus`
activates any open tab by `tabId`. There is no pane limit.

Retired `panel` and `terminal` commands and `layout inspect` return
`UNKNOWN_COMMAND`; BusterMark no longer has shells.
Legacy `paneId` arguments are rejected by surviving command schemas. Retired
saved pane shortcuts are ignored and never reassigned to another operation.

New notes now provision a Markdown file in the persistent Notes home. The returned
tab exists immediately; disk creation follows asynchronously. Inspect
`document list` for its assigned path. On creation failure the draft remains open
with no path and the UI reports the error. Managed notes autosave; the Desktop
bustermark-workspace link points to the same files.

Switching tabs retains editor state. Closing a tab uses its normal
save/cancellation and cleanup flow. New Note and Settings are available in the
footer. Settings is
a singleton tab. Tab order and supported recovery data are persisted in the
version 2 session format; legacy pane layouts are read only for migration.

## Printing

```text
document list
document print {"tabId":"<actual open document ID>"}
```

`document print` captures the open document's current draft, including unsaved
changes, and opens BusterMark's print confirmation dialog. The writer chooses
the printer or Save as PDF, copies, pages, paper size, orientation, and sides.
The command accepts only `tabId`; model arguments cannot bypass confirmation or
choose an output path. It does not change the focused tab or editor contents.

The human command line and Language Model use the same service. Its promise
waits for confirmation or cancellation. The result has `status` (`submitted`,
`saved`, or `cancelled`), `title`, and the relevant `printer` or PDF `path`.
`submitted` means macOS accepted the job, rather than proof that paper printed.
Cancel or stopping the model before submission sends no job. Do not retry a
cancelled request unless the writer asks. A native failure stays in the dialog
for an explicit retry or cancellation. Printing currently requires macOS 11+.

## Notes folder

These commands work on every note in the Notes folder, open or not. Paths are
relative to the Notes folder (`Iodine.md`, `Drafts/idea.md`); absolute paths and
`..` are refused. Only `.md`, `.markdown`, and `.txt` files count as notes.

```text
notes list
notes search {"query":"microscopic firework"}
note read {"path":"Iodine.md"}
note open {"path":"Drafts/idea.md"}
note create {"name":"Ideas","text":"# Ideas\n"}
note rename {"path":"Iodine.md","name":"Up With It"}
```

- `notes list` returns each note's path, name, open tab ID, and whether it has
  unsaved changes, plus untitled drafts that have no file yet.
- `notes search` is case-insensitive. Open notes are searched in the editor, so
  unsaved text is included; closed notes are searched on disk. Up to 60 matching
  lines are returned, grouped by note.
- `note read` returns the live text, tab ID, and revision of an open note, or
  the saved text of a closed one.
- `note open` opens a note in a background tab and returns its tab ID and
  revision for `document edit`. Pass `"focus": true` to switch to it. It changes
  only the tab bar, so the Assistant runs it without asking.
- `note create` writes a new note, optionally with text, and opens it in the
  background. Without a name it gets an unused element name; `.md` is added
  when the name has no extension. An existing name returns `NAME_TAKEN`.
- `note rename` keeps the extension when the new name has none. Open tabs follow
  the new name and keep autosaving to it.

There is no delete command yet: deleting from the Notes folder is permanent.

## Note backgrounds

WGSL shaders drawn behind notes. Claude writes them through the Assistant; the
writer picks, turns off, or deletes them in Settings → Appearances →
Backgrounds, where each has a thumbnail. See
`growth/wgsl-backgrounds-roadmap.md` for the shader contract and design.

```text
backgrounds list
background read {"id":"bg-1790000000000"}
background create {"name":"Violet aurora","prompt":"a slow violet aurora","wgsl":"@fragment fn fs_main(...) ..."}
background update {"id":"bg-1790000000000","wgsl":"..."}
background apply {"id":"bg-1790000000000"}
background clear
```

- Shaders are WGSL. Rust validates them with naga and translates them to GLSL
  ES 3.00, which WebGL2 draws, because WebKitGTK does not yet provide WebGPU.
  Errors (`SHADER_ERROR`) quote naga's message with line numbers.
- `background create` and `background update` compile in their pre-approval
  check, so a broken shader returns to Claude instead of reaching the writer.
  The approval card shows a live preview. `create` also applies the background
  unless `"apply": false`.
- Backgrounds are stored in the app config directory as `backgrounds/<id>.wgsl`
  with `backgrounds/index.json` (names, prompts, selection, strength, animate).
- Only note tabs show a background. It is drawn at half resolution, up to 30
  frames a second, paused while the window is hidden, and as a still frame when
  animation is off or the system asks for reduced motion.

## Editing note text

`document edit` changes the words in an open note. Read the note first, then
pass its revision and a list of exact replacements:

```text
document read {"tabId":"file_1"}
document edit {"tabId":"file_1","revision":12,"edits":[{"find":"ok it could","replace":"Ok it could"},{"find":". up like","replace":". Up like"}]}
```

Each `find` is exact and case-sensitive, including Markdown, and must appear
once in the note; add neighbouring words to make it unique or pass a 1-based
`occurrence`. An empty `replace` deletes; keeping the anchor text in `replace`
inserts. All edits resolve against the same original text and are applied
together as one undo step, or not at all. Errors are `NO_MATCH`,
`AMBIGUOUS_MATCH`, `OVERLAPPING_EDITS`, and `STALE_REVISION` (the note changed
since it was read). The writer's cursor and selection follow their text.

## Markdown formatting

The compact toolbar and five formatting commands share one service. Inspect a
Markdown tab first, then pass the returned `target` unchanged to a mutation:

```text
format inspect {"tabId":"<tab ID>"}
format heading {"target":<returned target>,"level":2}
format bold {"target":<returned target>}
format italic {"target":<returned target>}
format list {"target":<returned target>,"kind":"ordered"}
```

Replace `<returned target>` with the actual JSON object; it contains a tab ID,
document revision, range, and captured text, including a collapsed caret. Inspect
also returns active/mixed heading, emphasis, and list states. A changed note or
selection returns `STALE_FORMAT_TARGET`; switching tabs cannot redirect an
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
terminals, utility tabs, and non-Markdown files.

## Local search portal

`search portal open` opens a search tab; the writing toolbar no longer has an
AI search button, so the command line and the Assistant are the entry points.
Its initial scope is **open notes**, including unsaved engine text; it makes no
network requests.
Selecting a passage only seeds an editable query. Opening never submits it.

```text
search portal open {"tabId":"<tab ID>"}
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
refreshes the query without searching. Search and review open as ordinary tabs
and retain their source tab references. Return to source remains available while
that note is open. Results are temporary; keep a note to retain a passage. Model
and web search follow the Claude/Codex connection milestone.

## Writing appearance, previews, presets, and effects

**Writing appearance** controls and commands share the same service. App defaults
persist locally. Workspace overrides persist by workspace path. Tab overrides
last the session and win over workspace, then app defaults. Unmodified fields
inherit future changes. Obtain the workspace ID from capabilities or workspace
inspection and tab IDs from `workspace inspect` or `document list`.

```text
appearance capabilities
appearance inspect
appearance inspect {"workspaceId":"<workspace path>"}
appearance inspect {"tabId":"<tab ID>"}
appearance apply {"scope":"app","revision":0,"changes":{"columnWidth":760,"alignment":"center","fontSize":16,"lineHeight":1.6}}
appearance preview {"scope":"tab","tabId":"<tab ID>","revision":1,"changes":{"background":"paper"}}
appearance preview cancel {"previewId":"<preview ID>","revision":2}
appearance reset {"scope":"tab","tabId":"<tab ID>","revision":3}
appearance revert {"revision":4}
appearance presets list
appearance presets save {"scope":"app","revision":5,"name":"My writing desk"}
appearance presets apply {"scope":"workspace","workspaceId":"<workspace path>","revision":6,"name":"Reading room"}
appearance presets delete {"revision":7,"name":"My writing desk"}
effects list
effects inspect {"tabId":"<tab ID>"}
effects set {"scope":"app","revision":8,"changes":{"typingPulse":0.15,"effectDuration":240,"motion":true}}
effects stop {"revision":9}
```

These revisions illustrate a fresh sequence; always use the current revision
returned by inspection/mutation. `STALE_APPEARANCE` means inspect again before
choosing a new patch. All patches validate completely before publication. Missing
tabs/workspaces return `NOT_FOUND`. Failed preference writes return
`PERSISTENCE_UNAVAILABLE` and preserve appearance, preview, and history. Malformed
saved preferences fall back to defaults with a warning and remain untouched until
an explicit persistent change. Version-1 layout-only preferences still load.

| Property | Supported values |
| --- | --- |
| Four padding properties | 0–160 px; default 20 top/bottom, 24 left/right |
| `columnWidth` | 0 fills the viewport; otherwise 320–1600 px including gutter |
| `alignment` | `left`, `center` |
| `fontSize` | 0 inherits editor settings; otherwise 10–32 px |
| `lineHeight` | 0 uses font size + 8 px; otherwise 1.2–2.4 × font size |
| `background` | `theme`, `paper`, `midnight`, `sage` |
| `focusDim` | 0–0.45; readable surrounding-line dimming |
| `cursorGlow`, `vignette`, `grain` | 0–100; -1 inherits existing theme settings |
| `typingPulse` | 0–1 |
| `effectDuration` | 100–1000 ms; default 240 |
| `motion` | Boolean; OS Reduce Motion also suppresses typing animation |

Only Markdown viewports use these controls. Narrow viewports reduce padding; inspect
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
App reset restores factory defaults; workspace/tab reset removes that scope's
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
  requestId: "agent-turn-12-list-documents",
  command: "document list",
  args: {},
}, "ai");
```

The caller identity is supplied by trusted application code, not inferred from
document content. The API itself is in-process. The Assistant sidebar publishes
it to Claude Code as a loopback-only, token-protected MCP server, started
with the first message (below); there is no global browser bridge or shell CLI.

### Assistant sidebar

The **Assistant** is a chat sidebar on the right of the workspace. Ctrl+Shift+A
(or "Toggle Assistant" in the command palette) opens it and focuses the message
box; pressed again from inside the sidebar, it closes it. F6 includes it in
region cycling. The composer footer selects the model and effort (low, medium,
high, extra high, max; Haiku 4.5 has no effort control). Enter sends, Shift+Enter
adds a line, and Stop or Esc interrupts a response. The sidebar's visibility,
width, model, and effort are remembered per machine.

It runs on the writer's Claude subscription through their locally installed,
signed-in Claude Code CLI. No API key is used or stored:

- `src-tauri/src/commands/assistant.rs` starts `claude -p` with streaming JSON
  input and output, `--tools ""` (no built-in tools), `--strict-mcp-config`,
  `--setting-sources ""` (no user or project settings, hooks, or CLAUDE.md),
  `--permission-mode dontAsk`, and the chosen `--model` and `--effort`. It runs
  in the app data `assistant` folder with `ANTHROPIC_API_KEY` removed from its
  environment, so the subscription login is always used. One process serves a
  conversation; changing the model or effort restarts it with `--resume`.
- The same module serves the command catalog as an MCP server on 127.0.0.1 at a
  random port. Requests need a per-launch bearer token and are refused if they
  carry an `Origin` header. `tools/call` is forwarded to the frontend and waits
  for its result.
- `src/lib/assistant-tools.ts` turns each available command into a tool. Spaces
  become underscores (`format inspect` → `format_inspect`); input schemas pass
  through unchanged. Commands that drive human-facing panels or the clipboard
  (`review`, `search`, `selection copy/paste/ai`), appearance and effects, speech,
  catalog/history commands, and `document create` (superseded by `note create`)
  are excluded, leaving about 28 writing tools. The list is snapshotted per
  conversation. Commands may set `confirm: false` when they only change the view
  (`note open`); every other write asks for approval.
- `src/lib/assistant.ts` handles the stream and tool calls. Read commands run
  immediately. A write command is first dry-run with `commands.check`; one that
  would fail goes straight back to Claude as an error. Otherwise it waits for
  **Allow** or **Deny**, and `document edit` shows each change with removed text
  struck through and added text highlighted. A denial is returned to Claude as
  an error result. Every call uses
  the `"ai"` caller and a `requestId` derived from its `tool_use` ID. Stop sends
  an in-band interrupt, so the process and conversation stay alive; if it is not
  confirmed within four seconds, the process ends and the next message resumes.

### Local models (Ollama)

The model picker's **Local (Ollama)** group lists the models installed in the
Ollama server from AI settings (default `http://localhost:11434`), with their
parameter size; models Ollama reports without tool support are marked "chat
only" and receive no tools. Selecting one runs the same sidebar through
`src/lib/local-model-transport.ts`, which runs the tool loop in the app and
reports the same events and tool calls as Claude Code, so approvals, previews,
Stop and the timer behave identically. `src-tauri/src/commands/local_model.rs`
lists models (`/api/tags`, `/api/show`) and streams one `/api/chat` turn with
tools, a 16k-token context, and cancellation. Effort maps to thinking: Low turns
it off, higher levels leave it on. Local and Claude conversations are separate;
switching mid-chat starts the local model without the earlier messages.
`scripts/native-tab-smoke/assistant-local-live.js` checks a read tool and an
approved `document edit` with `qwen3.5:4b`.

The status dot in the sidebar header reflects `claude auth status`, or Ollama's
model list when a local model is selected; click it to
check again. The sidebar explains what to do when Claude Code is missing or
signed out. `scripts/native-tab-smoke/assistant-live.js` exercises a real read
tool, an approved write, and an interrupt, and `assistant-edit-live.js` fixes
sentence capitalization through `document edit` and undoes it, and
`assistant-notes-live.js` finds, opens, fixes, and renames a closed note (seed
`Garden.md` in the isolated Notes folder first). All use Claude Haiku 4.5.

## Selection actions

Selecting note text opens Voice, Copy/Paste, Look up, and AI actions after selection settles. Escape
dismisses the toolbar while keeping the selection; **⌘⇧Space** reopens it and
focuses its controls. Voice opens the playback strip without starting audio.

`selection read {"tabId":"<tab ID>"}` returns the captured target:

```json
{
  "tabId": "file_1",
  "revision": 3,
  "range": {"anchor":{"line":0,"col":0},"head":{"line":0,"col":5}},
  "text": "Hello"
}
```

Pass that result as the arguments to `selection copy` or `selection paste`.
The dispatcher rechecks the note tab, revision, selected text, and exact range.
Paste repeats the check after asynchronous clipboard access and commits one
undoable edit. Focus changes never redirect the operation to a different note.
Retries with the same request ID share one result and do not paste twice.

`selection set` takes `tabId`, `revision`, and `range` (without `text`).
Positions are zero-based UTF-16 line/column offsets and must be in bounds and
nonempty. It updates the source selection without changing tab focus.

Opening or inspecting the toolbar does not access the clipboard. Paste uses the
system clipboard and reports denied/unavailable access or empty text; it never
silently substitutes the app's older internal clipboard contents. Multiple cursor
actions are unavailable in this increment. New errors are `STALE_SELECTION`,
`CLIPBOARD_UNAVAILABLE`, and `EMPTY_CLIPBOARD`.

## Lookup and AI review

`selection lookup` and `selection ai` take the same captured target as Copy/Paste
and return `{reviewId, tabId}`. Results open in an ordinary review tab while
retaining the source note and captured revision.
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
closing its source also cancels pending work while retaining completed output. Review tabs/results are temporary
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
speech read {"target":{"tabId":"file_1","revision":3,"range":{"anchor":{"line":0,"col":0},"head":{"line":0,"col":5}},"text":"Hello"},"voiceId":"<installed voice ID>","rate":0.5,"volume":1}
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
again before speech begins. Later editing does not change the captured audio
text. Closing the source stops active speech, including pending startup. Word progress appears only in the playback preview and
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

### Saved conversations

The Language Model sidebar's **New chat** button preserves the current chat.
**History** reopens saved conversations, searches their titles/messages, and offers
Rename and confirmed Delete. Drafts, model/effort choices, transcripts and usage
are saved per chat. Switching chats stops the outgoing reply; pending approvals
are cancelled. Restarting restores the active chat without replaying tool actions.
Claude uses its saved Claude Code session; Ollama receives its saved message/tool
context. Provider contexts remain separate when changing between Claude and Ollama.

History is stored locally in the app data directory at `chats/history.json`.
Writes are atomic and normal quit waits for history to save. Errors show Retry;
a corrupt or unsupported archive is preserved instead of being replaced with an
empty library. Deleting a chat removes its BusterMark history while retaining
notes and provider-managed transcripts. Old versions' unsaved sidebar chats are
not imported. See the [verification log](../growth/build-log/2026-09-27-chat-history.md).

## Web search

`web search {"query":"Markdown specification","count":5}` is a read-only command exposed as `web_search` to Claude and tool-capable local chat models. It returns up to 10 titles, source URLs, and snippets from Brave Search. It does not fetch full pages. Queries are limited to 500 characters and 75 words.

Set a Brave Search API key in **AI Settings → Web search**. The key is stored separately in the OS keyring, never in chat history or settings JSON. Search terms are sent to Brave; provider charges/quotas apply. Missing credentials, network errors, invalid responses, and rate limits are reported as tool failures. Returned links are limited to HTTP(S); source text is untrusted evidence. The assistant is instructed to cite URLs and not claim it read full articles.

Provider contract: https://api-dashboard.search.brave.com/app/documentation/web-search
