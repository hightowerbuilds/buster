# Phase 2 — Word-processing interface and model-controlled appearance

Status: **ROADMAP DRAFT — implementation has not started.**

Build on the [writing workflow](writing-workflow.md), [Phase 1](phase-1.md), and
[shared internal commands](../../docs/internal-commands.md). Phase 1 remains
paused with its unfinished tasks intact. This document starts Phase 2's scope;
it does not mark those earlier tasks complete.

## Direction

Keep the minimalist writing workspace and give the draft more breathing room.
Add a compact formatting toolbar across the top of the writing area, with a
clear entry point to an AI search portal. Let the model shape the appearance and
feel of writing through the same internal CLI that operates the app's features.

The default should stay quiet and comfortable. A broad set of optional appearance
and typing effects should allow the writer and model to create different writing
environments without expanding the everyday toolbar into a large settings panel.

## Confirmed scope

- Preserve the minimalist approach and the Tauri/Rust–SolidJS architecture.
- Add visible padding around text in Markdown files.
- Put basic formatting controls across the top: headings, bold, italic, unordered
  lists, and ordered lists.
- Include a button that opens the planned AI search portal.
- Expose writing appearance and a wide range of visual/typing effects through
  the internal CLI so the model can inspect and manipulate them.

Details below are proposed behavior and acceptance tasks. The portal's exact
search experience and the final effect catalog are still to be defined.

## 2.1 — Markdown writing space

- [ ] Add top, bottom, left, and right text padding to Markdown writing panes,
  including untitled Markdown notes.
- [ ] Establish a comfortable default inset and allow it to be adjusted. Starting
  proposal: 24 px horizontally and 20 px vertically, reduced in narrow panes.
- [ ] Support an adjustable writing-column width and alignment, including a
  centered column for wide panes. Keep a usable text width in small splits.
- [ ] Apply the same geometry to drawing, wrapping, pointer hit testing, caret
  placement, selection, scrolling, IME composition, and the selection-action menu.
- [ ] Keep the first and last lines reachable and visible at the padded edges.
- [ ] Preserve cursor, selection, scroll position, and note identity when padding,
  column width, or pane dimensions change.
- [ ] Treat spacing as presentation state. It must not insert whitespace into
  Markdown, dirty the document, or change saved file contents.

The retained canvas editor needs a shared content rectangle for these operations;
adding a visual margin alone will not keep pointer and caret positions correct.

## 2.2 — Compact formatting toolbar

Proposed placement: one shared row at the top of the writing area, below the tab
bar, targeting the active writing pane. Pane layout controls remain available.
The row stays visible while the document scrolls and adapts to narrow windows.

| Control | Initial behavior |
| --- | --- |
| Heading | Paragraph and H1–H6 choices; set the Markdown heading level for the current or selected lines. |
| Bold | Toggle `**…**` around selected text; with no selection, create a paired marker and place the caret inside it. |
| Italic | Toggle `*…*` around selected text; with no selection, create a paired marker and place the caret inside it. |
| Unordered list | Toggle bullet markers on the current line or selected lines. |
| Ordered list | Apply or remove an ordered list across the current line or selected lines. |
| AI search | Open the AI search portal while retaining the writing context. |

- [ ] Implement these controls through shared formatting commands, with tooltips,
  accessible names, keyboard access, and visible active/mixed formatting states.
- [ ] Capture the source pane, document, revision, and range before toolbar focus
  moves. Opening a heading menu must not lose or redirect the target selection.
- [ ] Make each formatting action one undoable edit, with a predictable resulting
  selection/caret. A stale target returns a clear error without changing the note.
- [ ] Define toggling and conversion for already formatted text, partial selections,
  multiple lines, list indentation, existing numbering, and empty lines.
- [ ] Respect fenced code, inline code, literal Markdown characters, and hard
  breaks. Avoid double-wrapping existing emphasis or damaging unrelated syntax.
- [ ] Disable unavailable formatting actions when a terminal or supporting tool
  is active, with a clear route back to the note.
- [ ] Keep direct Markdown typing, source files, existing selection actions,
  speech controls, and pane shortcuts working alongside the toolbar.

Formatting edits the Markdown source. The exact balance between visible Markdown
markers and styled in-editor rendering is a separate presentation decision.

## 2.3 — AI search portal entry point

“AI search portal” is the working name for the experience opened by the toolbar
button. The entry point is confirmed; search providers and result behavior are
not yet selected.

- [ ] Add a clearly labeled AI search button with a shared open/focus command.
- [ ] Open or focus the portal as a supporting pane while retaining the source
  note, selection, and a way to return. Define a usable fallback at the pane limit.
- [ ] Provide a query field. Selected text may be offered as an editable query;
  opening the portal alone does not submit a search or send document context.
- [ ] Show the chosen search scope and included context before submission.
- [ ] Decide whether the first portal searches workspace notes, the web, a model,
  or a combination, then define its results and provider requirements.
- [ ] Define result actions such as opening a source, keeping a result as a note,
  or sending a passage to the existing AI review workflow. Any draft insertion
  must have an explicit, undoable apply action.

The existing dictionary lookup and selection AI review provide useful integration
points. The portal needs its own concrete interaction design before implementation
can claim search functionality.

## 2.4 — Writing appearance and typing effects

Give the model broad, structured control over the writing surface. Start with
basic layout and typography, then expand the visual-effect catalog. All effect
families below are candidates for implementation, not currently available features.

| Family | Proposed controls |
| --- | --- |
| Writing layout | Text padding, column width, alignment, line height, paragraph spacing, and page-like backgrounds. |
| Typography | Font family, size, weight, text color, and heading appearance. |
| Caret and selection | Caret shape, width, color, blink, glow/trail, selection color, and active-line treatment. |
| Focus | Current-line or paragraph emphasis, surrounding-text dimming, and optional typewriter-style vertical positioning. |
| Typing feedback | Brief keypress pulses, caret ripples, character entrance effects, and fading trails. |
| Atmosphere | Background tints/gradients, grain, vignette, soft glow, and gradual color transitions. |
| Composition | Combine effects into named writing appearances, with intensity, duration, and motion settings. |

- [ ] Keep the default appearance minimal; optional effects should be discoverable
  without adding persistent controls for every property to the formatting toolbar.
- [ ] Inventory existing appearance/effect settings and expose reusable behavior
  through the shared service before introducing duplicate controls.
- [ ] Define supported property types, units, ranges, defaults, and combinations.
  Expose renderer capabilities so the model can distinguish supported effects
  from proposed or unavailable ones.
- [ ] Support inspecting and changing multiple appearance properties together,
  with a preview, apply, revert, and reset path.
- [ ] Propose explicit application, workspace, and pane scopes; document which
  scope wins and how saved preferences and temporary overrides interact.
- [ ] Keep appearance history separate from text undo. Resetting an effect must
  restore appearance without undoing writing or changing a Markdown file.
- [ ] Let the writer override model changes, stop animations, and return to a
  familiar appearance through visible controls and the CLI.
- [ ] Honor reduced-motion preferences, preserve readable text and caret contrast,
  and keep selection/speech highlights distinguishable.
- [ ] Bound animation work and clean up timers/render loops when effects are
  disabled or panes close. Verify typing remains responsive with several panes.

The model operates named, implemented capabilities through structured commands.
The effect system should provide enough parameters for varied visual compositions
without depending on injected scripts or arbitrary stylesheet execution.

## 2.5 — Internal CLI and model capabilities

UI controls and model calls must use the same formatting and appearance services.
The following command families are proposals; the implemented catalog remains
at 39 commands until new handlers are built and verified.

| Area | Proposed commands |
| --- | --- |
| Formatting | `format inspect`, `format heading`, `format bold`, `format italic`, `format list` |
| Appearance | `appearance inspect`, `appearance capabilities`, `appearance preview`, `appearance apply`, `appearance revert`, `appearance reset` |
| Effects | `effects list`, `effects inspect`, `effects set`, `effects stop` |
| Saved appearances | `appearance presets list`, `appearance presets save`, `appearance presets apply` |
| Portal | `search portal open`; search submission/result commands follow the portal design decision. |

- [ ] Publish schemas, descriptions, examples, availability, and readable errors
  for every implemented command.
- [ ] Target formatting by stable pane/document identity, revision, and range;
  target appearance by explicit scope and stable IDs, rather than whichever pane
  happens to have focus when asynchronous work finishes.
- [ ] Return the effective appearance and its revision, including inherited
  values. Detect stale updates instead of silently replacing newer user choices.
- [ ] Validate an appearance patch before applying it so unsupported properties
  cannot leave a half-applied visual state. Repeated request IDs must not create
  duplicate edits, animations, portal panes, or saved appearances.
- [ ] Keep human command entry and in-app model invocation aligned with the
  existing command service. Connecting an external agent transport remains a
  separate integration decision.

## Proposed delivery order

1. Add and verify Markdown padding and writing-column geometry.
2. Build the compact toolbar and undoable heading/emphasis/list commands.
3. Define the AI search portal's first scope and implement its toolbar entry point.
4. Expose layout and typography inspection/changes through the internal CLI.
5. Add the effect catalog, preview/revert, presets, and model capability discovery.
6. Verify pane behavior, keyboard/IME editing, persistence, and performance together.

## Completion criteria

- [ ] Markdown drafts have comfortable adjustable padding, with correct wrapping,
  caret placement, pointer selection, scrolling, and pane resizing.
- [ ] The top toolbar provides working headings, bold, italic, unordered lists,
  ordered lists, and a working entry into the defined AI search portal.
- [ ] Formatting preserves Markdown content outside its target and undoes in one step.
- [ ] The model can discover, inspect, and change supported writing appearances
  and effects through documented CLI commands with explicit targets.
- [ ] Appearance changes can be previewed, reverted, reset, and saved as designed;
  user overrides and reduced-motion preferences remain effective.
- [ ] Richer effects retain responsive typing and readable content across panes.
- [ ] Notes, terminal behavior, selection actions, AI review, and macOS reading
  continue to work. Completed tasks are marked **COMPLETED** only after verification.

## Decisions for the next design pass

- Final padding, column width, and typography defaults.
- Shared toolbar placement versus a toolbar within each writing pane.
- How much Markdown syntax remains visible during styled editing.
- AI search portal name, search sources, query/context rules, and result layout.
- First typing effects to ship and the limits of their combinations.
- Appearance scope precedence, persistence, and how model changes are presented
  for the writer to adjust or reverse.
