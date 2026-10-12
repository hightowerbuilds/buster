# Text motion — Pretext-driven editing UI

Status: **IN PROGRESS.** The feasibility spike (§1), Define (§4), and the phrase spread (§4b) are
complete. A word opens Copy · Paste · Define over Bold · Italic · Spelling; a phrase opens Copy ·
Bold · Italic over Search · Count · Rephrase, all in square Courier buttons. Spelling & Grammar is
next (§5).

BusterMark replaces modal chrome with motion in the text itself. When the writer
asks something of a word, the surrounding prose moves aside, opens a space, and
shows the answer there. When the writer is done, the prose closes over it again.
No menus float above the page, and no dialog covers the writing.

Pretext (`@chenglou/pretext`, already a dependency) supplies the layout. It
calculates line breaks with arithmetic instead of DOM reflow. Its
`layoutNextLine()` accepts a different width for every line, so text can flow
around a hole. Those destination layouts can be calculated every frame without
forcing browser layout.

## Feature 1 — the Spread menu

Right-click a word (or a selection) in a note. The lines around it part like
water. Words nearest the target move first and farthest, and the motion travels
outward as a wave. The opened space holds the options: **Copy, Paste, Define,
Bold, Spelling & Grammar**.

- **Define** grows the space to fit the definition. The target word's letters
  break apart and reassemble into the definition's opening, and the rest of the
  definition streams in after them. The surrounding prose reflows again to make
  room.
- **Spelling & Grammar** asks the Language Model (the writer's Claude Code, Codex, or
  OpenCode subscription) about the word and its sentence, then reshapes the space to show the
  flagged text, suggestions, and any grammar explanation. Choosing a suggestion closes the
  space with the corrected word settling into the line.
- **Copy, Paste, Bold** act immediately. Paste and Bold animate the changed
  text into place as the prose closes.
- Escape, clicking elsewhere, scrolling, or typing closes the space, and the
  text returns to its exact original position.

It should feel wild: springy, a little overshooting, and staggered by distance.
It must still return every glyph exactly to where it started.

## What exists today

- Notes render in **ProseMirror** (`src/editor/BlockEditor.tsx`): real DOM text
  in Lato, with blog-theme typography, headings, lists, code, tables, and
  letter-spacing in some themes. ProseMirror stays synchronized with the shared
  `EditorEngine`, so engine positions, revisions, and selection commands work
  for Markdown notes.
- **No selection or context UI exists in the block editor.** The selection
  toolbar (`src/editor/SelectionActions.tsx`: Copy, Paste, Voice, Look up, AI)
  is wired only into the canvas plain-text editor. Right-clicking a note shows
  WebKit's native context menu (`spellcheck: "true"` is set on the editor).
- Catalog commands already exist for `selection copy`, `selection paste`,
  `selection lookup` (Apple Dictionary, offline, `src-tauri/src/commands/lookup.rs`),
  and bold formatting (`src/lib/writing-format.ts`, `block-editor.ts` `format("bold")`).
- **No spelling or grammar checker exists.** Rephrase and selection-scoped AI
  review (`src/lib/rephrase.ts`, `src/lib/writing-review.ts`) already send a
  captured selection one-shot through the writer's AI CLI
  (`src-tauri/src/commands/ai_cli.rs`) and validate a JSON reply. Spelling &
  Grammar builds on that path.
- Pretext is used only for measurement (`src/editor/text-measure.ts`) and the
  welcome screen (`src/ui/welcome-ascii.ts`).

## Architecture decision: a temporary motion layer, never a live-DOM edit

The editor DOM is never rearranged. Moving ProseMirror's own nodes would fight
its DOM observer, corrupt selection mapping, and risk the document. Instead:

1. **Snapshot.** When the Spread menu opens, measure the visible text in the
   viewport once: each word's (or grapheme's) rectangle from DOM `Range`
   client rects. These are the *origins*, so the first frame matches the page
   exactly, including kerning, letter-spacing, and theme fonts.
2. **Swap.** Render those units into an absolutely positioned motion layer above
   the editor, at their origins. Make the editor's text transparent while it
   stays mounted, focused, and unchanged underneath.
3. **Reflow with Pretext.** Lay out each affected paragraph again, flowing
   around the opening's rectangle. Lines beside the hole are laid out as two
   spans (left width, then right width) with `layoutNextLine()`. Lines above
   and below keep full width. These are the *destinations*.
4. **Animate** each unit from origin to destination with per-unit springs,
   staggered by distance from the target word.
5. **Close.** Animate back to origins, reveal the editor text, and remove the
   layer. Any document change (Paste, Bold, a suggestion) is applied through the
   catalog command first. The closing animation targets a fresh snapshot of the
   updated editor, so the layer always lands on the real text.

Using DOM rectangles for origins and Pretext for destinations avoids requiring
Pretext to reproduce the current layout pixel for pixel. That reproduction is
what letter-spacing, mixed fonts, and theme typography would break.

Blocks Pretext should not reflow (code blocks, tables, headings with
letter-spacing, images) move as rigid blocks. They translate away from the
opening instead of rewrapping.

## Dependencies

- The shared command catalog (`src/lib/feature-commands.ts`) and its
  revision-checked `selection *` commands. Every Spread action dispatches
  through it, so the Language Model keeps using the same paths.
- `captureSelection()` / `SelectionTarget` for stale-target protection.
- The writing appearance settings (`appearance.forTab`) for fonts, line height,
  column width, and the reduced-motion preference.

## 1 — Feasibility spike — **COMPLETED** (2026-10-11)

Verified in the real WKWebView by `scripts/native-macos-spread-smoke.js`
(25/25 checks; see `scripts/README.md`).

- [x] **COMPLETED** — Prototype in a live note: measured origins, a Pretext
  rich-inline reflow around the opening, word-level springs. Every overlay glyph
  box matches the page's on the first frame (left/top exact; right/bottom within
  WebKit's whole-pixel snapping), and Escape returns every word with 0px drift.
- [x] **COMPLETED** — Frame budget: 82 words animated in 65 frames on the
  Intel Mac (debug build). One 67ms frame remains — likely the first frame's
  style recalculation after the decorations apply; investigate in §6.
- [x] **COMPLETED** — Motion unit: words. Graphemes are reserved for the target
  word and the incoming definition (§4).
- [x] **COMPLETED** — Renderer: absolutely positioned DOM spans moved with
  `transform` (crisp text, theme colors, no atlas). Revisit canvas/WebGL only if
  grapheme-level effects exceed the frame budget.
- [x] **COMPLETED** — Fonts: canvas font strings are built from each run's
  computed style (named Lato faces); bold/italic/code runs go through
  `prepareRichInline()`.

**Finding — WebKit snaps text rects.** `Range.getClientRects()` inside the
editor returns whole-pixel rects ("below" reported 39px wide; its true advance
is 37.25px). Origins therefore come from layout arithmetic: line boxes stack at
the paragraph's line height from its content top, and x advances by canvas
widths (Pretext's own measurement source). The snapped rects only assign lines
and act as a sanity check (fall back to them beyond 1.5px disagreement).

## 2 — Motion engine (pure, testable)

- [x] **COMPLETED** — `src/editor/text-motion/flow.ts`: Pretext rich-inline
  flow around an opening (two spans per parted row, slivers left empty), with
  unit tests in `flow.test.ts`.
- [x] **COMPLETED** — `src/editor/text-motion/spring.ts`: underdamped springs
  that snap exactly to their target (`spring.test.ts`).
- [x] **COMPLETED** — `src/editor/text-motion/spread.ts`: origins, ghost
  decoration, spacer widget (margin-collapse compensated so later blocks slide
  without a jump), staggered springs with velocity tilt, exact return.
- [ ] Extend beyond the target paragraph: let neighbouring visible paragraphs
  part as well, limited to the viewport plus a margin.
- [x] **COMPLETED** — Rigid fallback: headings, letter-spaced or justified
  paragraphs, and paragraphs with inline images or hard breaks open the space
  below the block; later blocks slide down.
- [ ] Interruptible retarget, so a resize or a Define expansion mid-flight
  retargets smoothly instead of restarting.
- [ ] After an edit (Paste, Bold), close onto freshly measured origins instead
  of the current crossfade.

## 3 — Spread menu entry

- [x] **COMPLETED** — `contextmenu` in the block editor (`src/editor/SpreadMenu.tsx`)
  selects the word under the pointer, or uses a selection that contains it, and
  captures a `SelectionTarget` before anything moves. Off a word, the native
  menu is untouched.
- [x] **COMPLETED** — Keyboard entry: the context-menu key and Shift+F10.
- [x] **COMPLETED** — Real buttons in a `role="menu"` with arrow-key navigation;
  the motion layer is `aria-hidden`; keyboard entry focuses the first action.
- [x] **COMPLETED** — Copy, Paste, and Bold dispatch `selection copy`,
  `selection paste`, and `format inspect` → `format bold`; failures report the
  command's message and close.
- [x] **COMPLETED** — Dismiss on Escape, outside pointer, typing into the note,
  tab switch, window resize, and any document change. The layer scrolls with
  the note, so scrolling keeps it open.
- [x] **COMPLETED** — Reduced motion (`prefers-reduced-motion` or the writing
  style's motion off) places everything at once with no traveling words.
- [ ] Verify keyboard entry and screen-reader announcements in the native app.

## 4 — Define — **COMPLETED** (2026-10-11)

Verified in the real WKWebView by `scripts/native-macos-spread-smoke.js`
(34/34 checks): the opening grows from 69px to 254px tall, the seven letters of
"lantern" land inside it and spell the headword, no parted word overlaps the
grown opening, and Escape returns every word with 0px drift. Define's retarget
and letter flight settle in 31 frames with a worst frame of 46ms (debug app
build).

- [x] **COMPLETED** — `selection define` (read, catalog): validates the captured
  target like the other selection commands and returns `{ query, definition,
  source }` without opening a review tab. Unavailable where offline
  dictionaries are (Linux). The Language Model can call it too.
- [x] **COMPLETED** — Sizing with Pretext: the definition's pronunciation and
  senses are laid out at the opening's inner width (`prepare` + `layout`) to
  choose the opening's rows (capped at 11; longer definitions scroll inside).
- [x] **COMPLETED** — `reshape()` retargets the parted words mid-flight, so the
  opening grows without restarting the motion (§2's interruptible retarget).
- [x] **COMPLETED** — The word's letters burst out of the line, then gather and
  scale up into the headword. Letters are matched to the headword by longest
  common subsequence (`text-motion/letters.ts`): "Lanterns" keeps seven letters
  and drops the "s"; headword letters the word lacks fade in. Punctuation beside
  the word stays in the line. Closing flies the letters home.
- [x] **COMPLETED** — The pronunciation and senses stream in word by word.
  `text-motion/definition.ts` shapes Apple Dictionary text: headword,
  syllabified form and pronunciation, senses split at bullets and numbers,
  etymology and phrase sections left out.
- [x] **COMPLETED** — No entry: the opening says so in place and points to the
  macOS Dictionary app.
- [ ] Phrases and words split across formatting runs show the headword as text
  instead of flying letters; consider grapheme flight across runs.
- [ ] "Keep as note" for a definition, consistent with writing review (decide).

## 4b — Phrase spread — **COMPLETED** (2026-10-11)

Select several words in one paragraph and right-click: the same parting, with
phrase actions in the grid — Copy · Bold · Italic over Search · Count ·
Rephrase. Each panel action grows the opening like Define. Verified in the real
WKWebView by `scripts/native-macos-spread-smoke.js` with a phrase that wraps
across a line break (66/66 checks).

- [x] **COMPLETED** — A selection that wraps lines parts below its last line;
  every word of it stays put, marked as the target.
- [x] **COMPLETED** — Count: words (Intl.Segmenter), characters, characters
  without spaces, sentences, reading time at 238 wpm, then each distinct word
  of the phrase with how often it is used in the phrase and across the whole
  note. Local.
- [x] **COMPLETED** — Search: `notes search` across every note (open, closed,
  unsaved). One entry per note with its first matches, the phrase marked;
  choosing one opens the note with the match selected.
- [x] **COMPLETED** — Rephrase runs on the writer's AI command-line tool and
  subscription (AI settings: Claude Code, Codex, or OpenCode; no API keys, no
  local models) through the one-shot runner `src-tauri/src/commands/ai_cli.rs`:
  no tools, an empty folder, the passage on stdin, a JSON schema for three
  rephrasings. It climbs a ladder — Claude Haiku 5.5 → Sonnet 5.5 → Opus 5.5, or
  Codex low → medium → high effort — automatically when a reply is unusable,
  and on request ("Try Sonnet 5.5"). `selection rephrase` returns at once (the
  command queue never waits on a model) and `selection rephrase read` polls;
  choosing an option applies it with `selection replace` as one undoable edit.
  Each provider asks once per session before text leaves the Mac.
- [x] **COMPLETED** — Verified end to end in the native smoke test against
  Claude Haiku 5.5 on the writer's subscription: three rephrasings in ~3s,
  applied, and undone in one step. Codex (~12s) and OpenCode (~7s) were checked
  from the command line.
- [x] **COMPLETED** — Closing the opening cancels an in-flight rephrase and
  stops the CLI process.

## Fix — paragraphs that opened below themselves (2026-10-11)

Paragraphs with words Pretext can break inside — hyphens (`Saxe-Altenburg`),
em dashes (`women—misunderstandings`), brackets (`our[Pg`), or long words in a
narrow span beside the opening — gave Pretext one more word than the page, the
pairing failed, and the spread fell back to an opening below the paragraph. The
motion now moves Pretext's own break segments (`wordPieces`), pairs laid words
to pieces by offset, keeps side spans at least as wide as the widest piece, and
measures piece positions through the join so kerning (`-A`) is kept. On the
writer's own notes every one of 167 paragraph right-clicks now parts the text
(113 of 175 before). Fallbacks record why in the `[text-motion]` stats. The smoke
test adds a dashed paragraph: every line parts, 0px return drift, and a
glyph-by-glyph first frame within 1px (72/72 checks).

## 5 — Spelling & Grammar

- [ ] Use the Language Model only (decided 2026-10-11). Send the target word and
  its sentence through the one-shot CLI runner Rephrase uses (`ai_cli.rs`), and ask for structured
  output: whether it is misspelled, ranked suggestions, and grammar issues with
  ranges and short explanations. Validate the response; never apply model text
  unchecked.
- [ ] Before the first request, make clear which text is sent and to which
  provider (Claude Code, Codex, or OpenCode), reusing Rephrase's once-per-session
  consent. Show a clear state when no CLI is installed or signed in.
- [ ] Catalog commands `selection spelling` (read) and a revision-checked
  replacement (write), so the assistant sidebar can use them too.
- [ ] Spread view: the flagged word, suggestions as buttons, grammar
  explanation. Applying a suggestion replaces the range as one undoable edit and
  settles the corrected word into the line.
- [ ] WebKit's native red underlines stay as the passive indicator; the Spread
  view is the active check.

## 6 — Polish and reach

- [ ] Tune the motion: wave speed, overshoot, glyph scatter for Define. Add an
  intensity setting (off, calm, wild) under Appearances.
- [ ] Interplay with shader backgrounds, focus dimming, split view (two panes),
  and printing (the motion layer must never print).
- [ ] Long notes: only the viewport participates. Off-screen text never moves.
- [ ] Optional later: bring the Spread menu to the canvas plain-text editor.

## Decisions (2026-10-11)

1. **Define:** the target word's own letters fly apart and reassemble into the
   start of the definition. The rest streams in, and the surrounding prose parts
   wider. The writer's text is never scrambled.
2. **Spelling & Grammar source:** the Language Model only, through the writer's
   subscription CLI (Claude Code, Codex, or OpenCode). There is no native checker.
3. **Scope:** Markdown notes (ProseMirror) first; plain-text canvas files later.

## Open questions

1. **The existing selection toolbar** in the canvas editor. Should Spread
   eventually replace it everywhere?
