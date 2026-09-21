# Code Editor Roadmap

> Status: In Progress
> Last updated: 2026-04-29

This roadmap covers everything related to opening a file and coding in it — text editing, navigation, intelligence, visual features, and language support. The goal is a robust, professional editing experience where a developer can sit down, open any file, and start working without friction.

---

## Phase 1: Editing Fundamentals

The basics that every developer assumes will just work.

- [x] **Current line highlight** — renders currentLine palette color band on active cursor line
- [x] **Find and Replace UI** — FindReplace.tsx with replace-one, replace-all, and preview
- [x] **Regex support in Find/Replace** — toggle for regex mode in the search bar
- [x] **Case-sensitive / whole-word toggles** — standard find toolbar options
- [x] **Go to Line dialog** — Ctrl+G opens command palette with `:` prefix
- [x] **Right-click context menu** — extended with Go to Definition, Find References, Rename Symbol
- [x] **Indent guides** — vertical lines at each indent level with active guide highlighting
- [x] **Whitespace rendering toggle** — dots for spaces, arrows for tabs (toggle via command palette)
- [x] **Scroll past end** — last line can scroll to top of viewport
- [x] **Smooth scrolling** — ease-out animation on wheel scroll and cursor-follow navigation
- [x] **CRLF / LF detection** — detected on file open, displayed in status bar

---

## Phase 2: Navigation & Movement

Getting around the file quickly and confidently.

- [x] **Bracket matching highlight** — 1px stroke outline + subtle background fill on matching brackets
- [x] **Bracket jump keybinding** — Cmd+Shift+\ jumps between matching brackets
- [x] **File path breadcrumbs** — canvas-rendered file path breadcrumb strip above the editor
- [x] **Symbol breadcrumbs** — show enclosing symbol/function/class path alongside the file path
- [x] **Go to Symbol** — Cmd+Shift+O opens command palette with `@` prefix, uses lspDocumentSymbol
- [x] **Workspace symbol search** — Cmd+Shift+T opens `@@` workspace symbol search across active LSP servers
- [x] **Go to Type Definition** — Rust backend + frontend IPC + context menu integration
- [ ] **Peek Definition** — inline preview window instead of navigating away from current file
- [x] **Back/Forward navigation** — Ctrl+- / Ctrl+Shift+- with history stack, integrates with Go to Definition
- [ ] **Sticky scroll** — show enclosing scope headers (function/class) pinned at the top when scrolled deep into a block

---

## Phase 3: Editing Intelligence

Making the editor actively helpful while coding.

- [x] **Bracket pair colorization** — nested brackets colored with 6-color rotating palette
- [x] **Auto-indent on paste** — pasted multiline text reindented to match cursor context
- [x] **Emmet support** — expand abbreviations in HTML/CSS/JSX/TSX files via Tab key
- [x] **Snippet system expansion** — added snippets for JS/TS, Rust, Python, Go (fn, for, if, try, etc.)
- [x] **Snippet variables** — supports `$TM_FILENAME`, `$TM_SELECTED_TEXT`, `$CLIPBOARD`, `$CURRENT_YEAR`, `$UUID`, etc.
- [x] **Inline rename** — F2 opens inline text field at symbol location, Enter applies, Escape cancels
- [x] **Error peek / inline diagnostics** — Cmd+Shift+M toggles inline diagnostic detail below error line
- [ ] **Call hierarchy** — show callers/callees for a function (LSP `callHierarchy`)
- [ ] **Type hierarchy** — show supertypes/subtypes (LSP `typeHierarchy`)
- [x] **Autocomplete documentation preview** — doc panel rendered to the right of dropdown, word-wrapped, up to 12 lines
- [x] **Parameter hints improvement** — active parameter bolded in yellow in signature help tooltip
- [x] **Ghost text / inline suggestions** — streaming AI completions via Ollama (local) or Anthropic/OpenAI (cloud)

---

## Phase 4: Vim Mode Completion

Vim mode is functional but missing features that Vim users will reach for daily.

- [ ] **Text objects** — `iw`, `aw`, `ip`, `ap`, `i"`, `a"`, `i(`, `a(`, `it`, `at` etc. — this is the biggest gap for Vim users
- [ ] **Dot repeat (`.` command)** — recording infrastructure exists but replay doesn't work
- [ ] **Macro recording** — `q{register}` to record, `@{register}` to play back
- [ ] **Named registers** — `"a`, `"b`, etc. for multiple clipboard slots (currently only default register synced to system clipboard)
- [ ] **Marks** — `m{a-z}` to set, `'{a-z}` to jump (local marks)
- [ ] **`f`/`F`/`t`/`T` character search** — jump to next/previous occurrence of a character on the current line
- [ ] **`;` and `,` repeat** — repeat last `f`/`F`/`t`/`T` search forward/backward
- [ ] **`%` bracket jump** — jump to matching bracket (hook into existing `findMatchingBracket`)
- [ ] **`*` / `#` word search** — search forward/backward for word under cursor
- [ ] **Visual block mode** — Ctrl+V rectangular selection
- [ ] **`:s` substitute command** — find/replace from command mode
- [ ] **`:w`, `:q`, `:wq` commands** — save/quit from command mode

---

## Phase 5: Visual Polish

The details that make an editor feel professional.

- [x] **Minimap click-to-scroll** — click a position on the minimap to jump there
- [ ] **Minimap hover preview** — show a zoomed tooltip of the hovered region
- [x] **Fold all / Unfold all** — commands to collapse/expand every foldable region at once
- [ ] **Fold level controls** — fold to level 1, 2, 3, etc.
- [ ] **Cursor blink** — configurable cursor blink (currently always solid)
- [ ] **Cursor style options** — block, beam, underline (currently always block)
- [ ] **Smooth cursor animation** — cursor glides to new position instead of jumping
- [x] **Selection highlight occurrences** — selecting a word highlights all other occurrences in viewport
- [ ] **Color decorators** — inline color swatches for hex/rgb values in CSS/HTML
- [ ] **Matched bracket scope highlight** — subtle background between matching brackets

---

## Phase 6: Language & File Support

Expanding what the editor can handle.

- [x] **Language-specific snippets** — curated snippets exist for JS/TS, Rust, Python, Go, and HTML boilerplate
- [ ] **File encoding detection** — detect non-UTF-8 files (Latin-1, Shift-JIS, etc.), show encoding in status bar, allow re-open with different encoding
- [ ] **Large file optimizations** — Rust-backed large-file buffer exists; still needs true virtual editor integration and graceful feature disabling
- [x] **Image file preview** — open PNG/JPG/SVG and other common image formats in a zoomable canvas viewer
- [x] **Markdown preview** — Blog Mode renders markdown preview for markdown files
- [x] **Side-by-side Markdown preview** — Blog Mode now keeps source and rendered markdown visible in a split view
- [x] **JSON formatting** — auto-format/pretty-print JSON files from the command palette and format-on-save path
- [x] **Diff viewer** — side-by-side git diff view exists in the Git UI
- [ ] **General diff editor** — compare arbitrary file versions outside the Git panel

---

## Phase 7: Keybinding & Configuration

Letting users make the editor theirs.

- [x] **Keybinding customization** — user-configurable hotkeys in Settings, persisted through `AppSettings.keybindings`
- [x] **Keybinding conflict detection** — warn when two commands share the same shortcut
- [x] **Keybinding cheat sheet** — Cmd+K Cmd+S shows a read-only Keyboard Shortcuts tab
- [x] **Editor settings granularity** — per-language overrides for tab size, indentation, word wrap, format on save, auto-save, and auto-save delay
- [x] **Format on save** — auto-run LSP document formatting before saving when enabled
- [x] **Auto-save** — configurable auto-save with global and per-language delay options
- [x] **Font family selection** — Settings can choose the editor/terminal monospace font stack
- [x] **Theme-aware token colors** — Settings can override syntax token colors on top of generated/imported palettes
