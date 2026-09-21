# Phase 2 — Word-processing interface and model-controlled appearance

Status: **COMPLETED — implementation and automated/browser acceptance checks.**

Delivered: Markdown spacing and typography, formatting toolbar, local-note search
portal, appearance previews/scopes/presets, and bounded writing effects. The shared
catalog has **66 commands**. See the [build log](../build-log/2026-09-20-phase-2.md)
for exact verification and remaining platform coverage. The next milestone is
[Phase 3 — Claude and Codex connections](phase-3.md).

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

Implementation decisions: the portal searches current open-note text locally;
model/web search joins the Claude/Codex connection milestone. Effects expose the
implemented bounded catalog below. Other effect-family ideas remain optional
future extensions, not capabilities advertised by the app.

## 2.1 — Markdown writing space

- [x] **COMPLETED** — Add top, bottom, left, and right text padding to Markdown writing panes,
  including untitled Markdown notes.
- [x] **COMPLETED** — Establish an adjustable default inset:
  24 px horizontally and 20 px vertically, reduced in narrow panes.
- [x] **COMPLETED** — Support an adjustable writing-column width and alignment, including a
  centered column for wide panes. Keep a usable text width in small splits.
- [x] **COMPLETED** — Apply the same geometry to drawing, wrapping, pointer hit testing, caret
  placement, selection, scrolling, IME composition, and the selection-action menu.
- [x] **COMPLETED** — Keep the first and last lines reachable and visible at the padded edges.
- [x] **COMPLETED** — Preserve cursor, selection, scroll position, and note identity when padding,
  column width, or pane dimensions change.
- [x] **COMPLETED** — Treat spacing as presentation state. It must not insert whitespace into
  Markdown, dirty the document, or change saved file contents.

The retained canvas editor needs a shared content rectangle for these operations;
adding a visual margin alone will not keep pointer and caret positions correct.

Implemented with one inset DOM viewport shared by canvas, GPU, overlays,
pointer input, and the hidden IME textarea. Automated tests and the real-component
browser pass verify coordinate mapping, custom line spacing, reflow anchors,
first/last-line access, resizing, composition events, and selection preservation.
Native input-method coverage and the desktop smoke details are recorded in the
build log; do not infer every OS/input method from the browser pass.

## 2.2 — Compact formatting toolbar

Placement: one shared row at the top of the writing area, below the tab
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

- [x] **COMPLETED** — Implement these controls through shared formatting commands, with tooltips,
  accessible names, keyboard access, and visible active/mixed formatting states.
- [x] **COMPLETED** — Capture the source pane, document, revision, and range before toolbar focus
  moves. Opening a heading menu must not lose or redirect the target selection.
- [x] **COMPLETED** — Make each formatting action one undoable edit, with a predictable resulting
  selection/caret. A stale target returns a clear error without changing the note.
- [x] **COMPLETED** — Define toggling and conversion for already formatted text, partial selections,
  multiple lines, list indentation, existing numbering, and empty lines.
- [x] **COMPLETED** — Respect fenced code, inline code, literal Markdown characters, and hard
  breaks. Avoid double-wrapping existing emphasis or damaging unrelated syntax.
- [x] **COMPLETED** — Disable unavailable formatting actions when a terminal or supporting tool
  is active, with a clear route back to the note.
- [x] **COMPLETED** — Keep direct Markdown typing, source files, existing selection actions,
  speech controls, and pane shortcuts working alongside the toolbar.

Formatting edits the Markdown source. The exact balance between visible Markdown
markers and styled in-editor rendering is a separate presentation decision.

## 2.3 — AI search portal entry point

The **AI search** toolbar button opens **Search portal**. Phase 2 searches open
notes locally, including unsaved text. The query is editable and is submitted
explicitly. Results can open a match, be kept as a note, or open AI review without
starting generation. At the pane limit, supporting views reuse a pane while
retaining source tabs and engines. Claude/Codex and web search follow in Phase 3.

- [x] **COMPLETED** — Add a clearly labeled AI search button with a shared open/focus command.
- [x] **COMPLETED** — Open or focus the portal as a supporting pane while retaining the source
  note, selection, and a way to return. Define a usable fallback at the pane limit.
- [x] **COMPLETED** — Provide a query field. Selected text may be offered as an editable query;
  opening the portal alone does not submit a search or send document context.
- [x] **COMPLETED** — Show the chosen search scope and included context before submission.
- [x] **COMPLETED** — Decide whether the first portal searches workspace notes, the web, a model,
  or a combination, then define its results and provider requirements.
- [x] **COMPLETED** — Define result actions such as opening a source, keeping a result as a note,
  or sending a passage to the existing AI review workflow. Any draft insertion
  must have an explicit, undoable apply action.

The existing selection AI review is reused for explicit result review. Local search
is operational; opening it does not make a model or web request.

## 2.4 — Writing appearance and typing effects

Give the model broad, structured control over the writing surface. Start with
basic layout and typography, then expand the visual-effect catalog. Implemented:
font size, measured line spacing, theme/paper/midnight/sage colors, surrounding-line
dimming, cursor glow, vignette, grain, typing pulse intensity/duration, and motion
control. Existing global font-family and theme effects are reused. Named presets
combine these controls. The family table records the broader design space; trails,
character entrances, paragraph spacing, and per-heading fonts remain future ideas.

| Family | Proposed controls |
| --- | --- |
| Writing layout | Text padding, column width, alignment, line height, paragraph spacing, and page-like backgrounds. |
| Typography | Font family, size, weight, text color, and heading appearance. |
| Caret and selection | Caret shape, width, color, blink, glow/trail, selection color, and active-line treatment. |
| Focus | Current-line or paragraph emphasis, surrounding-text dimming, and optional typewriter-style vertical positioning. |
| Typing feedback | Brief keypress pulses, caret ripples, character entrance effects, and fading trails. |
| Atmosphere | Background tints/gradients, grain, vignette, soft glow, and gradual color transitions. |
| Composition | Combine effects into named writing appearances, with intensity, duration, and motion settings. |

- [x] **COMPLETED** — Keep the default appearance minimal; optional effects should be discoverable
  without adding persistent controls for every property to the formatting toolbar.
- [x] **COMPLETED** — Inventory existing appearance/effect settings and expose reusable behavior
  through the shared service before introducing duplicate controls.
- [x] **COMPLETED** — Define supported property types, units, ranges, defaults, and combinations.
  Expose renderer capabilities so the model can distinguish supported effects
  from proposed or unavailable ones.
- [x] **COMPLETED** — Support inspecting and changing multiple appearance properties together,
  with a preview, apply, revert, and reset path.
- [x] **COMPLETED** — Propose explicit application, workspace, and pane scopes; document which
  scope wins and how saved preferences and temporary overrides interact.
- [x] **COMPLETED** — Keep appearance history separate from text undo. Resetting an effect must
  restore appearance without undoing writing or changing a Markdown file.
- [x] **COMPLETED** — Let the writer override model changes, stop animations, and return to a
  familiar appearance through visible controls and the CLI.
- [x] **COMPLETED** — Honor reduced-motion preferences, preserve readable text and caret contrast,
  and keep selection/speech highlights distinguishable.
- [x] **COMPLETED** — Bound animation work and clean up timers/render loops when effects are
  disabled or panes close. Verify typing remains responsive with several panes.

The model operates named, implemented capabilities through structured commands.
The effect system should provide enough parameters for varied visual compositions
without depending on injected scripts or arbitrary stylesheet execution.

## 2.5 — Internal CLI and model capabilities

UI controls and model calls must use the same formatting and appearance services.
The implemented catalog has **66 commands**. Commands below are implemented;
[internal commands](../../docs/internal-commands.md) documents schemas, examples,
validation, and availability.

| Area | Implemented commands |
| --- | --- |
| Formatting | `format inspect`, `format heading`, `format bold`, `format italic`, `format list` |
| Appearance | `appearance inspect`, `appearance capabilities`, `appearance preview`, `appearance preview cancel`, `appearance apply`, `appearance revert`, `appearance reset` |
| Effects | `effects list`, `effects inspect`, `effects set`, `effects stop` |
| Saved appearances | `appearance presets list`, `appearance presets save`, `appearance presets apply`, `appearance presets delete` |
| Portal | `search portal open`, `search query`, `search read`, `search source`, `search keep`, `search review`, `search portal close` |

App defaults and workspace overrides persist locally; pane overrides last the
session. Pane wins over workspace, then app defaults. A temporary preview does
not persist. Updates require the inspected appearance revision. Twenty committed
appearance changes can be reverted independently of document undo.

- [x] **COMPLETED** — Publish schemas, descriptions, examples, availability, and readable errors
  for every implemented command.
- [x] **COMPLETED** — Target formatting by stable pane/document identity, revision, and range;
  target appearance by explicit scope and stable IDs, rather than whichever pane
  happens to have focus when asynchronous work finishes.
- [x] **COMPLETED** — Return the effective appearance and its revision, including inherited
  values. Detect stale updates instead of silently replacing newer user choices.
- [x] **COMPLETED** — Validate an appearance patch before applying it so unsupported properties
  cannot leave a half-applied visual state. Repeated request IDs must not create
  duplicate edits, animations, portal panes, or saved appearances.
- [x] **COMPLETED** — Keep human command entry and in-app model invocation aligned with the
  existing command service. Connecting an external agent transport remains a
  separate integration decision.

## Delivery order

1. Add and verify Markdown padding and writing-column geometry.
2. Build the compact toolbar and undoable heading/emphasis/list commands.
3. Define the AI search portal's first scope and implement its toolbar entry point.
4. Expose layout and typography inspection/changes through the internal CLI.
5. Add the effect catalog, preview/revert, presets, and model capability discovery.
6. Verify pane behavior, keyboard/IME editing, persistence, and performance together.

## Completion criteria

- [x] **COMPLETED** — Markdown drafts have comfortable adjustable padding, with correct wrapping,
  caret placement, pointer selection, scrolling, and pane resizing.
- [x] **COMPLETED** — The top toolbar provides working headings, bold, italic, unordered lists,
  ordered lists, and a working entry into the defined AI search portal.
- [x] **COMPLETED** — Formatting preserves Markdown content outside its target and undoes in one step.
- [x] **COMPLETED** — The model can discover, inspect, and change supported writing appearances
  and effects through documented CLI commands with explicit targets.
- [x] **COMPLETED** — Appearance changes can be previewed, reverted, reset, and saved as designed;
  user overrides and reduced-motion preferences remain effective.
- [x] **COMPLETED** — Richer effects retain responsive typing and readable content across panes.
- [x] **COMPLETED** — Notes, terminal behavior, selection actions, AI review, and macOS reading
  continue to work. Completed tasks are marked **COMPLETED** only after verification.

## Resolved decisions and follow-up

- Default padding stays 24 px horizontal / 20 px vertical, with fill-width columns.
- A shared formatting toolbar sits above the existing pane controls.
- Markdown source remains editable and visible; formatting edits its source.
- The portal starts with open-note search. Network/model search follows Phase 3.
- Appearance controls use app/workspace/pane scope and a temporary preview; the
  visible dialog, Stop effects, reset, and revert let the writer override changes.
- Reduce Motion suppresses typing pulses; loops are bounded and inactive panes
  do not animate. Capability discovery lists supported controls and limitations.
- The Claude/Codex connection UI and agent command loop are specified separately
  in [Phase 3](phase-3.md); those connections are not claimed as implemented here.
