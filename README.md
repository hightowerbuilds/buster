# Buster

A canvas-rendered IDE built from scratch with Tauri, Rust, and SolidJS.

Every character on screen — code, terminal, UI — is drawn on an HTML Canvas. No DOM text anywhere. The editor uses a TypeScript string[] buffer backed by SolidJS signals, Tree-sitter for syntax highlighting, and Pretext for text measurement. The terminal runs a real PTY through a VT100 parser in Rust and renders the cell grid on canvas.

## Install

### Prerequisites

- [Rust](https://rustup.rs/) (1.70+)
- [Bun](https://bun.sh/) (1.0+)
- On macOS: Xcode Command Line Tools (`xcode-select --install`)
- On Linux: see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Build from source

```bash
git clone https://github.com/hightowerbuilds/buster.git
cd buster
bun install
bun run tauri build
```

The built app will be at:
- macOS: `src-tauri/target/release/bundle/macos/Buster.app`
- macOS DMG: `src-tauri/target/release/bundle/dmg/Buster_0.1.0_x64.dmg`

### Development

```bash
bun run tauri dev
```

This starts the app with hot-reload for the frontend. Rust changes trigger an automatic rebuild.

## Usage

### Getting started

Open Buster. The welcome screen shows an ASCII particle animation. Open a folder from the sidebar to start editing, or use the command palette (**Cmd+Shift+P**) to browse actions.

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+S | Save |
| Cmd+Z | Undo |
| Cmd+Shift+Z | Redo |
| Cmd+F | Find / Replace |
| Cmd+P | Quick Open (fuzzy file search) |
| Cmd+Shift+P | Show All Commands |
| Ctrl+G | Go to Line |
| Cmd+Shift+O | Go to Symbol |
| Cmd+T | New terminal tab |
| Cmd+Shift+G | Git panel |
| Cmd+B | Toggle sidebar |
| Cmd+O | Open folder |
| Cmd+W | Close tab |
| Cmd+, | Settings |
| F8 / Shift+F8 | Next / Previous diagnostic |
| F6 / Shift+F6 | Cycle focus between regions |
| Escape | Close overlays |

### Features

**Editor** — Canvas-rendered with a TypeScript string[] buffer (SolidJS signals). Syntax highlighting via Tree-sitter for 100+ languages. Code folding, find/replace with regex, minimap, multi-cursor editing, word wrap, virtual scrolling, AI ghost text completions. Large files (50 MB+) are streamed on demand. Markdown preview mode for .md files. Image viewer for PNG, JPG, GIF, and WebP.

**Terminal** — Full terminal emulator rendered on canvas. VT100/ANSI parsing in Rust via the vt100 crate with sixel image support. Supports NeoVim, htop, tmux, and anything else that runs in a terminal. Mouse reporting, bracketed paste, scrollback history, configurable themes. Each terminal opens as a tab alongside your files.

**Git** — 30 built-in git commands with no terminal required. Status, staging, commit (with amend), push/pull/fetch, branches, stash, remote management, blame overlay, diff gutter indicators, conflict resolution, and a canvas-rendered commit graph with colored lanes.

**LSP** — Language server support for Rust (rust-analyzer), TypeScript/JavaScript (typescript-language-server), Python (pyright), and Go (gopls). Autocomplete, hover, signature help, code actions, inlay hints, go-to-definition, document symbols, rename refactoring, find all references, and a diagnostics panel with automatic crash recovery.

**Debugger** — DAP-based debugging. Set breakpoints (with conditions), launch programs, step over/into/out, pause, and inspect stack frames and variables. Works with any Debug Adapter Protocol server.

**Quick Open** — Cmd+P opens a fuzzy file search across your workspace. Respects .gitignore. Prefix modes: `>` commands, `:` go-to-line, `@` symbols, `#` content search, `?` AI.

**Find & Replace** — Cmd+F with regex support, match highlighting, case sensitivity toggle, replace one or replace all.

**Layouts** — Panel layout modes: Tabs, Columns, Grid, Trio, Quint, Rerack, and HQ (3x2 grid). Draggable dividers between panels.

**File Explorer** — Sidebar with lazy-loading directory tree. Respects .gitignore. Drag and drop files between folders. Right-click context menu with rename, delete, copy path.

**Session Restore** — Auto-saves every 30 seconds. Hot-exit on window close. Restores workspace, tabs, cursor positions, and dirty buffers on relaunch.

**Extensions** — WASM-sandboxed extensions with capability-based permissions. Extensions can render custom UI surfaces via display list commands, control embedded browser webviews, and connect via WebSocket or HTTP SSE gateways to external services. Three working Rust extensions exist: an embedded browser with devtools, a pixel art editor, and a prompt stacker.

## Architecture

```
src/                          Frontend (TypeScript + SolidJS)
  editor/                     Canvas editor, engine, Tree-sitter bridge, LSP features
  ui/                         Sidebar, tabs, terminal, git, debugger, command palette
  lib/                        IPC bridge, TanStack Query, commands, menu handlers, session

src-tauri/src/                Backend (Rust)
  commands/                   IPC handlers (file, git, lsp, terminal, extensions, debugger, session)
  debugger/                   DAP client and session manager
  extensions/                 WASM runtime, gateway, manifest, UI surfaces
  lsp/                        Language server client, diagnostic forwarding
  syntax/                     Tree-sitter highlighting (100+ languages)
  terminal/                   VT100 state (vt100 crate) + PTY (portable-pty)
  browser.rs                  Embedded webview management
  watcher.rs                  File change detection
  workspace.rs                Path validation + security boundary
```

### Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 |
| Backend | Rust |
| Frontend framework | SolidJS |
| Data fetching | TanStack Solid Query |
| Text buffer | TypeScript string[] (SolidJS signals) |
| Syntax highlighting | Tree-sitter (native Rust) |
| Text measurement | Pretext (@chenglou/pretext) |
| Terminal parsing | vt100 crate |
| Terminal PTY | portable-pty |
| Extension runtime | wasmtime (WASM sandbox) |
| UI font | Courier New |
| Editor font | JetBrains Mono |
| Theme | Catppuccin Mocha (with custom hue rotation) |

### Why these choices

**SolidJS** over React — No virtual DOM. Fine-grained reactivity means signals update only what changed.

**Tauri** over Electron — Rust backend with native webview. Fraction of the install size. Lower memory usage. Direct access to system APIs.

**Canvas** over DOM — Every character is drawn via Canvas 2D. No reflow, no style recalculation.

**TypeScript string[]** over Rust IPC — Zero-latency edits with no IPC per keystroke. SolidJS signals provide reactive updates. Undo/redo with time-based grouping.

**vt100 + Canvas** over xterm.js — Terminal state lives in Rust. Rendering goes through the same canvas pipeline as the editor.

## License

MIT
