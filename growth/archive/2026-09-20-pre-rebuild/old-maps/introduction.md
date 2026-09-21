# Buster IDE

A canvas-rendered coding workspace built from scratch.

---

## What Is Buster?

Buster is a desktop IDE where every character on screen — code, terminal output, tabs, status bars, file trees — is drawn on an HTML Canvas. There is no DOM text anywhere in the application. The result is an editor that feels like a native graphics application: no layout thrashing, no style recalculation, no reflow. Just pixels on a canvas, refreshed only when something changes.

The core loop is simple:

**Open a project. Navigate fast. Edit fast. Run in the terminal. Inspect git.**

Everything in Buster serves that loop. The architecture, the technology choices, the features that ship and the features that don't — all of it exists to make that five-step cycle feel instant.

---

## The Argument

### IDEs are too heavy

The dominant code editors are built on Electron, a framework that bundles an entire Chromium browser into every application. VS Code installs at 350 MB. WebStorm installs at 2.5 GB. They use hundreds of megabytes of RAM before you open a single file. They render text using the browser's DOM layout engine — an engine designed for web pages with images, columns, and floating elements — to display what is fundamentally a grid of monospaced characters.

This is an architectural mismatch. A code editor doesn't need a layout engine. It needs a text buffer and a drawing surface.

### Canvas solves the mismatch

Buster draws every character directly onto an HTML Canvas using the Canvas 2D API, with a WebGL2 glyph atlas for GPU-accelerated text rendering when available. There is no DOM between the text buffer and the screen. No virtual DOM diffing. No CSS cascade. No reflow.

The rendering pipeline is:

1. A TypeScript `string[]` holds the text buffer
2. Tree-sitter produces syntax tokens
3. Pretext measures glyph widths
4. Canvas 2D (or WebGL2) draws the visible lines
5. SolidJS signals trigger redraws only when data changes

The editor never renders a frame unless something actually changed. There is no `requestAnimationFrame` loop running in the background. The canvas is static until you type, scroll, or resize.

### The text buffer lives in the frontend

Most editors send every keystroke across a process boundary to a backend buffer. Buster doesn't. The text buffer is a TypeScript `string[]` array backed by SolidJS fine-grained reactive signals. Edits happen in the same process that renders the result. There is zero IPC per keystroke.

Syntax highlighting, undo/redo, code folding, search, word wrap — all of these operate on the frontend buffer. The backend handles heavier operations (git, LSP, terminal, file I/O) asynchronously without blocking edits.

### Tauri instead of Electron

Buster is built on Tauri v2, which uses the operating system's native webview instead of bundling Chromium. The Rust backend compiles to a small native binary. The result:

- **43 MB** installed (vs. 350 MB for VS Code, 2.5 GB for WebStorm)
- Native memory efficiency — the webview is shared with the OS
- Direct access to system APIs through Rust
- Cross-platform: macOS, Windows, Linux from one codebase

### SolidJS instead of React

The frontend uses SolidJS, a reactive framework with no virtual DOM. Where React re-renders entire component trees and diffs the result, SolidJS compiles reactive expressions into direct DOM updates. Only the specific signal that changed triggers a re-render of the specific element that depends on it.

For a canvas-rendered IDE, this means the reactive system updates exactly the data that changed, and only the affected region of the canvas redraws. There is no wasted work.

---

## Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Desktop shell | Tauri v2 | Native webview, Rust backend, fraction of Electron's size |
| Backend language | Rust | Memory safety, performance, system access |
| Frontend framework | SolidJS | Fine-grained reactivity, no virtual DOM, 7 KB runtime |
| Rendering | Canvas 2D + WebGL2 | Immediate-mode drawing, GPU text batching |
| Text buffer | TypeScript string[] | Zero-latency edits, no IPC per keystroke |
| Syntax highlighting | Tree-sitter | Incremental parsing, 100+ languages, native Rust |
| Text measurement | Pretext | Accurate glyph metrics for canvas layout |
| Terminal emulation | vt100 + portable-pty | Real PTY, full ANSI/VT100 support in Rust |
| Extension runtime | Wasmtime | WASM sandbox with capability-based permissions |
| Async runtime | Tokio | Non-blocking I/O for all backend operations |
| UI font | Courier New | Monospaced consistency across all chrome |
| Editor font | JetBrains Mono | Programming ligatures, clear glyph distinction |
| Theme system | Catppuccin Mocha | HSL-based palette generation from a single seed hue |

---

## Features

### Editor

A full-featured code editor rendered entirely on canvas. The text buffer is a TypeScript `string[]` with undo/redo, code folding, multi-cursor editing, word wrap, virtual scrolling, and regex find/replace. Syntax highlighting runs through Tree-sitter with incremental parsing — only the subtree affected by an edit is reparsed. Large files (50 MB+) are memory-mapped and streamed on demand.

LSP integration provides autocomplete, hover documentation, signature help, code actions, inlay hints, go-to-definition, find all references, rename refactoring, and a diagnostics panel. Language servers crash-recover automatically with exponential backoff.

Vim mode is available with full modal editing: normal, insert, visual, and command-line modes.

### Terminal

A full terminal emulator rendered on the same canvas pipeline as the editor. The backend runs a real PTY through the `portable-pty` crate with VT100/ANSI parsing via the `vt100` crate. It supports NeoVim, tmux, htop, and anything else that runs in a terminal.

Features include 256-color and true color support, sixel image rendering, mouse reporting, bracketed paste, scrollback history with search, and CJK double-width character support. Each terminal opens as a tab alongside your files.

### Git

30 built-in git commands with no terminal required. Status, staging, commit (with amend), push, pull, fetch, branch management, stash operations, remote management, blame overlay, diff gutter indicators, conflict resolution with ours/theirs selection, and a canvas-rendered commit graph with colored lanes showing branch history.

### Language Server Protocol

Support for Rust (rust-analyzer), TypeScript/JavaScript (typescript-language-server), Python (pyright), Go (gopls), and more. The LSP manager handles server lifecycle, crash recovery with auto-restart, incremental text synchronization, and proper URI encoding for paths with special characters.

### Layouts

Seven layout modes: single tab, columns, grid, trio, quint, rerack, and HQ (3x2). Draggable dividers between panels. The layout system operates on panel counts (1-6) with automatic demotion when tabs close.

### Extensions

WASM-sandboxed extensions with a capability-based permission system. Extensions declare what they need (file read, file write, shell commands, network access, UI rendering) in a TOML manifest. They run in Wasmtime with epoch-based interruption.

Extensions can render custom UI surfaces via display list commands, control embedded browser webviews, and connect to external services via WebSocket or HTTP SSE gateways.

### Session Restore

Auto-saves every 30 seconds. Hot-exit on window close. Restores workspace, tabs, cursor positions, scroll offsets, and dirty buffers on relaunch. Crash detection via a running flag — if the app didn't shut down cleanly, unsaved content is recovered from backup buffers.

### Command Palette

Cmd+P opens fuzzy file search across the workspace (respects .gitignore). Prefix modes switch context: `>` for commands, `:` for go-to-line, `@` for document symbols via LSP, `#` for workspace-wide content search.

### Debugger

DAP-based debugging with conditional breakpoints, step over/into/out, stack frame inspection, and variable watch. Works with any Debug Adapter Protocol server.

### Accessibility

Screen reader support with ARIA labels, live regions for status announcements, skip links, keyboard navigation for all features, focus traps in dialogs, and region cycling with F6/Shift+F6.

---

## Architecture

```
Frontend (TypeScript + SolidJS)              Backend (Rust + Tauri v2)

  Text Buffer (string[])                      File System
  - Zero IPC per keystroke         <--->      - Read, write, watch
  - SolidJS signals                           - Workspace security
  - Undo/redo, folding, search                - Large file streaming

  Canvas Renderer                             Tree-sitter Syntax
  - Canvas 2D + WebGL2 text       <--->      - Incremental parsing
  - On-demand rendering                       - 100+ languages
  - Hit regions for interaction               - Viewport-scoped output

  LSP Features                                LSP Manager
  - Autocomplete, hover           <--->      - Server lifecycle
  - Diagnostics, code actions                 - Crash recovery
  - Signature help, inlay hints               - Document sync

  Terminal UI                                 Terminal (PTY)
  - Canvas cell grid              <--->      - VT100 parsing
  - Scroll, selection, sixel                  - Delta encoding

  Git UI                                      Git Commands
  - Status, staging, graph        <--->      - 30+ operations
  - Conflict resolution                       - Subprocess to git CLI

  Extension UI                                Extension Manager
  - Display list surfaces         <--->      - Wasmtime runtime
  - Gateway events                            - Capability sandbox
```

The frontend and backend communicate through Tauri's IPC bridge. Commands flow from frontend to backend as JSON-serialized function calls. Events flow from backend to frontend as emitted messages. Four event channels run continuously: LSP diagnostics, file changes, debug events, and extension surface updates.

---

## Internal Crates

The Rust backend is organized as a Cargo workspace with five supporting crates:

**buster-syntax** — Incremental Tree-sitter parsing. Maintains a persistent document tree per open file. Applies edit deltas without reparsing the full file. Returns viewport-scoped highlight spans.

**buster-lsp-manager** — Language server client with document state tracking. Handles incremental text synchronization, crash detection, and automatic server restart with exponential backoff.

**buster-terminal-pro** — Terminal emulation layer. VT100/ANSI parsing, sixel image decoding, scrollback buffer management, theme switching, and CJK width handling.

**buster-dap** — Debug Adapter Protocol client. Thread-safe breakpoint management, adapter registry, and typed event forwarding.

**buster-sandbox** — Code execution sandbox for extensions. OS-level process isolation with an allowlist-based capability system. Workspace containment prevents access outside the project directory.

---

## Design Principles

**Canvas-first.** Every pixel is drawn, not laid out. The rendering pipeline is immediate-mode: compute what to draw, draw it, stop. No persistent DOM tree for UI chrome.

**Zero-latency editing.** The text buffer lives in the frontend. Keystrokes never cross a process boundary. Backend operations (save, highlight, LSP) happen asynchronously.

**On-demand rendering.** Static canvases repaint only when their data changes. No animation loops. No polling. No wasted frames.

**Incremental everything.** Syntax highlighting reparses only the changed subtree. LSP syncs only the changed text range. Terminal updates encode only the changed rows. File changes detect only the modified paths.

**Workspace isolation.** Every file operation is validated against the workspace root. Path traversal is blocked. Extensions run in WASM with declared capabilities. Shell commands pass through an allowlist.

**Minimal dependencies.** The app installs at 43 MB. The frontend runtime is 7 KB. Dependencies are chosen for size and correctness, not convenience.

---

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (1.70+)
- [Bun](https://bun.sh/) (1.0+)
- macOS: Xcode Command Line Tools
- Linux: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Build from Source

```bash
git clone https://github.com/hightowerbuilds/buster.git
cd buster
bun install
bun run tauri build
```

### Development

```bash
bun run tauri dev
```

Hot-reload for the frontend. Automatic Rust rebuild on backend changes.

---

## Platform Support

Buster builds for macOS (ARM and Intel), Windows (NSIS installer), and Linux (AppImage and .deb). Auto-updates are delivered through GitHub Releases via the Tauri updater plugin.

Mobile support (iOS and Android) is under research. The Tauri v2 mobile entry point and canvas rendering pipeline are platform-agnostic, but the interaction model requires a touch-native redesign focused on code reading, status checking, quick fixes, and git management.

---

## License

MIT
