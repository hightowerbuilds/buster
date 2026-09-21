# Phase 0 — BusterMark foundation

Status: In progress — foundation, debugger retirement, and writing brief implemented; desktop foundation verified; terminal scrollback repair outstanding.

Progress and verification: [September 20 build log](../build-log/2026-09-20-phase-0.md).
Completed tasks use `[x] COMPLETED`; unchecked tasks remain outstanding.

## Direction

Buster is becoming **BusterMark**, a writing workbench with AI integration.
Phase 0 establishes the new identity, determines which parts of the existing IDE
to remove, and preserves the foundation needed for the rebuild.

The previous roadmaps and session summaries are [archived](../archive/2026-09-20-pre-rebuild/README.md).
They provide historical context, not requirements for BusterMark.

## Confirmed decisions

- Rename the application **BusterMark**.
- Rebuild the product around writing with AI integration.
- Keep the integrated terminal.
- Keep the existing architecture split: **Tauri and Rust for the desktop backend,
  SolidJS and TypeScript for the frontend**.
- Build a comprehensive internal CLI that AI can use to discover, inspect, and
  manipulate application features. This is an app-native tool interface with
  MCP-like discoverability; adopting the external MCP protocol is not yet decided.

The first writing workflow uses local Markdown/plain-text files and the existing
canvas editor. The [writing brief](writing-workflow.md) defines the initial
selection-revision interaction and the Phase 1 workspace relationship.

## 0.1 — Rename the application

- [x] **COMPLETED** — Update the product name, window title, HTML title, and welcome screen.
- [x] **COMPLETED** — Replace the IDE description with language describing the writing workbench.
- [x] **COMPLETED** — Update package metadata, active documentation, and release display names.
- [x] **COMPLETED** — Review installer categories and other IDE-specific packaging metadata.
- [x] **COMPLETED** — Decide whether to retain the existing application identifier or introduce a
  new BusterMark identifier before changing settings and session storage locations.
- [x] **COMPLETED** — Inventory internal names, extension paths, credential identifiers, and updater
  URLs; distinguish names to change from compatibility references to retain.
- [x] **COMPLETED** — Preserve settings, credentials, sessions, and unsaved backups by retaining
  all storage identities; no data relocation or migration is needed.

Starting points: `src-tauri/tauri.conf.json`, `index.html`,
`src/ui/WelcomeCanvas.tsx`, `package.json`, `src-tauri/Cargo.toml`,
`.github/workflows/release.yml`, and `README.md`.

The current app identifier is `com.lukehightower.buster`. Settings and sessions use
Tauri's app configuration directory. The macOS AI credential service has its own
Buster identifier. A product rename must account for these separately.

Decision: retain `com.lukehightower.buster` and all existing storage/credential
identifiers. Package names are `bustermark`; supporting library and repository
names remain compatible. The full inventory is recorded in the build log.

Archived documents keep their historical names and content.

## 0.2 — Decide what to remove and what to reuse

The Phase 0 retirement is the debugger. Shared editor services remain available
until their writing replacements exist; retaining them here does not make them
requirements for the final product.

| Existing area | Phase 0 treatment |
| --- | --- |
| Integrated terminal and Rust PTY backend | Keep. Preserve shell behavior and settings. |
| Tauri/Rust backend and SolidJS frontend | Keep. |
| File access, open/save, file watching | Reuse for local Markdown/plain-text documents. |
| Settings, keyboard commands, tabs, and panel layout | Reuse infrastructure; evolve into note panes in Phase 1. |
| Canvas editor and text engine | Retain for the first writing workflow. |
| Markdown/Blog Mode preview | Retain as the initial preview implementation. |
| AI streaming, providers, and cancellation | Reuse transport and credentials; build selection revision/review in Phase 1. |
| Command registry and command line | Shared typed feature dispatcher implemented; extend with every feature. |
| Debugger, breakpoints, DAP client/crate | Remove now, including all UI/native wiring. |
| LSP, diagnostics, code completion/navigation, syntax | Defer removal while the current canvas editor uses these services. |
| Git, extensions, embedded browser, developer console | Keep during the initial writing transition; revisit separately. |

- [x] **COMPLETED** — Finalize the keep/remove/rebuild inventory.
- [x] **COMPLETED** — Trace shared dependencies before removing each feature.
- [x] **COMPLETED** — Remove corresponding entry points, shortcuts, state, IPC commands, listeners,
  and dependencies along with any retired interface.
- [x] **COMPLETED** — Define how old sessions containing retired panel types should load.
- [x] **COMPLETED** — Keep the app runnable after each removal step.

Dependency review: debugger state/events/menu/panels/IPC were independent of
terminal and document services. Gutter breakpoints were removed while fold markers
remain. The unused native DAP client and crate were retired. LSP symbols, Git diff
state, and syntax remain dependencies of the retained editor and file actions.
Legacy debug/unknown/transient tabs are skipped; surviving document/terminal tabs
restore in one pane. Missing unsaved backups pause session writes instead of
silently replacing the saved session.

## 0.3 — Preserve the terminal

Keep the existing terminal implementation available throughout the rebuild.
Its final placement in the writing workspace remains a design decision.

- [x] **COMPLETED** — Preserve PTY creation, input, output, resizing, and process cleanup.
- [ ] Preserve copy/paste, selection, scrollback, search, and terminal settings.
  Selection/copy/paste and search now pass desktop checks; settings remain intact.
  Fast output can lose early scrollback rows, so this task stays open. See the
  reproduction in the build log.
- [x] **COMPLETED** — Keep terminal focus and shortcuts working as the surrounding UI changes.
- [x] **COMPLETED** — Verify terminal behavior after changes to tabs, panels, or application state.

Core implementation: `src/ui/CanvasTerminal.tsx`, the `src/ui/terminal-*` modules,
`src-tauri/src/commands/terminal.rs`, `src-tauri/src/terminal/`, and
`src-tauri/crates/terminal-pro/`.

## 0.4 — Define the first writing workflow

AI integration is part of the product direction. The existing inline code
completion interface does not yet define the writing experience.

- [x] **COMPLETED** — Choose the initial document format and storage model.
- [x] **COMPLETED** — Choose the writing editor approach, including whether to retain canvas rendering.
- [x] **COMPLETED** — Define the basic workflow for creating, opening, editing, and saving a document.
- [x] **COMPLETED** — Choose the first AI interaction: for example, discussing a draft, revising a
  selection, or generating text.
- [x] **COMPLETED** — Define what document context AI receives and how the writer reviews and
  applies proposed changes.
- [x] **COMPLETED** — Decide which existing provider integrations to carry into the first version.
- [x] **COMPLETED** — Sketch the relationship between the writing surface, AI, and terminal.

The [writing brief](writing-workflow.md) defines these decisions. Completing
the full writing editor and AI experience belongs to subsequent phases.

[Phase 1](phase-1.md) establishes a tmux-like writing workspace, panel-based notes,
cursor and selection actions, text-to-speech, voice/model discovery, and macOS
speech integration. Its document flows must work with the live editor available
at that point in the rebuild.

## 0.5 — Establish the internal CLI and AI tool interface

The AI needs a documented way to operate BusterMark: discover available features,
read their current state, perform actions, and inspect the result. This command
system is part of the application foundation and should grow with every feature.

### Shared command architecture

Proposed flow:

```text
Human command entry ── CLI parser ────────┐
AI tool calls ──────── structured input ──┼─ Command registry and dispatcher
UI actions ────────── typed calls ────────┘              │
                                           Application feature services
                                             /                     \
                                   SolidJS/editor state      Rust/native services
```

Each feature exposes typed commands backed by the same operations used by the UI.
AI actions must update the visible application and its state consistently. The AI
can submit structured arguments directly; it does not need to simulate typing or
clicking to operate the app.

The retained terminal continues to run shell programs. Internal app commands use
their own dispatcher. Whether a terminal-launched AI can also connect through a
local `bustermark` executable is an open transport decision.

The legacy `src/lib/command-registry.ts` still supplies palette and hotkey actions.
The new `feature-commands.ts` dispatcher and `workbench-commands.ts` catalog provide
validated asynchronous commands for both CLI and AI callers. The command line now
executes them and displays structured results. [Usage and implementation contract](../../docs/internal-commands.md).

### Command contract

- **Discovery:** list commands by feature; provide help, argument/result schemas,
  examples, availability, and command contract versions from the registry.
- **Inputs:** stable command names, validated typed arguments, explicit workspace
  and document IDs, and request IDs. Resolve human-friendly aliases such as
  “active document” to a specific target before a mutation runs.
- **Results:** structured success or failure, stable error codes, returned data,
  and affected object IDs/revisions. Human-readable output uses the same result.
- **Live state:** reads include unsaved editor content and current selections.
  Commands act through the owning feature service rather than maintaining a
  separate AI copy of application state or bypassing the editor with disk writes.
- **Edits:** support expected document revisions, change previews, and undoable
  edit groups. Report stale revisions without overwriting newer user edits.
- **Long operations:** expose job IDs, progress, cancellation, and completion
  events. Define retry behavior so repeated requests do not duplicate mutations.
- **Composition:** define ordering and partial-failure results for multi-command
  workflows. Only advertise atomic batches where rollback is actually supported.
- **Execution context:** distinguish user and AI callers, apply existing user
  authorization, and report unavailable operations clearly. Scope access to the
  intended workspace; secret values must not appear in state responses or logs.
- **History:** make AI command activity and resulting changes inspectable. Commands
  with irreversible effects must identify those effects; terminal execution cannot
  promise document-style undo.

### Proposed command coverage

The table below describes the target command coverage. The initial 12 implemented
commands are documented in the command contract; remaining commands are future
work. The catalog includes only operations with working handlers.

| Area | Example commands |
| --- | --- |
| Discovery | `help`, `commands list`, `commands describe` |
| Application and workspace | `app status`, `workspace inspect`, `workspace open` |
| Documents | `document list`, `document open`, `document read`, `document create`, `document save` |
| Writing and selection | `selection read`, `document apply-edits`, `document undo` |
| Search | `search workspace`, `search document` |
| Workspace presentation | `panel list`, `panel focus`, `panel open`, `layout inspect` |
| Settings | `settings get`, `settings set` |
| Terminal | `terminal list`, `terminal create`, `terminal read`, `terminal send-input`, `terminal close` |
| Operations | `job status`, `job cancel`, `events subscribe`, `history list` |

A representative AI workflow is: discover the document commands, read a document
and its revision, prepare a revision-bound edit, preview/apply it according to the
writer's chosen interaction, then inspect the updated result. Applying an edit
and saving it to disk are distinct operations.

### Phase 0 deliverables

- [x] **COMPLETED** — Specify the command contract, initial catalog, and command ownership across
  the SolidJS/Rust boundary.
- [x] **COMPLETED** — Provide the in-process `commands.dispatch(request, "ai")` entry point;
  defer external terminal-agent transport and provider tool-loop wiring.
- [x] **COMPLETED** — Define one source of truth for schemas, help, and AI tool descriptions.
- [x] **COMPLETED** — Build a small end-to-end foundation: command discovery, app state inspection,
  and a retained feature action such as creating/focusing a terminal.
- [x] **COMPLETED** — Verify that human and AI invocation use the same handler and return consistent
  results; invalid arguments and unavailable targets return structured errors.
- [x] **COMPLETED** — Require each subsequent feature phase to include its command interface and
  relevant behavior checks alongside its UI.

Full command coverage develops with the writing workbench. Phase 0 establishes
the contract and proves the execution path without assuming the writing editor's
implementation has already been chosen.

## Completion criteria

- [x] **COMPLETED** — The running application and build metadata identify the product as BusterMark.
- [x] **COMPLETED** — The identity/storage compatibility decision is documented and implemented.
- [x] **COMPLETED** — The agreed Phase 0 removals are complete, including their unused wiring.
- [x] **COMPLETED** — The frontend, Rust backend, and macOS debug app bundle build
  with the Tauri/Rust–SolidJS split intact.
- [x] **COMPLETED** — Verify desktop launch and interaction in the rebuilt app.
- [x] **COMPLETED** — The integrated terminal works within the reduced application.
- [x] **COMPLETED** — Checks covering retained or changed behavior pass; terminal interaction is
  also verified in the desktop app.
- [x] **COMPLETED** — The first writing workflow and AI interaction are defined for Phase 1.
- [x] **COMPLETED** — The internal CLI contract and initial catalog are documented;
  shared discovery, live state reads, and terminal actions pass behavior tests.
  Desktop command entry and terminal output have also been exercised.
