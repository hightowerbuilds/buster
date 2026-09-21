# BusterMark — first writing workflow

Phase 0 implementation brief, September 20, 2026. These decisions define the
initial Phase 1 workflow. Writing panes, Copy/Paste, local dictionary lookup, and
selection-scoped AI review, and macOS selected-text speech are implemented.
Whole-document speech, audio export, and speech model discovery remain to build.

## Documents and storage

Start with local UTF-8 Markdown (`.md`) and plain-text (`.txt`) files. A workspace
is an ordinary directory; the writer owns the files. No database or proprietary
document format is needed for this first version. Preserve whitespace, including
Markdown's two-space hard breaks. Rich text, attachments, and publishing are later
decisions.

New Note creates an untitled buffer immediately in the active writing pane.
Save chooses a location and filename, with Markdown as the initial suggested
format. Open loads an existing file into a note pane; opening the same document
again focuses its existing buffer. Save As creates a named copy. Dirty-close
offers Save, Discard, or Cancel. Undo/redo stays within the live document engine.
The File menu and pane toolbar provide this flow. New drafts use `Note-N.md`
labels while remaining untitled until saved.

Session recovery stores unsaved drafts separately from named files. Each untitled
buffer has a unique identity; committed sessions reference specific backup
revisions. A failed or unsupported restore preserves the prior recovery files
and pauses session saves. Recovery is periodic and is not a guarantee that every
keystroke before a crash survives. Backup pruning and recoverability UI are
follow-up work; older revisions are currently retained.

## Editor and workspace

Retain the existing canvas editor and text engine for the first implementation.
Reuse editing, selection, undo, search, local file access, and Markdown preview.
Phase 1 adds tmux-like split panes, note creation in panes, keyboard navigation,
and durable pane layout. This first increment supports six panes and one live
view per document; synchronized duplicate views remain planned. Legacy sessions
restore supported tabs in a single pane because they did not persist a split tree.

```text
Writing workspace
┌────────────────────────────┬────────────────────────┐
│ Draft / active selection   │ Notes or second draft  │
│                            │                        │
├────────────────────────────┴────────────────────────┤
│ Optional terminal — existing PTY and shell          │
└─────────────────────────────────────────────────────┘
Selection → Voice · Copy · Paste · Look up · AI
AI → instruction → proposed revision → Apply / Discard
```

AI review opens beside the writing context. Voice controls operate on a selection
or document; Voices & Models is a dedicated tool pane. Terminal input and internal
app commands keep distinct entry points. The terminal remains optional and keeps
its existing emulator, selection, clipboard, search, scrollback, and settings.

## First AI interaction: revise a selection

1. Select text and choose AI from the contextual menu.
2. Enter an instruction such as “make this paragraph clearer.”
3. Generate sends only the selected text and explicit instruction. Document ID,
   revision, and selected range stay inside the app for validation. Surrounding
   paragraphs are not included in this increment. The pane explains the context
   before sending; other files, terminal output, and clipboard contents are excluded.
4. Stream a proposed replacement into a review view; allow cancellation. The
   original document remains editable and unchanged while the request runs.
5. Apply checks the document revision and selected range. If the document changed,
   report that the proposal is stale and require a fresh selection/review. Never overwrite a
   newer draft automatically.
6. Apply becomes one undoable edit. Discard leaves the document untouched. Saving
   to disk remains a separate action, respecting an explicitly enabled autosave
   setting.

Carry forward the existing Ollama, Anthropic, and OpenAI transport/configuration
code, streaming, cancellation, and credential storage. Replace code-completion
prompts for this flow. Choose the provider/model explicitly in the UI; no new
provider account or external service is required by Phase 0. Model compatibility
must be checked when the writing request adapters are implemented.

The implemented review supports Rewrite, Explain, Summarize, Expand, and custom
instructions. Replace selection and Insert after are single undoable edits; Keep
as new note creates an unsaved draft and remains available for stale results.
Reviews are temporary until applied or kept as notes. Lookup uses the Mac's
active dictionaries offline, with setup guidance when no definition is found.

## Command ownership and acceptance

Phase 1 must implement document create/open/save, selection read, revision-bound
edit preview/apply/undo, pane split/focus, and voice/job commands through the shared
feature registry. UI and AI command callers use the same document operations.
Only advertise commands after their handlers and behavior checks exist.

Acceptance scenarios include two independent unsaved drafts surviving restart;
Markdown hard breaks surviving save; selection actions following keyboard and
mouse changes; cancellation leaving text unchanged; stale AI proposals being
rejected; Apply undoing in one step; and terminal focus surviving pane switches.
The exact Phase 1 checklist remains in [phase-1.md](phase-1.md).
