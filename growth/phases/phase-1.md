# Phase 1 — Writing panes, selection actions, and voice

Foundation decisions: [first writing workflow](writing-workflow.md), including local
Markdown/plain-text files, retained canvas editing, and reviewed AI selection revisions.

Status: **PAUSED at user request** — Phase 1 remains partially complete. Writing
panes, Copy/Paste, local dictionary lookup, selection-scoped AI review, and macOS
selected-text playback are implemented.
Whole-document speech, audio export, and speech model discovery remain open. See the
[Phase 1 build log](../build-log/2026-09-20-phase-1.md).
Selection work: [selection actions build log](../build-log/2026-09-20-selection-actions.md).
Review work: [lookup and AI review build log](../build-log/2026-09-20-writing-review.md).
Speech work: [macOS voices build log](../build-log/2026-09-20-macos-speech.md).

Depends on: [Phase 0 — BusterMark foundation](phase-0.md), including its shared
command interface and access to live document text.

## Direction

Build a pane-based writing workbench with a tmux-like feel: create notes alongside
one another, move quickly between them, and keep supporting tools close to the
draft. Selecting text automatically reveals actions for that passage.

Make listening a core part of this workspace. A writer should be able to hear a
selection or an entire draft, compare voices on their own text, choose an engine
suited to their needs, and export spoken audio.

## Confirmed decisions

- Give the workspace a tmux-like feel, with panel-based note creation.
- Make cursor and selection behavior a first-class part of the writing experience.
- Automatically open a contextual action menu when text is selected, including
  voice, copy, paste, lookup, and AI actions.
- Provide full text-to-speech capabilities within the writing workbench.
- Include a dedicated interface for discovering and comparing speech models.
- Integrate with the macOS system voice infrastructure.
- Keep the Tauri/Rust–SolidJS architecture and expose these features through the
  internal CLI so the AI can operate them alongside the writer.

The detailed experience and delivery sequence below are proposed scope. Specific
third-party models, runtimes, and cloud providers remain to be selected.

## 1.1 — Writing panes and note creation

The workspace is organized around visible, independently focusable panes. Notes,
the retained terminal, AI assistance, lookup results, and voice tools can sit
alongside one another. The tmux influence is in splitting, navigation, resizing,
and focus. The initial workspace uses direct, configurable shortcuts and up to six
panes, with a guide in the toolbar.

- [x] **COMPLETED** — Create a new note directly in an empty pane or in a new split beside the
  current note. Focus the new note so writing can begin immediately.
- [x] **COMPLETED** — Split left/right or above/below, including nested splits, and choose whether
  the new pane contains a new note, an existing note, or a supporting tool.
- [x] **COMPLETED** — Give panes compact headers with note/tool name, unsaved state where relevant,
  and an unmistakable active-pane indicator.
- [x] **COMPLETED** — Navigate spatially with keyboard commands and pointer input; offer a
  discoverable shortcut guide and configurable bindings.
- [x] **COMPLETED** — Resize neighboring panes with keyboard commands and internal
  commands, enforcing usable minimum dimensions (240 × 180 per pane).
- [x] **COMPLETED** — Verify draggable dividers in the desktop app. Dividers retain
  their DOM identity throughout resizing, use document mouse tracking, and end a
  drag on mouse release or window blur. A continuous 120-pixel drag was verified.
- [x] **COMPLETED** — Move or swap pane contents and temporarily maximize a pane, then restore
  the previous arrangement.
- [x] **COMPLETED** — Retain each pane's cursor, selection, and scroll position when focus changes.
- [x] **COMPLETED** — Save and restore the layout, active pane, note references, and unsaved note
  content across application restarts.
- [x] **COMPLETED** — Closing a pane closes that view. Note deletion is a separate operation;
  protect unsaved content when its final view closes.
- [x] **COMPLETED** — Keep terminal processes alive through layout changes. Define terminal-close
  behavior separately from closing a note view.

Implemented identity model: layout leaves refer to stable pane IDs. Content uses
stable document/terminal tab IDs; each editor and terminal remains mounted through
splits, swaps, resizing, and zoom. Closing a pane leaves its content in the tab bar;
closing a document tab still uses Save/Discard/Cancel for dirty writing. Closing a
terminal tab stops its PTY. Restarting the app starts a new shell.

- [ ] Support two synchronized views of one note with independent cursors and
  scrolling. This first increment has one live view per document; opening an
  already visible note focuses its pane. A background note can populate an empty
  pane through its Open menu or the tab bar.

`src/lib/writing-panes.ts` replaces the old index-based split model. New splits
default to Markdown notes. The six-pane limit is retained for this increment;
small windows scroll the workspace rather than compressing panes below minimum
sizes. Local Markdown/plain-text files and distinct untitled draft backups follow
the [writing workflow](writing-workflow.md). Session snapshots are periodic, not
a guarantee that every keystroke survives an abrupt exit.

## 1.2 — Cursor, selection, and contextual actions

Selecting a nonempty passage in a writing pane automatically opens a compact menu
near that selection. Opening the menu preserves the selected text and keeps the
writer oriented in the source note.

| Action | Proposed behavior |
| --- | --- |
| Voice | Read the selected text with the current voice; offer voice selection and preview as secondary actions. |
| Copy | Copy the selected text and preserve the source selection. |
| Paste | Replace the selected text with clipboard text as one undoable edit. |
| Look up | Open a definition or search for the selection in a supporting pane while keeping the source note visible. |
| AI | Open assistance scoped to the selection, with actions such as explain, rewrite, summarize, expand, or a custom instruction. |

### Selection and menu behavior

- [x] **COMPLETED** — Automatic selection toolbar with functional Copy/Paste,
  Look up, AI review, Voice controls, Escape dismissal, and ⌘⇧Space
  to reopen and focus its controls. This increment uses one primary selection.
- [x] **COMPLETED** — Clipboard failures, empty clipboard text, changed source
  revisions/ranges, missing panes, and multiple cursors leave the draft intact
  and produce explicit command errors. Copy/Paste use the shared command dispatcher.
- [x] **COMPLETED** — Double-click word selection opens the toolbar; clicking Copy
  preserves the selected word. Unicode word boundaries preserve combining marks
  and surrogate pairs. Triple-click selects a line and Shift-click extends a range.

- [ ] Support pointer dragging, word selection, and keyboard selection. Show the
  menu after pointer selection finishes or keyboard selection briefly settles,
  without interrupting an active drag or input-method composition.
- [x] **COMPLETED** — Position the menu using the actual selection geometry, clamp it within the
  visible workspace, and avoid obscuring the text being acted on.
- [ ] Update or dismiss it when the selection changes, collapses, scrolls out of
  view, or the writer switches panes. Escape dismisses it without losing selection;
  provide a keyboard command to reopen it for the same selection.
- [x] **COMPLETED** — Opening automatically must not steal typing focus. Support explicit keyboard
  entry into the menu, labeled actions, and returning focus to the source pane.
- [x] **COMPLETED** — Preserve selection when clicking an implemented action. Menu focus must not accidentally
  retarget the operation to a different note or clear its range.
- [x] **COMPLETED** — Capture pane ID, note ID, revision, selected text, and range for each implemented action.
  Validate that target before applying a delayed result.
- [ ] Handle unavailable clipboard access, read-only notes, missing voices, and
  disconnected AI providers with clear action availability and recovery.
- [x] **COMPLETED** — Show the menu without starting speech, reading the clipboard, performing
  a lookup, or sending selected text to an AI provider until an action is invoked.

### Cursor and result behavior

- [ ] Keep the insertion caret visible in the focused writing pane, with settings
  for caret appearance and blinking, and clear inactive-pane selection styling.
- [ ] Preserve familiar word/paragraph navigation and selection extension across
  wrapped lines, Unicode text, and pane resizes.
- [x] **COMPLETED** — Keep speech progress highlighting in a separate captured-text
  preview; listening does not move the editing caret or overwrite the selection.
  Hide progress when the source changes. Source-editor overlays remain future work.
- [x] **COMPLETED** — After toolbar paste, place the caret after the inserted text;
  one undo restores the original text and selection. Later typing is a separate
  undo group. Native Undo/Redo now reaches the note engine.
- [x] **COMPLETED** — Apply the same caret and undo behavior to accepted AI replacements.
- [x] **COMPLETED** — Present AI output for review with replace-selection, insert-after, or keep-as-
  new-note options. A stale document revision requires reconciliation before an
  edit is applied; changing focus must never redirect an AI result.
- [x] **COMPLETED** — Keep lookup and AI results associated with their source passage, with a way
  to return to that note and location.

This automatic menu applies to writing panes. Terminal selection and mouse
reporting retain their terminal behavior. Lookup uses active macOS dictionaries
offline. AI supports explicit Ollama, Anthropic, and OpenAI requests, with Rewrite,
Explain, Summarize, Expand, or custom instructions. Opening review does not send
text. Cancellation and tab closure ignore late output. Reviews are temporary;
apply or keep as a note to retain results after restart. Live cloud-provider
generation has not been tested with credentials. Additional cursor gestures and
multiple selections remain design decisions.

## 1.3 — Read writing aloud

- [x] **COMPLETED** — Read selected text, including unsaved edits, with installed
  macOS voices. Voice opens controls; Read selection starts playback explicitly.
- [ ] Read the current paragraph, from the cursor onward, or the whole document.
- [x] **COMPLETED** — Provide play, pause, resume, and stop for the captured passage.
- [ ] Provide previous/next passage navigation.
- [x] **COMPLETED** — Choose a voice and language; adjust speaking rate and volume. Show additional
  controls such as pitch or style only when supported by the selected engine.
- [x] **COMPLETED** — Highlight spoken words in the captured-text preview using
  native UTF-16 range callbacks; ignore invalid and stale progress events.
- [x] **COMPLETED** — Keep playback controls accessible while the writer edits or changes panels.
- [ ] Support long documents through bounded chunks, buffering, and cancellation.
- [ ] Define how headings, links, lists, code blocks, and punctuation are spoken
  for the chosen document format, without modifying the source document.
- [ ] Add pronunciation substitutions for names and recurring terms, with a preview
  of the spoken text and a mapping back to the original passage.
- [x] **COMPLETED** — Remember the last voice, rate, and volume locally without
  persisting captured passages or playback jobs.
- [ ] Save reusable reading presets.

Proposed editing behavior: each playback job uses a specific document revision.
Editing does not silently change queued speech. Offer restart from the revised
passage, and suppress stale highlights when source positions no longer match.
Stopping must also cancel queued synthesis and discard late audio/events.

## 1.4 — Voices & Models workspace

Create a dedicated area for finding a suitable voice and engine, auditioning it,
and making it available to the writing workflow.

Proposed sections:

| Section | Writer's task |
| --- | --- |
| My Voices | Browse available Apple voices, installed models, connected providers, and favorites. |
| Discover | Search compatible speech models and services by language, hardware, offline use, and intended use. |
| Compare | Listen to the same passage with multiple voices and save preferences. |
| Downloads & Connections | Manage supported local installations, storage, provider connections, and availability. |

### Discovery and compatibility

- [ ] Combine a curated set of supported integrations with searchable catalog
  metadata. Proposed initial catalog source: Hugging Face.
- [ ] Display model/provider name, voice choices, languages, source link, version,
  license information, and when the metadata was last checked.
- [ ] Show local/cloud/system execution, download size, expected hardware needs,
  supported controls, export support, and pricing information where available.
- [ ] Distinguish catalog listings from integrations BusterMark can actually run:
  available, installable, connection required, unsupported, or unverified.
- [ ] Filter for the writer's Mac architecture and available memory. Mark unknown
  requirements as unknown rather than claiming compatibility.
- [ ] Cache catalog results for offline browsing and expose refresh status.
- [ ] Install only through implemented runtime adapters, with pinned model
  revisions, progress, cancellation, integrity checks, and storage management.
- [ ] Keep the last working installation usable if an update fails.

Hugging Face supports model search/filtering and model-card metadata such as
language, task, library, and license. These can seed the catalog; they do not
establish runtime compatibility or voice quality. See [Hub search](https://huggingface.co/docs/huggingface_hub/guides/search)
and [model cards](https://huggingface.co/docs/hub/model-cards).

### Finding the best model for the writer

“Best” should reflect the writer's language, machine, budget, and listening task.

- [ ] Audition a shared sample or a selected passage from the current draft.
- [ ] Compare pronunciation, naturalness, pacing, expressiveness, and long-form
  consistency through listening and personal ratings.
- [ ] Measure time to first audio and generation speed; record hardware, model
  revision, settings, and cold/warm start conditions alongside results.
- [ ] Show measured values separately from provider claims and estimates.
- [ ] Let writers prioritize offline use, responsiveness, quality, or cost and
  explain why a candidate fits those preferences.
- [ ] Save favorites and comparison results. Popularity alone must not be presented
  as a quality ranking.

## 1.5 — Native macOS speech

First engine: Apple's AVSpeechSynthesizer, accessed through a small Objective-C
ARC bridge behind Rust commands. Synthesizer/delegate ownership and controls stay
on the macOS main thread. Each job has its own synthesizer; late callbacks cannot
retarget a newer reading. There is no cloud fallback.

Apple recommends `AVSpeechSynthesizer` in place of the older `NSSpeechSynthesizer`.
Its delegate provides speech lifecycle and spoken-range events; the audio-buffer
API supports capturing generated audio. See [Apple's migration direction](https://developer.apple.com/documentation/appkit/nsspeechsynthesizer),
[speech events](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizerdelegate),
and [audio buffers](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer/write(_:tobuffercallback:)).

- [x] **COMPLETED** — Enumerate voices exposed to the app, using stable identifiers and available
  language/quality metadata; audition them inside BusterMark.
- [x] **COMPLETED** — Implement speaking, pause/resume, stop, rate, volume, and lifecycle events.
- [ ] Map native speech ranges to document positions, including Unicode text and
  any text preprocessing, so highlights follow the correct source passage.
- [x] **COMPLETED** — Link to Apple's macOS voice-management instructions and
  provide an explicit Refresh voices action after managing downloads.
- [ ] Automatically refresh the available voice list when the writer returns.
- [x] **COMPLETED** — Handle removed voices or unavailable languages with an explicit replacement
  choice rather than silently switching to a cloud service.
- [ ] Validate offline operation with downloaded voices on supported macOS versions.
- [ ] Verify which voice capabilities and export paths work on the minimum supported
  macOS version; gate newer features individually.

macOS lets users preview and download additional system voices through Accessibility
settings. Apple manages these downloads; BusterMark should not promise its own
installer for Apple voice assets. Only advertise voices the public app API actually
exposes. See [Apple's voice-management guide](https://support.apple.com/guide/mac-help/change-the-voice-your-mac-uses-to-speak-text-mchlp2290/mac).

The current app declares macOS 10.15 as its minimum. Whether to retain that target
is an explicit implementation decision. Personal Voice integration, if included,
needs a separate availability and authorization check before being advertised.

## 1.6 — Speech engine architecture

Use one speech service with adapters for Apple system speech, supported local
models, and any selected cloud providers.

```text
Writing controls / Voices & Models / AI commands
                       │
              Shared command dispatcher
                       │
              Rust speech service
          ┌────────────┼─────────────┐
     Apple adapter  Local runtime  Cloud adapter
          └────────────┼─────────────┘
             Playback / export / events
```

- [ ] Define common voice identities, capability discovery, synthesis requests,
  audio formats, progress events, and structured errors.
- [ ] Keep native synthesis, local inference, and network requests off the UI thread.
- [ ] Normalize audio format handling and ensure only one foreground audition or
  reading session plays at a time; export jobs can run independently.
- [ ] Model job states explicitly: preparing, synthesizing, playing, paused,
  completed, canceled, and failed.
- [ ] Bound audio buffering/cache growth; key reusable audio by source text,
  engine/model revision, voice, and synthesis settings.
- [ ] Recover cleanly from missing model files, provider failures, audio-device
  changes, and app shutdown without leaving background playback running.
- [ ] Show whether a selected engine processes text locally or sends it to a
  provider, including estimated charges when known. Follow the writer's existing
  connection/usage choices; never silently route local requests to the cloud.

A common interface must preserve capability differences. Exact seeking or word
timestamps may require rendered audio or alignment; unsupported features must be
reported honestly, with passage-level navigation as the baseline.

## 1.7 — Audio export

- [ ] Export a selection or complete document using the chosen voice and settings.
- [ ] Establish WAV as the initial proposed export format; evaluate compressed
  formats based on the chosen encoder and platform support.
- [ ] Show progress, cancel exports, and avoid publishing partial files as completed
  output. Confirm the destination through the normal app save workflow.
- [ ] Preserve chunk order and consistent audio format across a long document.
- [ ] Record the source revision and voice/model settings with export job history.

Apple's buffer API is the starting point for native export. Validate individual
voice support before enabling export; providers may have different output options.

## 1.8 — Internal CLI and AI coverage

Pane, note, selection, and speech features use Phase 0's shared command contract.
Reuse its document and panel operations where appropriate; notes are writing
documents, not a second competing content store. Proposed command names:

**Implemented in this increment:** `document create`, all six pane commands below,
and `layout inspect`, alongside the Phase 0 catalog. Human CLI and AI dispatch
share these actions, with request-ID retry protection. The remaining commands in
the table are planned. See [current command reference](../../docs/internal-commands.md).
The selection increment also implements `selection read`, `selection set`,
`selection copy`, and `selection paste`, bringing the current catalog to 23 commands.

| Area | Commands |
| --- | --- |
| Notes | `document create`, `document list`, `document open`, `document save` with explicit pane targeting |
| Panes | `panel split`, `panel focus`, `panel resize`, `panel swap`, `panel zoom`, `panel close` |
| Layout | `layout inspect`, `layout save`, `layout restore` |
| Cursor and selection | `cursor get`, `cursor set`, `selection read`, `selection set` |
| Selection actions | `selection copy`, `selection paste`, `selection lookup`, `selection ai`, and range-targeted `speech read` |
| Engines and voices | `speech engines list`, `speech voices list`, `speech voices preview` |
| Discovery | `speech models search`, `speech models inspect`, `speech models compare` |
| Model lifecycle | `speech models install`, `speech models remove`, `speech models status` |
| Reading | `speech read`, `speech pause`, `speech resume`, `speech stop`, `speech navigate` |
| Preferences | `speech presets list`, `speech presets save`, `speech voice set` |
| Export | `speech export` |
| Job control | Phase 0's `job status`, `job cancel`, and `events subscribe` |

Text actions identify the pane, document revision, and range or explicit text;
speech requests also identify the voice/engine and settings. Long operations
return job IDs. Events report progress and source positions where available.
Repeating a request ID must not create duplicate notes, splits, edits, playback,
exports, or downloads. UI and AI operate the same live workspace and playback state.

## Proposed delivery sequence

1. Establish pane/note identity, persistence, splitting, focus, resizing, and
   keyboard navigation. Verify new-note creation beside an existing draft.
2. Build cursor/selection state and the automatic menu, starting with copy/paste
   and then connecting lookup and selection-scoped AI through shared commands.
3. Prove the macOS bridge: list voices, speak a sample, stop it, receive progress,
   and capture an audio buffer on the target macOS versions.
4. Connect the selection menu and live note text to reading controls and internal
   commands; use the existing editor temporarily if the rebuilt surface is not ready.
5. Build My Voices and Compare around native voices, with reusable sample passages.
6. Add model discovery, compatibility metadata, and one selected local runtime;
   evaluate a cloud integration using the same comparison workflow.
7. Complete long-document handling, export, failure recovery, and end-to-end checks.

## Completion criteria

- [ ] Writers can create notes in adjacent panes, split/resize/navigate/maximize
  them, and restore their arrangement and unsaved writing after restart.
- [ ] Pane rearrangement and closure preserve note identity and content; multiple
  views of a note remain synchronized without sharing cursor positions.
- [ ] Pointer and keyboard text selection automatically open the action menu with
  working voice, copy, paste, lookup, and AI actions.
- [ ] Menu interaction preserves selection and focus; delayed actions target the
  captured note and revision even if the writer changes panes.
- [ ] Paste and accepted AI edits are undoable, and speech highlighting leaves the
  editing caret and selection intact.
- [ ] A writer can listen to selected or full unsaved document text with working
  playback controls, understandable progress, and accurate available highlighting.
- [ ] macOS voices can be discovered, previewed, selected, and used without cloud
  credentials; the route to managing additional Apple voices is clear.
- [ ] The Voices & Models workspace supports discovery, filtering, comparison,
  favorites, and truthful compatibility/availability information.
- [ ] At least one selected non-Apple engine works through the same service and
  comparison flow; the local/cloud choice is recorded before implementation.
- [ ] Supported voices can export a complete audio file that plays successfully.
- [ ] AI and human commands can operate the same panes, notes, selections, and
  speech jobs.
- [ ] Verification covers long text, Unicode, edits during playback, cancellation,
  missing voices/models, offline use, and provider failures where applicable.
- [ ] Interaction checks cover keyboard-only use, selection at pane edges, wrapped
  text, resizing, IME composition, stale AI results, undo, and clipboard failure.
- [ ] The retained terminal and writing/save workflows still work.

## Decisions to resolve as the phase develops

- Revisit pane styling and the six-pane limit after use. Initial bindings use
  direct shortcuts with customization; a tmux-style prefix remains optional future work.
- Decide whether lookup needs a configured search provider beyond the implemented
  offline macOS dictionary integration.
- Additional special cursor behavior beyond the selection workflow defined here.
- Initial languages and listening use cases: proofreading, narration, or both.
- First local model/runtime and whether a cloud adapter ships in this phase.
- Minimum macOS version and required Intel/Apple Silicon coverage.
- Default placement of the voice workspace and persistent playback controls.
- Whether Personal Voice belongs in this phase.
- Additional export formats and how long generated audio/comparisons are retained.

Technical references were checked while drafting. Recheck API availability and
model/provider metadata when choosing and implementing the integrations.
