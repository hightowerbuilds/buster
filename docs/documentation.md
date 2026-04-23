# Buster IDE Documentation

Complete reference documentation for Buster, a canvas-rendered IDE built with Tauri v2, Rust, and SolidJS.

---

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [Editor](#editor)
  - [Text Buffer](#text-buffer)
  - [Canvas Rendering](#canvas-rendering)
  - [Syntax Highlighting](#syntax-highlighting)
  - [Code Folding](#code-folding)
  - [Find and Replace](#find-and-replace)
  - [Multi-Cursor Editing](#multi-cursor-editing)
  - [Word Wrap](#word-wrap)
  - [Virtual Scrolling](#virtual-scrolling)
  - [Large File Support](#large-file-support)
  - [Markdown Preview](#markdown-preview)
  - [Image Viewer](#image-viewer)
  - [Vim Mode](#vim-mode)
  - [Undo and Redo](#undo-and-redo)
  - [Editor Accessibility](#editor-accessibility)
- [Language Server Protocol](#language-server-protocol)
  - [Supported Languages](#supported-languages)
  - [Autocomplete](#autocomplete)
  - [Hover Documentation](#hover-documentation)
  - [Signature Help](#signature-help)
  - [Code Actions](#code-actions)
  - [Inlay Hints](#inlay-hints)
  - [Go to Definition](#go-to-definition)
  - [Find References](#find-references)
  - [Rename Symbol](#rename-symbol)
  - [Document Symbols](#document-symbols)
  - [Diagnostics](#diagnostics)
  - [LSP Crash Recovery](#lsp-crash-recovery)
- [Terminal](#terminal)
  - [Terminal Emulation](#terminal-emulation)
  - [Color Support](#color-support)
  - [Sixel Images](#sixel-images)
  - [Mouse Reporting](#mouse-reporting)
  - [Scrollback History](#scrollback-history)
  - [Terminal Themes](#terminal-themes)
  - [CJK Support](#cjk-support)
- [Git Integration](#git-integration)
  - [Status and Staging](#status-and-staging)
  - [Committing](#committing)
  - [Push Pull and Fetch](#push-pull-and-fetch)
  - [Branches](#branches)
  - [Stash](#stash)
  - [Remotes](#remotes)
  - [Diff and Blame](#diff-and-blame)
  - [Commit Graph](#commit-graph)
  - [Conflict Resolution](#conflict-resolution)
- [File Explorer](#file-explorer)
  - [Directory Tree](#directory-tree)
  - [Gitignore Support](#gitignore-support)
  - [File Operations](#file-operations)
  - [Drag and Drop](#drag-and-drop)
- [Command Palette](#command-palette)
  - [Quick Open](#quick-open)
  - [Command Search](#command-search)
  - [Go to Line](#go-to-line)
  - [Symbol Search](#symbol-search)
  - [Content Search](#content-search)
- [Layouts](#layouts)
  - [Layout Modes](#layout-modes)
  - [Panel Resizing](#panel-resizing)
  - [Panel Types](#panel-types)
  - [Tab Management](#tab-management)
- [Debugger](#debugger)
  - [Breakpoints](#breakpoints)
  - [Debug Controls](#debug-controls)
  - [Stack Frames](#stack-frames)
  - [Variables](#variables)
  - [Debug Adapter Protocol](#debug-adapter-protocol)
- [Extensions](#extensions)
  - [Extension System Overview](#extension-system-overview)
  - [Extension Manifest](#extension-manifest)
  - [Capabilities](#capabilities)
  - [WASM Runtime](#wasm-runtime)
  - [Host Functions](#host-functions)
  - [Surface Rendering](#surface-rendering)
  - [Gateway Connections](#gateway-connections)
  - [Browser Control](#browser-control)
  - [Building an Extension](#building-an-extension)
  - [Extension Security](#extension-security)
- [Settings](#settings)
  - [Visual Settings](#visual-settings)
  - [Editor Settings](#editor-settings)
  - [Theme System](#theme-system)
  - [Canvas Effects](#canvas-effects)
  - [Blog Themes](#blog-themes)
- [Session Management](#session-management)
  - [Auto-Save](#auto-save)
  - [Hot Exit](#hot-exit)
  - [Crash Recovery](#crash-recovery)
  - [Backup Buffers](#backup-buffers)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Architecture](#architecture)
  - [Frontend Architecture](#frontend-architecture)
  - [Backend Architecture](#backend-architecture)
  - [IPC Communication](#ipc-communication)
  - [Event System](#event-system)
  - [State Management](#state-management)
  - [Internal Crates](#internal-crates)
- [Security](#security)
  - [Workspace Isolation](#workspace-isolation)
  - [WASM Sandbox](#wasm-sandbox)
  - [Shell Command Safety](#shell-command-safety)
  - [Secure Storage](#secure-storage)
- [Build and Development](#build-and-development)
  - [Prerequisites](#prerequisites)
  - [Development Mode](#development-mode)
  - [Production Build](#production-build)
  - [Running Tests](#running-tests)
  - [CI/CD Pipeline](#cicd-pipeline)
- [Platform Support](#platform-support)
- [Accessibility](#accessibility)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Buster is a canvas-rendered IDE where every character on screen — code, terminal output, UI chrome — is drawn on an HTML Canvas. The editor uses a TypeScript `string[]` buffer backed by SolidJS signals, Tree-sitter for syntax highlighting, and Pretext for text measurement. The terminal runs a real PTY through a VT100 parser in Rust and renders the cell grid on canvas.

The application is built on Tauri v2 with a Rust backend and a SolidJS frontend. It installs at 43 MB, compared to 350 MB for VS Code or 2.5 GB for WebStorm.

### Core Loop

```
open project -> navigate fast -> edit fast -> run in terminal -> inspect git
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 |
| Backend | Rust |
| Frontend framework | SolidJS |
| Rendering | Canvas 2D + WebGL2 |
| Text buffer | TypeScript string[] (SolidJS signals) |
| Syntax highlighting | Tree-sitter (native Rust) |
| Text measurement | Pretext (@chenglou/pretext) |
| Terminal parsing | vt100 crate |
| Terminal PTY | portable-pty |
| Extension runtime | wasmtime (WASM sandbox) |
| Async runtime | Tokio |
| UI font | Courier New |
| Editor font | JetBrains Mono |
| Theme | Catppuccin Mocha (with custom hue rotation) |

---

## Installation

### Prerequisites

- [Rust](https://rustup.rs/) (1.70+)
- [Bun](https://bun.sh/) (1.0+)
- On macOS: Xcode Command Line Tools (`xcode-select --install`)
- On Linux: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev`
- On Windows: Visual Studio Build Tools with C++ workload

### Build from Source

```bash
git clone https://github.com/hightowerbuilds/buster.git
cd buster
bun install
bun run tauri build
```

The built app will be at:

- macOS: `src-tauri/target/release/bundle/macos/Buster.app`
- macOS DMG: `src-tauri/target/release/bundle/dmg/Buster_0.1.0_x64.dmg`
- Windows: `src-tauri/target/release/bundle/nsis/`
- Linux: `src-tauri/target/release/bundle/appimage/` or `src-tauri/target/release/bundle/deb/`

### Development

```bash
bun run tauri dev
```

This starts the app with hot-reload for the frontend. Rust changes trigger an automatic rebuild.

---

## Getting Started

Open Buster. The welcome screen shows an ASCII particle animation and a list of recently opened folders. You can:

1. Click a recent folder to reopen it
2. Use **Cmd+O** (macOS) or **Ctrl+O** (Windows/Linux) to open a folder
3. Open the command palette with **Cmd+Shift+P** and run "Start Guided Tour" for an interactive walkthrough

The guided tour teaches every feature through animated ASCII text slides. Navigate with arrow keys, exit with Escape.

---

## Editor

### Text Buffer

The editor's text buffer is a TypeScript `string[]` — an array where each element is one line of text. The buffer is backed by SolidJS fine-grained reactive signals. When a line changes, only that line's signal fires, and only the canvas region for that line redraws.

Edits happen entirely in the frontend process. There is no IPC per keystroke. The backend is only involved for file I/O (save/load), syntax tree updates, and LSP operations, all of which run asynchronously without blocking the edit.

The buffer supports:

- Insert, delete, backspace at cursor position
- Multi-line selection and replacement
- Cut, copy, paste via system clipboard
- Tab insertion and removal (configurable tab size)
- Auto-indent on new lines
- Bracket matching

### Canvas Rendering

Every character in the editor is drawn on an HTML Canvas element. The rendering pipeline:

1. **Compute visible lines.** Based on scroll position and viewport height, determine which lines to render.
2. **Compute display rows.** With word wrap enabled, a single buffer line may span multiple display rows. Display rows are memoized and only recomputed when the buffer, viewport width, or wrap settings change.
3. **Draw gutter.** Line numbers, fold indicators, breakpoint dots, and diff markers.
4. **Draw text.** Each line is split into syntax-highlighted spans. Each span is drawn with the appropriate color from the theme palette.
5. **Draw overlays.** Cursor, selection highlight, search match highlights, diagnostic underlines, current line highlight, inlay hints, ghost text.
6. **Draw chrome.** Scrollbar, minimap (optional).

The renderer uses Canvas 2D by default. When WebGL2 is available, text rendering switches to a GPU-accelerated glyph atlas with instanced rendering. All glyphs are rasterized once into a texture atlas, then drawn as instanced quads in a single draw call per frame. This handles large files and high-DPI displays efficiently.

Rendering is on-demand. There is no `requestAnimationFrame` loop. The canvas repaints only when a signal changes (keystroke, scroll, resize, cursor blink timer).

### Syntax Highlighting

Syntax highlighting uses Tree-sitter, an incremental parsing library that maintains a persistent abstract syntax tree per open file. When you edit text, Tree-sitter reparses only the affected subtree, not the entire file.

The highlighting pipeline:

1. Frontend opens a file and sends `syntax_open(path, language, content)` to the Rust backend.
2. Tree-sitter creates a persistent `DocumentTree` for the file.
3. On each edit, the frontend sends an `EditDelta` via `syntax_edit()`. Tree-sitter applies the delta incrementally.
4. When the viewport changes, the frontend requests `highlight_code(path, start_line, end_line)`. The backend returns per-line highlight spans: `{line, start_col, end_col, kind}`.
5. The frontend maps each `kind` to a color from the theme palette and draws the span.

Supported languages (100+): Rust, TypeScript, TSX, JavaScript, JSX, Python, Go, C, C++, Bash, YAML, TOML, Ruby, Java, Lua, Regex, XML, PHP, CSS, SCSS, HTML, and more through Tree-sitter grammars.

If a file's language grammar is not available, the editor falls back to plain text rendering.

### Code Folding

Code folding collapses regions of code based on Tree-sitter's syntax tree. Foldable regions include function bodies, class bodies, block statements, objects, arrays, and other nested structures.

Fold indicators appear in the gutter as disclosure triangles. Click to toggle. Folded regions show a placeholder indicator on the folded line.

Keyboard shortcuts:

- **Cmd+Shift+[** — Fold at cursor
- **Cmd+Shift+]** — Unfold at cursor

### Find and Replace

**Cmd+F** opens the find/replace panel at the top of the editor.

Features:

- **Literal search:** Type text to find exact matches
- **Regex search:** Toggle the regex button to use regular expressions
- **Case sensitivity:** Toggle case-sensitive matching
- **Match counter:** Shows "N of M" matches with the current match highlighted
- **Navigation:** Enter or arrow buttons to jump to next/previous match (Cmd+G / Cmd+Shift+G)
- **Replace:** Enter replacement text. Supports capture groups ($1, $2) in regex mode.
- **Replace current:** Replace the currently highlighted match
- **Replace all:** Replace all matches in a single undo operation
- **Regex validation:** Invalid regex patterns show an error message

Search matches are highlighted throughout the document with a distinct search highlight color. The current match uses a different, brighter highlight.

Press **Escape** to dismiss the find/replace panel.

### Multi-Cursor Editing

Hold **Alt** (or **Option** on macOS) and click to place additional cursors. Each cursor operates independently — typing, deleting, and selecting affect all cursors simultaneously.

### Word Wrap

Toggle word wrap in Settings or via the command palette. When enabled, lines longer than the viewport width wrap to the next display row. The gutter shows the original line number only on the first display row of each buffer line.

Word wrap is calculated using display-width-aware measurement that handles CJK double-width characters correctly.

### Virtual Scrolling

The editor renders only the lines visible in the viewport. For a file with 100,000 lines, only the 40-60 visible lines are drawn on each frame. Scrolling triggers a repaint with the new visible range.

This makes opening and navigating large files instant regardless of file size.

### Large File Support

Files larger than 1 MB are handled by the `FileBufferManager` in the Rust backend. Instead of loading the entire file into frontend memory, the backend memory-maps the file and computes line offsets. The frontend requests line ranges on demand via `large_file_read_lines(start, count)`.

Features:

- **O(1) line lookup** via precomputed byte offsets
- **Staleness detection** — file modification time and size are checked on each access
- **Auto-remap** — if the file changes on disk, the memory map is refreshed
- **CRLF support** — carriage returns are stripped transparently
- Files up to 50 MB+ are supported

### Markdown Preview

Markdown files (`.md`) can be viewed in a formatted preview mode. The preview renders headings, lists, code blocks (with syntax highlighting), links, emphasis, tables, and other standard Markdown elements.

Toggle between edit and preview mode via the command palette.

### Image Viewer

Opening an image file (PNG, JPG, GIF, WebP, BMP, ICO, SVG, AVIF, TIFF) displays it in a canvas-based viewer with:

- **Zoom** — Ctrl+scroll wheel to zoom in/out
- **Fit to container** — button to reset zoom
- **Pan** — click and drag to move the image
- **Transparency** — checkerboard background for transparent images
- **Info** — image dimensions and file size displayed

### Vim Mode

Full Vim keybinding support with four modes:

- **Normal mode** — navigation and command entry
- **Insert mode** — text insertion
- **Visual mode** — selection
- **Command-line mode** — ex commands

The Vim keymap is authored in Lua, compiled to JSON, and loaded into the frontend at startup. All key processing happens in the frontend with zero IPC per keystroke.

Supported operations include motions (h, j, k, l, w, b, e, 0, $, gg, G), operators (d, c, y, p), visual selection (v, V), undo/redo (u, Ctrl+R), search (/, ?, n, N), and ex commands (:w, :q, :wq, :s/find/replace/).

### Undo and Redo

Undo/redo uses time-based grouping. Rapid consecutive edits (within a short time window) are grouped into a single undo step. This means pressing Cmd+Z undoes a logical "action" rather than each individual character.

- **Cmd+Z** — Undo
- **Cmd+Shift+Z** — Redo

Multi-line operations (replace all, paste, block indent) are wrapped in a single undo group.

### Editor Accessibility

The editor includes an accessibility bridge that maintains a hidden `<textarea>` synchronized with the visible content. This provides:

- Screen reader support for the current line and cursor position
- ARIA live regions for status changes
- Keyboard-only navigation for all editor features
- Announcements for mode changes (Vim normal/insert/visual)

---

## Language Server Protocol

### Supported Languages

| File Extension | Language Server | Language ID |
|---------------|----------------|-------------|
| .rs | rust-analyzer | rust |
| .ts, .tsx | typescript-language-server | typescript, typescriptreact |
| .js, .jsx | typescript-language-server | javascript, javascriptreact |
| .py | pyright-langserver | python |
| .go | gopls | go |
| .c, .cpp | clangd | c, cpp |
| .java | jdtls | java |
| .rb | solargraph | ruby |
| .php | intelephense | php |
| .lua | lua-language-server | lua |
| .sh, .bash | bash-language-server | shellscript |
| .yaml, .yml | yaml-language-server | yaml |
| .toml | taplo | toml |
| .css, .scss | vscode-css-language-server | css, scss |
| .html | vscode-html-language-server | html |

Language servers must be installed separately on your system. Buster discovers them via PATH.

### Autocomplete

As you type, the LSP provides completion suggestions. A dropdown appears near the cursor with matching items. Items are sorted by relevance and show icons for their kind (function, variable, class, keyword, etc.).

- **Tab** or **Enter** — accept the selected completion
- **Escape** — dismiss the dropdown
- **Arrow keys** — navigate items
- Continue typing to filter the list

Ghost text completions show a dimmed preview of the most likely completion inline with your cursor.

### Hover Documentation

Hover over a symbol to see its type information and documentation. The hover popup appears after a short delay and shows:

- Type signature
- Documentation comments
- Source location

### Signature Help

When typing a function call, signature help shows the function's parameter list in a popup above the cursor. The current parameter is highlighted. The popup updates as you type each argument.

Triggered automatically when you type `(` after a function name, or manually via the command palette.

### Code Actions

When the LSP offers quick fixes or refactoring suggestions, a lightbulb icon appears in the gutter. Click the lightbulb or use the keyboard shortcut to see available actions:

- Quick fixes for diagnostics
- Refactoring options
- Import suggestions

### Inlay Hints

Inlay hints show type annotations and parameter names inline in the code, rendered in a dimmer color. These are provided by the language server and appear automatically for:

- Variable type annotations (in languages with type inference)
- Parameter names at call sites
- Return type annotations

### Go to Definition

**Cmd+Click** or **F12** on a symbol jumps to its definition. If the definition is in another file, that file opens in a new tab.

### Find References

Find all references to a symbol across the workspace. Results appear in the search results panel, grouped by file with line context.

### Rename Symbol

Position the cursor on a symbol and trigger rename via the command palette or **F2**. Enter the new name. The LSP computes all locations across the workspace and applies the rename atomically.

### Document Symbols

**Cmd+Shift+O** opens the symbol search. Shows all symbols in the current file (functions, classes, variables, types) with their kind. Select a symbol to jump to its location.

### Diagnostics

LSP diagnostics (errors, warnings, info, hints) appear as:

- **Squiggly underlines** in the editor, color-coded by severity (red for errors, yellow for warnings, blue for info)
- **Gutter markers** showing the diagnostic count per line
- **Status bar** showing total error and warning counts
- **Problems panel** listing all diagnostics grouped by file, sorted by severity

Navigate between diagnostics:

- **F8** — Jump to next diagnostic
- **Shift+F8** — Jump to previous diagnostic

### LSP Crash Recovery

If a language server crashes, Buster automatically restarts it with exponential backoff (up to 3 retries). After restart, all open documents are re-synchronized with `didOpen`. The crash count resets after a successful 60-second run.

The LSP status is shown in the status bar. Click it to see the state of all running servers.

---

## Terminal

### Terminal Emulation

Buster includes a full terminal emulator rendered on canvas. The backend spawns a real pseudo-terminal (PTY) via the `portable-pty` crate. Terminal state is parsed by the `vt100` crate in Rust, which handles all ANSI/VT100 escape sequences.

The terminal supports:

- Full interactive programs (NeoVim, tmux, htop, less, man)
- Shell sessions (bash, zsh, fish, PowerShell)
- Alternate screen mode (used by full-screen terminal applications)
- Window title setting via OSC 2 escape sequences
- Bell (visual flash on BEL character)
- Bracketed paste mode

Each terminal opens as a tab alongside your files. Open a new terminal with **Cmd+T**.

### Color Support

The terminal supports:

- **16 standard ANSI colors** — mapped to the current theme palette
- **256-color mode** — extended palette with RGB approximation
- **True color (24-bit)** — full RGB colors via `\e[38;2;R;G;Bm` sequences
- **Bold, italic, underline, strikethrough, inverse, faint** text attributes

Terminal colors follow the app theme. When you switch themes, terminal colors update immediately.

### Sixel Images

The terminal supports the Sixel image protocol. Programs that output sixel data (such as `img2sixel`, `chafa`, or `viu`) render images directly in the terminal grid. Images are decoded in Rust and drawn as bitmaps on the canvas.

### Mouse Reporting

The terminal forwards mouse events to the running program when mouse reporting mode is enabled. This allows:

- Click-to-position in NeoVim and other editors
- Mouse selection in tmux
- Scroll wheel in less, man, and other pagers
- Mouse-driven TUI applications

### Scrollback History

The terminal maintains a scrollback buffer of 10,000 lines. Scroll up with the mouse wheel or trackpad to view history. The scrollbar appears on the right edge for navigation.

Search the scrollback buffer to find previous output.

### Terminal Themes

Terminal colors are derived from the app's theme palette. The 16 standard ANSI colors (black, red, green, yellow, blue, magenta, cyan, white, and their bright variants) are mapped to theme-appropriate values. Background and foreground colors match the editor.

When you change the app theme, terminal colors update in real time.

### CJK Support

The terminal correctly handles CJK (Chinese, Japanese, Korean) double-width characters. Each wide character occupies two cell columns. Cursor positioning, selection, and text wrapping account for character display width.

---

## Git Integration

Buster includes 30+ built-in git commands accessible from the Git panel (**Cmd+Shift+G**) and the command palette. No terminal required.

### Status and Staging

The Git panel shows three sections:

- **Staged changes** — files added to the index
- **Unstaged changes** — modified tracked files not yet staged
- **Untracked files** — new files not tracked by git

Each file shows its status with a color-coded indicator:

| Status | Color | Meaning |
|--------|-------|---------|
| M | Peach | Modified |
| A | Green | Added |
| D | Red | Deleted |
| R | Blue | Renamed |
| ?? | Gray | Untracked |

Click a file to stage or unstage it. Click the file name to open a diff view.

### Committing

Type your commit message in the text area at the top of the Git panel. Press **Cmd+Enter** or click the commit button to commit staged changes.

Options:

- **Amend** — modify the most recent commit with the current staged changes and a new (or unchanged) message
- **Sign** — GPG-sign the commit

### Push Pull and Fetch

- **Push** — push the current branch to its upstream remote. Supports force-with-lease.
- **Pull** — pull changes from the upstream remote. Supports rebase mode.
- **Fetch** — fetch updates from remotes. Supports prune (remove deleted remote branches).

The status bar shows the ahead/behind count relative to the upstream branch.

### Branches

The branch picker (click the branch name in the status bar) shows all local and remote branches. Features:

- **Switch** — click a branch to check out
- **Create** — create a new branch from the current HEAD
- **Delete** — delete a branch (with force option for unmerged branches)

### Stash

- **Stash save** — save current changes with an optional message. Option to include untracked files.
- **Stash pop** — apply the most recent stash and remove it
- **Stash list** — view all stash entries
- **Stash drop** — delete a specific stash entry

### Remotes

- **List** — view all configured remotes with their URLs
- **Add** — add a new remote by name and URL
- **Remove** — delete a remote
- **Rename** — change a remote's name
- **Set URL** — update a remote's URL

### Diff and Blame

**Diff view** shows changes between the working tree and HEAD in two modes:

- **Unified** — single column with added lines (green) and removed lines (red) interleaved
- **Split** — side-by-side view with old content on the left and new content on the right

Both modes show line numbers and syntax highlighting.

**Blame overlay** shows the commit author and message for each line in the editor. Toggle via the command palette.

**Diff gutter** indicators appear in the editor's left gutter:

- Green bar — added line
- Blue bar — modified line
- Red triangle — deleted line(s)

### Commit Graph

A canvas-rendered commit graph shows the branch history with colored lanes. Each commit displays:

- Abbreviated hash
- Author name
- Commit message (first line)
- Branch and tag refs

Lanes are color-coded to distinguish branches. Merge commits show lane connections.

### Conflict Resolution

When a merge or rebase produces conflicts, the conflict resolver UI shows each conflict block with:

- **Ours** — the current branch's version
- **Theirs** — the incoming branch's version
- **Both** — accept both versions concatenated

Select a resolution for each conflict and apply. The resolved file is staged automatically.

Conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) are parsed and displayed visually rather than as raw text.

---

## File Explorer

### Directory Tree

The sidebar (**Cmd+B** to toggle) shows a file explorer with a lazy-loading directory tree. Directories load their children only when expanded, keeping the initial load fast regardless of project size.

The tree displays:

- File and folder names
- Folder expand/collapse indicators
- File type indicators

Long file names are truncated as "start...end" to fit the sidebar width. The sidebar is resizable by dragging its right edge (140px minimum, 600px maximum).

### Gitignore Support

The file explorer respects `.gitignore` files. Ignored files and directories are hidden from the tree. The `ignore` crate walks up the directory tree to find all applicable `.gitignore` files.

### File Operations

Right-click a file or folder in the explorer for a context menu with:

- **New File** — create a file in the selected directory
- **New Folder** — create a subdirectory
- **Rename** — inline rename with text input
- **Delete** — delete with confirmation dialog
- **Copy Path** — copy the absolute path to clipboard
- **Reveal in Finder** (macOS) / **Reveal in Explorer** (Windows) — open in system file manager

### Drag and Drop

Drag files and folders within the explorer to move them between directories.

---

## Command Palette

The command palette is the central navigation and command interface. Open it with **Cmd+P** (Quick Open) or **Cmd+Shift+P** (Command Search).

### Quick Open

**Cmd+P** opens fuzzy file search. Type part of a file name to filter. Results are scored by match quality and show the file path. The search respects `.gitignore` — ignored files are excluded.

Recent files appear at the top of the list before you start typing.

Press **Enter** to open the selected file. Press **Escape** to dismiss.

### Command Search

Prefix your query with `>` (or use **Cmd+Shift+P** which pre-fills the prefix) to search IDE commands. 80+ commands are registered from the command registry, including:

- File operations (Save, Save As, Close, Open Folder)
- View operations (Toggle Sidebar, Toggle Minimap, Zoom In/Out)
- Editor operations (Format Document, Toggle Word Wrap, Toggle Vim Mode)
- Git operations (Commit, Push, Pull, Switch Branch)
- Terminal operations (New Terminal, Clear Terminal)
- Navigation (Go to Definition, Find References, Go to Symbol)
- Debug operations (Start Debugging, Toggle Breakpoint)

Each command shows its keyboard shortcut (if assigned). Commands from loaded extensions also appear.

### Go to Line

Prefix with `:` to jump to a specific line and column. Format: `:line` or `:line:col`.

Examples:
- `:42` — jump to line 42
- `:42:10` — jump to line 42, column 10

### Symbol Search

Prefix with `@` to search document symbols via LSP. Shows functions, classes, variables, and types in the current file. Select a symbol to jump to its location.

### Content Search

Prefix with `#` to search file contents across the workspace. Results appear in the search results panel, grouped by file with line context and match highlighting.

---

## Layouts

### Layout Modes

Buster supports 1 to 6 simultaneous panels. The dock bar at the bottom of the screen shows layout options:

| Mode | Panels | Description |
|------|--------|-------------|
| Tabs | 1 | Single panel, all files as tabs |
| Columns | 2 | Side-by-side vertical split |
| Grid | 4 | 2x2 grid |
| Trio | 3 | One large panel + two smaller panels |
| Quint | 5 | Five-panel arrangement |
| Rerack | 3 | Alternative three-panel layout |
| HQ | 6 | 3x2 grid |

Click a layout in the dock bar or use the command line switchboard (**Ctrl+`**) to switch.

### Panel Resizing

Panels are separated by draggable dividers. Click and drag a divider to resize adjacent panels. Each panel has a minimum size of 12% of the container.

The cursor changes to a resize indicator when hovering over a divider.

### Panel Types

In addition to file editors, panels can display:

| Panel | Description |
|-------|-------------|
| Terminal | PTY terminal emulator |
| Git | Status, staging, commit interface |
| Settings | IDE preferences and configuration |
| Extensions | Extension management |
| Debug | Debugger controls and variables |
| Problems | LSP diagnostics list |
| Search Results | Workspace search results |
| Console | Application log viewer |
| Browser | Embedded webview |
| Explorer | File tree (alternative to sidebar) |
| Manual | Generated keyboard shortcut reference |
| Blog | Markdown content editing mode |

Open these panels from the command palette or the command line switchboard.

### Tab Management

Tabs appear in the tab bar at the top of each panel group. Features:

- **Drag to reorder** — drag tabs to change their position
- **Close** — click the X button or middle-click a tab
- **Dirty indicator** — a bullet (.) appears before the name of unsaved files
- **Context menu** — right-click for close, rename, and other options
- **Tab switching** — Cmd+1 through Cmd+9 to jump to tabs by position
- **Navigate tabs** — Cmd+Shift+[ and Cmd+Shift+] to move between tabs
- **New terminal** — the + button at the right of the tab bar opens a new terminal

When you close tabs and the remaining count is less than the panel count, the layout automatically demotes to fit.

---

## Debugger

### Breakpoints

Click in the editor gutter to toggle a breakpoint on a line. Breakpoints appear as colored dots in the gutter.

**Conditional breakpoints** can be set with an expression that must evaluate to true for the debugger to pause. Set conditions via the context menu on a breakpoint.

Breakpoints persist across sessions.

### Debug Controls

When a debug session is active:

- **Continue** (F5) — resume execution until the next breakpoint
- **Step Over** (F10) — execute the current line and move to the next
- **Step Into** (F11) — step into a function call
- **Step Out** (Shift+F11) — step out of the current function
- **Pause** — interrupt execution
- **Stop** — terminate the debug session

### Stack Frames

When paused, the call stack panel shows all stack frames from the current execution point back to the entry point. Click a frame to navigate to its source location.

### Variables

The variables panel shows local and global variables for the current stack frame. Variables are displayed with their names, types, and values. Complex objects can be expanded to inspect their fields.

### Debug Adapter Protocol

Buster communicates with debuggers through the Debug Adapter Protocol (DAP). Any DAP-compatible debug adapter can be used. The adapter runs as a subprocess with JSON-RPC 2.0 communication over stdin/stdout.

Configure the adapter command and launch arguments in the debug panel settings.

---

## Extensions

### Extension System Overview

Buster extensions are WASM modules that run in a sandboxed Wasmtime runtime. Each extension declares its capabilities in a TOML manifest. The extension system enforces these declarations — an extension cannot access resources it hasn't declared.

Extensions are installed in `~/.buster/extensions/<id>/` and managed through the Extensions panel in the IDE.

### Extension Manifest

Every extension requires an `extension.toml` file:

```toml
[extension]
id = "my-extension"
name = "My Extension"
version = "0.1.0"
description = "What this extension does"
runtime = "bare"          # "bare" (default) or "wasi"

[capabilities]
workspace_read = true     # Read files in workspace
workspace_write = true    # Write files in workspace
commands = true           # Execute shell commands
notifications = true      # Show toast notifications
network = false           # Connect to external gateways
terminal = false          # Terminal access (reserved)

[[commands]]
id = "my-extension.do-thing"
label = "Do The Thing"

[[gateways]]
protocol = "websocket"    # or "http-sse"
url = "ws://localhost:8000/stream"
default = true
```

Commands declared in the manifest automatically register in the Command Palette when the extension loads.

### Capabilities

Extensions run in a WASM sandbox and can only do what their declared capabilities allow:

| Capability | What It Enables |
|-----------|----------------|
| `workspace_read` | Read files and list directories in the workspace |
| `workspace_write` | Create and modify files in the workspace |
| `commands` | Execute shell commands (validated against safety allowlist) |
| `notifications` | Show toast notifications to the user |
| `network` | Connect to external services via WebSocket or HTTP SSE |
| `terminal` | Access terminal system (reserved for future use) |
| `render_surface` | Render custom UI via display list commands |
| `browser_control` | Create and control embedded browser webviews |

If an extension calls a host function without the required capability, the call returns `-1` and does nothing. Capabilities are visible to the user in the Extensions panel.

### WASM Runtime

Extensions use one of two runtimes:

**Bare runtime** (default) — `#![no_std]` Rust compiled to `wasm32-unknown-unknown`. The extension exports `activate()`, `deactivate()`, `alloc()`, and method functions. The host writes JSON parameters to WASM memory and reads results from a return buffer.

**WASI runtime** — Full POSIX emulation via `wasmtime-wasi`. Entry point is `_start()`. Stdout is captured and returned as JSON. Useful for wrapping existing command-line tools.

Extensions have a 5-second execution timeout enforced by Wasmtime's epoch-based interruption.

### Host Functions

Functions provided by Buster to extensions:

**Always available:**

| Function | Description |
|----------|-------------|
| `log(level, ptr, len)` | Log a message (0=debug, 1=info, 2=warn, 3=error) |
| `set_return(ptr, len)` | Set return data for the current call |

**Requires `notifications`:**

| Function | Description |
|----------|-------------|
| `notify(title_ptr, title_len, msg_ptr, msg_len)` | Show a toast notification |

**Requires `workspace_read`:**

| Function | Returns | Description |
|----------|---------|-------------|
| `host_read_file(path_ptr, path_len)` | 0=ok, -1=denied | Read file contents into return buffer |
| `host_list_directory(path_ptr, path_len)` | 0=ok, -1=denied | List directory as JSON array in return buffer |

**Requires `workspace_write`:**

| Function | Returns | Description |
|----------|---------|-------------|
| `host_write_file(path_ptr, path_len, content_ptr, content_len)` | 0=ok, -1=denied | Write content to file |

**Requires `commands`:**

| Function | Returns | Description |
|----------|---------|-------------|
| `host_run_command(cmd_ptr, cmd_len)` | 0=ok, 1=fail, -1=blocked | Execute shell command, result as JSON in return buffer |

**Requires `render_surface`:**

| Function | Description |
|----------|-------------|
| `host_request_surface(width, height, label)` | Create a canvas surface, returns surface_id |
| `host_paint(surface_id, display_list_json)` | Render display list commands to surface |
| `host_release_surface(surface_id)` | Release the surface |
| `host_measure_text(text, font)` | Request text measurement (async, returns request_id) |

**Requires `browser_control`:**

| Function | Description |
|----------|-------------|
| `host_create_browser(url, x, y, width, height)` | Create an embedded webview |
| `host_navigate_browser(browser_id, url)` | Navigate webview to URL |

All file paths are canonicalized and validated against the workspace root. Paths outside the workspace are rejected.

### Surface Rendering

Extensions can create custom UI surfaces that appear as panels in the IDE. The surface system uses display list commands — the extension builds a list of draw operations (rectangles, text, lines, images) and sends them to the frontend for rendering on canvas.

Lifecycle:

1. Extension calls `host_request_surface(width, height, label)` to create a surface
2. Extension constructs a display list as JSON
3. Extension calls `host_paint(surface_id, display_list_json)` to render
4. Frontend receives the paint event and draws the commands on canvas
5. User interactions (click, key, resize) are forwarded back to the extension
6. Extension calls `host_release_surface(surface_id)` when done

Text measurement is asynchronous: the extension requests measurement, the frontend measures using the canvas context, and the result is delivered back through a channel.

### Gateway Connections

Extensions with the `network` capability can connect to external services:

**WebSocket** — bidirectional, full-duplex message streaming. Used for real-time agent communication.

**HTTP SSE** — server-sent events (receive-only stream) with HTTP POST for sending. Used for OpenAI-compatible streaming APIs.

Connect from the frontend:

```typescript
const connId = await connectGateway("my-extension", {
  protocol: "websocket",
  url: "ws://agent.local:8000/stream",
  auth_token: "bearer-token",
});

onGatewayEvent("my-extension", (event) => {
  // event.kind: "connected" | "text" | "tool_call" | "error" | "disconnected"
  // event.content: string
});

await sendToGateway(connId, JSON.stringify({ query: "hello" }));
await disconnectGateway(connId);
```

The gateway system normalizes events across transport protocols.

### Browser Control

Extensions can create native Tauri child webviews for rendering web content:

- Create webviews with position and size
- Navigate to URLs
- Show, hide, resize, and close webviews
- Browser data (cookies, cache) persists in `~/.buster/browser_data/`

On extension unload, all webviews created by that extension are automatically closed.

### Building an Extension

Quick start for building a WASM extension in Rust:

```bash
# 1. Create a Rust library project
cargo init --lib my-extension
cd my-extension

# 2. Configure Cargo.toml
# Set crate-type = ["cdylib"], use #![no_std]

# 3. Write your extension (see the extension developer guide)

# 4. Build for WASM
cargo build --target wasm32-unknown-unknown --release

# 5. Install
mkdir -p ~/.buster/extensions/my-extension
cp target/wasm32-unknown-unknown/release/my_extension.wasm \
   ~/.buster/extensions/my-extension/extension.wasm
cp extension.toml ~/.buster/extensions/my-extension/

# 6. Enable in Buster: Extensions panel > Enable
```

Tips:

- Use `opt-level = "s"`, `lto = true`, `strip = true` for small binaries
- `#![no_std]` with the `alloc` crate avoids pulling in the Rust standard library (~1 MB savings)
- Test locally before installing
- Check the Extensions panel to enable/disable without restarting

### Extension Security

- Extensions run in Wasmtime with epoch-based interruption (5-second timeout)
- All file paths are canonicalized and checked against the workspace root
- Shell commands pass through a safety allowlist (blocks `rm -rf`, `sudo`, credential access, etc.)
- No filesystem access outside the declared workspace
- Memory is freed when the WASM instance drops
- Each capability must be explicitly declared and is visible to the user

---

## Settings

### Visual Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Theme | Color theme for the entire IDE | Catppuccin Mocha |
| Theme Hue | Hue rotation for color customization (-1 = auto) | -1 |
| Theme Mode | Light or dark mode | Dark |
| Minimap | Toggle minimap visibility | Off |
| UI Zoom | Interface scaling (50-200%) | 100% |

### Editor Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Font Size | Editor and terminal font size (10-32px) | 14px |
| Tab Size | Spaces per tab (1-8) | 2 |
| Word Wrap | Enable line wrapping | Off |
| Line Numbers | Show gutter line numbers | On |
| Autocomplete | Enable LSP autocomplete | On |

### Theme System

Buster's theme engine generates a full IDE palette from a single seed hue using HSL color math. The palette includes:

- **Backgrounds** — editor, gutter, surface layers (surface0, surface1, surface2)
- **Text** — primary, dim, muted
- **Accents** — primary accent, secondary accent, cursor, cursor alt
- **UI chrome** — border, selection, search highlight, current line
- **Diagnostics** — error (red), warning (yellow), info (blue)
- **Syntax** — per-token-type colors for all Tree-sitter token kinds

The base theme is Catppuccin Mocha. Custom hue rotation shifts the entire palette while maintaining contrast ratios. Light mode inverts the luminance relationships.

VS Code themes can be imported and mapped to Buster's palette system.

### Canvas Effects

Buster supports visual effects that are only possible with canvas rendering:

| Effect | Description | Range |
|--------|-------------|-------|
| Cursor Glow | Soft bloom around the text cursor | 0-100 |
| Vignette | Darken the edges of the editor viewport | 0-100 |
| Film Grain | Subtle noise overlay on the editor surface | 0-100 |
| Background Glow | Colored glow emanating from accent elements | 0-100 |

These effects are GPU-composited and add zero overhead when set to 0.

### Blog Themes

Blog mode provides 12 visual themes designed for long-form content writing in Markdown:

Themes transform the editor's visual presentation (fonts, spacing, colors, backgrounds) while keeping the same underlying engine. Select a blog theme from Settings when working in Markdown files.

---

## Session Management

### Auto-Save

Buster auto-saves the session state every 30 seconds to `~/.buster/sessions/session.json`. The saved state includes:

- Workspace root path
- All open tabs (file paths, tab types, cursor positions, scroll positions)
- Active tab ID
- Layout mode
- Sidebar visibility and width
- Dirty file indicators

### Hot Exit

When you close Buster, the session persists automatically. On next launch, the session is restored:

- Workspace reopens
- All tabs reopen in their previous positions
- Cursor positions and scroll offsets are restored
- Dirty (unsaved) files are recovered from backup buffers

### Crash Recovery

On startup, Buster checks for a `.running` flag file. If it exists, the previous session did not shut down cleanly (crash or force-quit). Buster proceeds with session restoration and recovers unsaved content from backup buffers.

The running flag is created on startup and deleted on clean shutdown.

### Backup Buffers

Dirty files (files with unsaved changes) are backed up separately to `~/.buster/sessions/backups/`. Each backup is identified by a hash of the file path. Backups are:

- Created during auto-save for any dirty file
- Restored on crash recovery
- Deleted after the file is saved or the tab is closed

---

## Keyboard Shortcuts

### Global

| Shortcut | Action |
|----------|--------|
| Cmd+O | Open folder |
| Cmd+S | Save file |
| Cmd+W | Close tab |
| Cmd+P | Quick Open (fuzzy file search) |
| Cmd+Shift+P | Show all commands |
| Cmd+, | Settings |
| Cmd+B | Toggle sidebar |
| Escape | Close overlays |

### Editor

| Shortcut | Action |
|----------|--------|
| Cmd+Z | Undo |
| Cmd+Shift+Z | Redo |
| Cmd+F | Find / Replace |
| Cmd+G | Find next match |
| Cmd+Shift+G | Find previous match |
| Cmd+D | Select next occurrence |
| Cmd+Shift+[ | Fold region |
| Cmd+Shift+] | Unfold region |
| Cmd+/ | Toggle line comment |
| Tab | Indent |
| Shift+Tab | Outdent |

### Navigation

| Shortcut | Action |
|----------|--------|
| Ctrl+G | Go to line |
| Cmd+Shift+O | Go to symbol |
| F12 | Go to definition |
| F8 | Next diagnostic |
| Shift+F8 | Previous diagnostic |
| F6 | Cycle focus forward (sidebar, editor, dock) |
| Shift+F6 | Cycle focus backward |

### Tabs

| Shortcut | Action |
|----------|--------|
| Cmd+1 through Cmd+9 | Switch to tab 1-9 |
| Cmd+Shift+] | Next tab |
| Cmd+Shift+[ | Previous tab |

### Terminal

| Shortcut | Action |
|----------|--------|
| Cmd+T | New terminal |

### Git

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+G | Git panel |

### Other

| Shortcut | Action |
|----------|--------|
| Ctrl+` | Command line switchboard |
| Cmd+= | Zoom in |
| Cmd+- | Zoom out |
| Cmd+0 | Reset zoom |

---

## Architecture

### Frontend Architecture

```
src/
  editor/                # Canvas-rendered code editor
    CanvasEditor.tsx      # Editor component
    engine.ts             # Text buffer, cursor, selection, undo/redo
    canvas-renderer.ts    # Canvas 2D rendering pipeline
    webgl-text.ts         # WebGL2 GPU text rendering
    vim-mode.ts           # Vim keybindings
    ts-highlighter.ts     # Tree-sitter highlight bridge
    text-measure.ts       # Pretext wrapper + CJK width
    editor-autocomplete.ts    # LSP completions
    editor-hover.ts           # LSP hover tooltips
    editor-signature.ts       # LSP signature help
    editor-code-actions.ts    # LSP code actions
    editor-inlay-hints.ts     # LSP inlay hints
    editor-ghost-text.ts      # AI ghost text
    editor-a11y.tsx           # Accessibility bridge

  ui/                    # UI components
    canvas-chrome.tsx         # Base component for canvas UI elements
    CanvasTabBar.tsx          # Tab bar with drag reorder
    CanvasDockBar.tsx         # Layout picker + git button
    CanvasStatusBar.tsx       # Mode, branch, diagnostics, cursor
    CanvasSidebarHeader.tsx   # Workspace name + file actions
    CanvasTerminal.tsx        # Terminal emulator
    PanelLayout.tsx           # Resizable panel grid (1-6 panels)
    Sidebar.tsx               # File explorer tree
    CommandPalette.tsx        # Fuzzy command/file search
    FindReplace.tsx           # Regex find/replace
    GitPanel.tsx              # Git status + staging
    GitGraph.tsx              # Commit graph visualization
    DiffView.tsx              # Unified/split diff
    BranchPicker.tsx          # Branch switcher
    ConflictResolver.tsx      # Merge conflict UI
    DebugPanel.tsx            # Debugger breakpoints + variables
    ExtensionsPage.tsx        # Extension manager
    ConsolePanel.tsx          # Log viewer
    SearchResultsPanel.tsx    # File search results
    SettingsPanel.tsx         # IDE preferences
    ImageViewer.tsx           # Image viewer
    WelcomeCanvas.tsx         # Onboarding animation
    TourCanvas.tsx            # Guided tour
    ContextMenu.tsx           # Right-click menus
    CanvasToasts.tsx          # Toast notifications

  lib/                   # State, IPC, utilities
    BusterProvider.tsx        # State provider (SolidJS context)
    buster-context.ts         # Context hook + type interfaces
    buster-actions.ts         # Action functions (file, tab, workspace, dialog, settings)
    store-types.ts            # Central store type definition
    tab-types.ts              # Tab union types
    ipc.ts                    # Tauri invoke wrappers (100+ commands)
    app-commands.ts           # 80+ registered commands + hotkeys
    panel-definitions.tsx     # 12 panel type registrations
    panel-registry.ts         # Panel type lookup
    panel-count.ts            # Layout mode parsing
    theme.ts                  # Palette generator (HSL math)
    session.ts                # Session persistence API
    file-watcher.ts           # External file change listener
    focus-service.ts          # Focus management
    clipboard.ts              # Copy/paste bridge
    extension-host.ts         # Extension discovery/loading
    command-registry.ts       # Command lookup + filtering
    a11y.ts                   # Accessibility utilities
    notify.ts                 # Toast notifications

  styles/                # CSS modules
    base.css                  # Variables, fonts, globals
    ide.css                   # Layout + chrome
    (26+ feature-specific stylesheets)
```

### Backend Architecture

```
src-tauri/src/
  lib.rs                 # App setup, state initialization, event forwarding
  main.rs                # Entry point
  workspace.rs           # Path validation + security boundary
  watcher.rs             # File change detection (notify crate)
  filebuffer.rs          # Large file memory-mapped streaming
  browser.rs             # Embedded webview management
  browser_module.rs      # Built-in browser control

  commands/              # IPC command handlers
    file.rs              # Read, write, list, create, delete, rename, move, watch
    terminal.rs          # Spawn PTY, write, resize, kill, theme
    syntax.rs            # Open/close/edit document, highlight viewport
    lsp.rs               # 14 LSP commands (start, completion, hover, definition, etc.)
    git.rs               # 30+ git commands (status, commit, push, branch, stash, etc.)
    debugger.rs          # Breakpoints, launch, step, variables, stack
    extensions.rs        # List, load, unload, call, gateway, install, uninstall
    browser.rs           # Create, navigate, resize, show/hide webviews
    keymap.rs            # Lua keymap evaluation
    session.rs           # Save/load session, backup buffers
    settings.rs          # Load/save settings, recent folders
    search.rs            # File listing, content search
    filebuffer.rs        # Large file line reading

  terminal/              # Terminal emulation
    mod.rs               # PTY + vt100 + theme, delta encoding

  syntax/                # Tree-sitter integration
    mod.rs               # Document tree + incremental parsing

  lsp/                   # Language server client
    mod.rs               # LSP manager (server registry, crash recovery)
    client.rs            # LSP protocol implementation

  extensions/            # WASM extension system
    mod.rs               # ExtensionManager, discovery, loading
    manifest.rs          # TOML parsing, capability validation
    runtime.rs           # Wasmtime runtime, host functions, memory
    gateway.rs           # WebSocket + HTTP SSE transport
    surface.rs           # Canvas surface rendering + input forwarding

  debugger/              # DAP client
    mod.rs               # Breakpoint management, session, events
    client.rs            # DAP JSON-RPC protocol

src-tauri/crates/        # Internal Rust libraries
  syntax/                # buster-syntax: incremental Tree-sitter
  lsp-manager/           # buster-lsp-manager: LSP client + crash recovery
  terminal-pro/          # buster-terminal-pro: VT100 + sixel + scrollback
  dap/                   # buster-dap: Debug Adapter Protocol
  sandbox/               # buster-sandbox: WASM execution sandbox
```

### IPC Communication

Frontend and backend communicate through Tauri v2's IPC bridge:

**Commands (frontend to backend):**

1. Frontend calls `invoke("command_name", { param1, param2 })` via the Tauri API
2. Tauri serializes parameters to JSON
3. Rust command handler receives typed parameters via Serde deserialization
4. Handler executes and returns `Result<T, String>`
5. Tauri serializes the result to JSON
6. Frontend receives the result (or error)

There are 100+ registered command handlers across all categories (file, git, LSP, terminal, extensions, debugger, session, search, settings, browser, keymap).

**Events (backend to frontend):**

1. Backend spawns event forwarding threads on app startup
2. Internal channels (mpsc) carry events from subsystems to the forwarding threads
3. Forwarding threads call `app_handle.emit("event-name", data)`
4. Frontend listens via `listen("event-name", callback)`

Four persistent event channels:

| Event | Source | Data |
|-------|--------|------|
| `lsp-diagnostics` | LSP manager | File path + diagnostic array |
| `file-changed-externally` | File watcher | File path |
| `debug-event` | DAP client | Debug event (stopped, thread, output) |
| `surface-event` | Extension surface manager | Surface ID + paint/input data |

### Event System

The file watcher uses the `notify` crate for cross-platform file monitoring:

- **Debouncing** — per-path 500ms debounce prevents duplicate events
- **Self-write suppression** — when Buster saves a file, watcher events for that path are suppressed for 200ms
- **Event filtering** — only data modifications and creates are forwarded

### State Management

**Frontend state** is managed through a SolidJS context provider (`BusterProvider`). The store contains ~93 reactive fields including:

- Tab list, active tab, tab metadata
- File contents, scroll positions, cursor positions
- UI toggle states (sidebar, find, palette, menus)
- Workspace root, git branch name
- Diagnostics map, search matches
- Settings, theme palette
- Debug session state

State mutations flow through action functions defined in `buster-actions.ts`. Actions use `setStore()` to update specific fields, triggering fine-grained reactivity in exactly the components that depend on those fields.

**Backend state** uses Tauri's `.manage()` system with shared Arc/Mutex types:

- `WorkspaceState` — current project directory
- `TerminalManager` — PTY instance map
- `SyntaxService` — Tree-sitter document trees
- `LspManager` — language server instances
- `ExtensionManager` — WASM runtimes
- `FileWatcher` — watched path set
- `BrowserManager` — webview instances
- `DebugManager` — debug sessions
- `FileBufferManager` — memory-mapped files

### Internal Crates

**buster-syntax** — Incremental Tree-sitter parsing with persistent document trees. Applies edit deltas without reparsing the full file. Returns viewport-scoped highlight spans as `{line, start_col, end_col, kind}`. Falls back to stateless parsing if a document tree wasn't opened.

**buster-lsp-manager** — Language server client with document state tracking. `DocumentState` maintains URI, language ID, version, and content for each open document. Supports incremental text synchronization via `EditDelta`. Crash detection triggers auto-restart with exponential backoff (up to 3 retries). URI handling uses proper percent-encoding for paths with spaces and special characters.

**buster-terminal-pro** — Terminal emulation layer. Wraps the `vt100` crate with additions for sixel image parsing, scrollback buffer management (10,000 lines), runtime theme switching, CJK display-width handling, and hyperlink detection. Produces delta-encoded screen updates (only changed rows) for efficient frontend rendering.

**buster-dap** — Debug Adapter Protocol client. Thread-safe breakpoint store using `RwLock<HashMap>`. Adapter registry for debug adapter discovery. Typed event channel with `mpsc` for forwarding debug events (stopped, thread, output, breakpoint) to the frontend.

**buster-sandbox** — Code execution sandbox. OS-level process isolation with an allowlist-based capability system. Validates commands against the allowlist before execution. Enforces workspace containment — processes cannot access files outside the project directory. Used by the extension system for `host_run_command()`.

---

## Security

### Workspace Isolation

Every file operation validates the requested path against the workspace root:

1. The path is canonicalized (symlinks dereferenced, `..` resolved)
2. The canonical path is checked to start with the workspace root
3. For new files, the parent directory is checked instead

Paths outside the workspace are rejected with an error. This prevents directory traversal attacks from extensions, gateway connections, or any other vector.

### WASM Sandbox

Extensions execute in Wasmtime's WASM sandbox:

- **Memory isolation** — each extension has its own linear memory, inaccessible to other extensions or the host
- **Capability enforcement** — host functions check declared capabilities before execution
- **Epoch interruption** — extensions are terminated after 5 seconds of execution
- **No raw system access** — extensions can only interact with the system through declared host functions

### Shell Command Safety

Shell commands executed by extensions pass through the `buster-sandbox` crate:

- Commands are parsed using the `shlex` crate for safe word splitting (no shell injection)
- An allowlist validates which commands are permitted
- Blocked patterns include: `rm -rf /`, `sudo`, credential access commands, network tools
- Command output (stdout, stderr, exit code) is captured and returned as structured JSON

### Secure Storage

Sensitive values (authentication tokens, SSH keys) use the OS keychain via the `keyring` crate:

- macOS: Keychain
- Windows: Credential Manager
- Linux: Secret Service (GNOME Keyring, KWallet)

No sensitive data is stored in plaintext on disk.

---

## Build and Development

### Prerequisites

- [Rust](https://rustup.rs/) (stable, 1.70+)
- [Bun](https://bun.sh/) (1.0+)
- [Node.js](https://nodejs.org/) (v20+)
- Platform-specific:
  - **macOS:** Xcode Command Line Tools
  - **Linux:** `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev`
  - **Windows:** Visual Studio Build Tools with C++ workload

### Development Mode

```bash
bun install
bun run tauri dev
```

Hot-reload for the frontend (Vite + SolidJS). Automatic Rust rebuild on backend changes.

The dev server runs on port 1420.

### Production Build

```bash
bun run tauri build
```

Builds platform-specific bundles:

- macOS: `.app` bundle and `.dmg` installer (Universal binary for ARM + Intel)
- Windows: NSIS installer
- Linux: AppImage and `.deb` package

### Running Tests

```bash
# Frontend tests (Vitest)
bun run test

# Rust tests
cd src-tauri && cargo test

# Type checking
bunx tsc --noEmit
```

### CI/CD Pipeline

GitHub Actions workflows handle continuous integration and releases:

**CI (on push/PR):**
- Lint, type-check, and test on Ubuntu, macOS, and Windows
- Matrix build across all supported platforms

**Release (on version tag):**
- Build platform bundles for macOS (ARM + Intel), Windows, and Linux
- Upload to GitHub Releases
- Auto-updater endpoint for the Tauri updater plugin

---

## Platform Support

| Platform | Status | Bundle Format |
|----------|--------|---------------|
| macOS (ARM) | Supported | .app, .dmg |
| macOS (Intel) | Supported | .app, .dmg |
| Windows | Supported | NSIS installer |
| Linux | Supported | AppImage, .deb |
| iOS | Research | Tauri v2 mobile support available |
| Android | Research | Tauri v2 mobile support available |

Minimum macOS version: 10.15 (Catalina).

Auto-updates are delivered through GitHub Releases via the Tauri updater plugin. The app checks for updates on launch and downloads them in the background.

---

## Accessibility

Buster includes accessibility features for keyboard-only and screen reader users:

### Screen Reader Support

- **ARIA labels** on all interactive canvas elements
- **Live regions** for status changes, toast notifications, and mode announcements
- **Hidden textarea** in the editor synchronized with visible content for screen reader line reading
- **Role attributes** on structural elements

### Keyboard Navigation

- **Full keyboard support** for every feature — no mouse required
- **Focus traps** in modal dialogs (Escape to close)
- **Region cycling** — F6/Shift+F6 cycles focus between Sidebar, Editor, and Dock Bar
- **Skip links** — hidden links at the top of the page to jump to Editor, Sidebar, or Terminal
- **Tab trapping** — Ctrl+M toggles whether Tab inserts a tab character or navigates focus
- **Context menus** navigable with arrow keys and Enter

### Visual Indicators

- **Focus rings** on all focused elements
- **High contrast** diagnostic colors (red errors, yellow warnings)
- **Cursor blink** with configurable rate

---

## Contributing

### Code Style

- **TypeScript:** No explicit `any` types. Prefer `unknown` or proper generics.
- **Rust:** Follow `cargo clippy` recommendations. No `unwrap()` in production code.
- **CSS:** Use CSS variables from the theme system.
- **Canvas:** Static canvas elements use on-demand rendering (no `requestAnimationFrame` loops).
- **Font:** Courier New for all UI chrome. JetBrains Mono for the editor.

### Pull Requests

1. Fork and create a feature branch from `main`
2. Keep changes focused — one feature or fix per PR
3. Include tests for new functionality
4. Ensure `bun run test` and `cargo test` pass
5. Write a clear PR description

### Reporting Issues

File bugs and feature requests at [github.com/hightowerbuilds/buster/issues](https://github.com/hightowerbuilds/buster/issues).

Security vulnerabilities should be reported to security@hightowerbuilds.com. See SECURITY.md for the full disclosure policy.

---

## License

MIT License. Copyright 2024-2026 Luke Hightower.
