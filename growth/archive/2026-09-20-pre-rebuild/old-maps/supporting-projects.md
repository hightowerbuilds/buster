# Buster IDE — Supporting Projects Roadmap

Date: 2026-04-09
Source: Derived from Claude + Codex code reviews and full subsystem audit

This document lists standalone projects that need to be built externally and integrated into Buster to bring it to production readiness. Each project is something that should have its own repo, its own tests, and a clean integration boundary with Buster.

---

## 1. buster-sandbox — Command Execution Sandbox

**Why it exists:** Both reviews flagged the AI command blocklist and extension `host_run_command` as the single biggest security liability. The current model is substring matching on a blocklist fed into `sh -c`. It is trivially bypassable and breaks legitimate commands.

**What it replaces:** The blocked-pattern list in `ai/tools.rs` and the same list reused in `extensions/runtime.rs`.

**What it needs to do:**
- Allowlist-based execution model (not blocklist)
- Process-level sandboxing (seccomp-bpf on Linux, Seatbelt on macOS)
- Filesystem namespace restriction to workspace root
- Network access control (deny by default, allow per-tool)
- Resource limits: CPU time, memory, output size
- No reliance on `sh -c` for privileged paths
- Read-only vs read-write capability separation

**Integration surface:** Replaces `execute_command()` in `ai/tools.rs` and `host_run_command` in `extensions/runtime.rs`. Single Rust crate dependency.

**Integration risk:** High. Every AI tool call and every extension command call routes through this. Regression testing across both systems required.

---

## 2. buster-ext-template — Extension SDK + Starter Kit

**Why it exists:** The extension system has a working WASM runtime and gateway layer, but there is no external developer story. No SDK, no documentation beyond the internal README, no scaffolding tool, and only one reference extension (buster-format) that is missing its own manifest file.

**What it needs to deliver:**
- `buster-ext` CLI tool: `init`, `build`, `package`, `validate`, `publish`
- Rust guest SDK crate (`buster-ext-sdk`) wrapping the host function imports
- AssemblyScript or TinyGo SDK for non-Rust extension authors
- Extension manifest validator (checks `extension.toml` correctness)
- Extension ID sanitizer (blocks path traversal characters)
- Local dev server: load extension from source, hot-reload WASM on rebuild
- Integration test harness: mock host functions, assert behavior
- Template extensions: formatter, linter, gateway proxy, language support

**Integration surface:** Extensions built with this SDK load into the existing `WasmRuntime`. The SDK wraps `host_read_file`, `host_write_file`, `host_list_directory`, `host_run_command`, `log`, `notify`, `set_return`.

**Integration risk:** Medium. The runtime ABI is already defined. Risk is in the SDK misrepresenting capabilities or diverging from the runtime contract.

---

## 3. buster-collab-server — Collaboration Sync Server

**Why it exists:** The collab module has a local-only CRDT/OT engine with no networking whatsoever. There is no WebSocket server, no peer discovery, no operation broadcast. The CRDT transform function has a known bug (insert vs delete adds zero instead of shifting). Two clients connecting to this will see divergent text.

**What it needs to do:**
- WebSocket server accepting peer connections per document
- Operation log per document with causal ordering
- Broadcast operations to all connected peers
- Vector clocks or Lamport timestamps for ordering
- Conflict-free merge guarantees (replace current OT with a real CRDT — Yjs/Automerge-style or at minimum fix the transform bug)
- Peer presence: cursor positions, selections, online status
- Reconnection with operation replay from last-known version
- Snapshot mechanism for large operation histories
- Auth layer (workspace-scoped tokens)

**Integration surface:** Replaces `collab/crdt.rs` transform logic. Frontend needs new components for multi-cursor rendering and presence UI. `BusterProvider` needs to wire collab state into the editor engine.

**Integration risk:** Very high. Touches the editor engine's core text model, requires new frontend components, and introduces a networked dependency. Most complex integration on this list.

---

## 4. buster-dap — Debug Adapter Manager

**Why it exists:** The debugger has a working DAP client that can set breakpoints and launch, but it cannot tell the frontend when execution stops (events aren't forwarded — there's a TODO comment at line 78). The DAP client also has a use-after-free via raw pointer cast that is actual undefined behavior. There is no launch configuration system, no adapter registry, and no frontend UI.

**What it needs to do:**
- DAP adapter registry: discover, download, and cache debug adapters (codelldb, delve, debugpy, etc.)
- Launch configuration system: parse `launch.json`-style configs with variable substitution
- Event forwarding: async channel from DAP reader thread to Tauri event system (stopped, terminated, output, breakpoint-hit)
- Fix the UB: replace raw pointer cast with `Arc::clone`, remove `unsafe impl Send/Sync`
- Multi-session support (debug multiple processes)
- Breakpoint persistence across IDE restarts
- Conditional breakpoints and watchpoints
- Variable inspection with lazy child expansion
- Process cleanup on IDE exit (no zombie debug adapters)

**Integration surface:** Replaces `debugger/client.rs` and `debugger/mod.rs`. New Tauri events for frontend consumption. New frontend panel for debug controls, call stack, variables, breakpoints.

**Integration risk:** High. The UB fix is mandatory and changes the threading model. Event forwarding requires new Tauri event types and new frontend components that don't exist yet.

---

## 5. buster-lsp-manager — Production LSP Client Library

**Why it exists:** The LSP client works for basic operations but has structural problems: full-document sync on every keystroke, a new HashMap allocated on every server registry lookup, stderr silenced (can't debug server issues), no server auto-install, no crash recovery, no incremental text sync, and no support for workspace symbols, call hierarchy, semantic tokens, or cancellation.

**What it needs to do:**
- Incremental text sync (TextDocumentSyncKind.Incremental) — send only changed ranges
- Server lifecycle management: auto-spawn, health monitoring, restart-on-crash
- Configurable server registry (not hardcoded HashMap rebuilt on every call)
- Error visibility: capture and surface stderr from language servers
- Support workspace/symbol, callHierarchy, typeHierarchy, semanticTokens
- Request cancellation via $/cancelRequest
- Progress reporting via window/workDoneProgress
- Proper URI encoding/decoding (not string concatenation)
- UTF-16 offset mapping for servers that use UTF-16 positions

**Integration surface:** Replaces `lsp/client.rs` and `lsp/mod.rs`. `commands/lsp.rs` boilerplate can be collapsed into a generic request handler. Frontend LSP consumers (autocomplete, hover, diagnostics, etc.) should mostly be unaffected if the IPC contract is preserved.

**Integration risk:** Medium-high. The IPC contract is well-defined, but incremental sync requires the editor engine to report change ranges (not just full text), which touches the engine's core edit path.

---

## 6. buster-syntax — Incremental Syntax Highlighting Service

**Why it exists:** The current syntax highlighter creates a new tree-sitter `Highlighter` and reparses the entire document from scratch on every keystroke (after 100ms debounce). Tree-sitter's primary advantage is incremental parsing — you call `edit()` on the tree and reparse only the changed range. For large files this is a significant performance problem. Additionally, `HighlightConfiguration` objects are leaked via `Box::leak` and never freed.

**What it needs to do:**
- Maintain a persistent tree-sitter `Tree` per open document
- Accept incremental edits (byte range + new text) and reparse only the affected region
- Return highlight spans for visible viewport only (not entire document)
- Proper lifetime management for `HighlightConfiguration` (Arc, not Box::leak)
- Grammar hot-reload support for extension-provided languages
- Thread-safe design (parse on background thread, query on main)

**Integration surface:** Replaces `syntax/mod.rs`. The frontend `CanvasEditor.tsx` currently calls `highlightCode(fullText)` — this changes to `highlightEdit(range, newText)` plus `highlightViewport(startLine, endLine)`.

**Integration risk:** Medium. The editor engine needs to emit edit ranges (same requirement as incremental LSP sync — these two projects share a prerequisite).

---

## 7. buster-remote — Remote Development Bridge

**Why it exists:** Remote SSH support exists but is blocking inside sync Mutexes during network I/O, supports only one connection, has no file caching or workspace mirroring, no remote LSP bridge, no remote terminal (PTY allocation), and no host key verification.

**What it needs to do:**
- Async SSH client (replace sync Mutex + blocking I/O with tokio-based SSH)
- Multi-connection support with connection pooling
- Workspace mirroring: sync remote directory into local cache with incremental updates
- Remote LSP bridge: spawn LSP server on remote, proxy requests over SSH
- Remote terminal: PTY allocation on remote machine via SSH channel
- Host key verification (known_hosts integration)
- Secure credential storage (keyring for passphrases)
- Reconnection with session recovery
- File change watching on remote (inotify over SSH or polling fallback)

**Integration surface:** Replaces `remote/mod.rs`. Needs deep integration with workspace state, LSP manager, terminal manager, and file watcher. The frontend needs a connection panel, remote file browser, and status indicators.

**Integration risk:** Very high. Touches nearly every subsystem (files, LSP, terminal, workspace state). The async rewrite changes the threading model. Most cross-cutting integration on this list.

---

## 8. buster-terminal-pro — Hardened Terminal Emulator

**Why it exists:** The terminal works well for basic use but has gaps: no PTY crash recovery, hardcoded Catppuccin colors (can't switch themes), no image protocol support (sixel, iTerm2, kitty), no hyperlink support (OSC 8), no alt-screen mode awareness, no double-width character support, and the reader thread can't be cleanly cancelled.

**What it needs to do:**
- PTY crash detection and graceful restart
- Theme abstraction: runtime-switchable color schemes
- Alt-screen mode awareness (separate scrollback for full-screen apps like vim/less)
- OSC 8 hyperlink parsing and click handling
- Sixel or kitty image protocol (at least one)
- Double-width character support (CJK)
- Proper Unicode combining character handling
- Bell notification (configurable: visual flash, system notification, or silent)
- Terminal search/find within scrollback
- Scrollback memory management (trim beyond configurable limit)

**Integration surface:** Replaces `terminal/mod.rs`. Frontend `CanvasTerminal.tsx` needs updates for theme switching, hyperlink rendering, image rendering, and search UI.

**Integration risk:** Medium. The PTY interface is well-defined. Most changes are additive rather than replacing core logic. Image protocol support adds a new rendering path to the canvas.

---

## 9. buster-path — Cross-Platform Path Utilities

**Why it exists:** Both reviews flagged pervasive Unix-only path handling throughout the frontend. Manual slash-splitting, prefix slicing, and string concatenation appear in BusterProvider, SidebarTree, PanelRenderer, Sidebar, GitPanel, and the LSP layer. Windows paths will break everywhere.

**What it needs to do:**
- Path normalization (forward/back slash, drive letters, UNC paths)
- Workspace-relative path computation
- Proper `file://` URI encoding/decoding (spaces, %, #, non-ASCII)
- Breadcrumb generation from paths
- Path comparison (case-insensitive on Windows, case-sensitive on Unix)
- Git path format conversion
- All operations available as a TypeScript library for the frontend

**Integration surface:** Imported across ~10 frontend files that currently use manual string operations. Also replaces URI handling in `commands/lsp.rs` on the Rust side.

**Integration risk:** Low individually per call site, but high in aggregate — many files touched, each needing manual verification. Best done with a comprehensive test suite first.

---

## 10. buster-test-harness — End-to-End IDE Test Framework

**Why it exists:** Both reviews noted that testing covers unit cases but not real IDE workflows. There are no end-to-end tests for: open folder, edit file, save, receive external changes, session restore, terminal lifecycle, LSP on paths with spaces, AI approval flow, or extension install-and-use. The CI doesn't even run `tauri build`.

**What it needs to do:**
- Headless Tauri test runner (launch the app, drive it programmatically)
- Filesystem fixture management (create workspace, seed files, modify externally)
- IPC assertion layer (verify Tauri commands produce expected results)
- Terminal scenario runner (spawn PTY, send input, assert screen state)
- LSP integration tests (start real language server, verify completions/diagnostics)
- Extension lifecycle tests (install, load, call, unload, uninstall)
- Cross-platform CI matrix (macOS + Linux at minimum, Windows when path utils are ready)
- Performance regression tests (editor rendering, syntax highlighting, file open latency)
- Security boundary tests (verify sandbox blocks traversal, verify command restrictions)

**Integration surface:** Wraps the entire application. Depends on all other projects being integrated first for full coverage, but can start with the core editor/file/terminal workflows immediately.

**Integration risk:** Low — it's a test consumer, not a production dependency. But building and maintaining it is a sustained effort.

---

## Priority Tiers

### Tier A — Ship Blockers (must exist before any public release)
1. **buster-sandbox** — Security is the #1 blocker per both reviews
2. **buster-path** — Cross-platform correctness is table stakes for an IDE
3. **buster-test-harness** — Can't ship what you can't verify

### Tier B — Core Quality (needed for daily-driver reliability)
4. **buster-lsp-manager** — Incremental sync + crash recovery
5. **buster-syntax** — Incremental parsing for large file performance
6. **buster-ext-template** — Can't have an extension ecosystem without an SDK

### Tier C — Feature Completion (needed for competitive positioning)
7. **buster-dap** — Debugging is expected in any IDE
8. **buster-terminal-pro** — Terminal hardening for power users
9. **buster-remote** — Remote development is increasingly expected

### Tier D — Differentiation (what makes Buster special)
10. **buster-collab-server** — Real-time collaboration

---

## Integration Cascade

These projects are not independent. The integration order matters because of shared prerequisites:

```
buster-path (no dependencies)
    |
    +---> buster-sandbox (needs path validation from buster-path)
    |         |
    |         +---> buster-ext-template (SDK wraps sandboxed execution)
    |
    +---> buster-lsp-manager (needs proper URI encoding from buster-path)
    |         |
    |         +---> buster-remote (remote LSP bridge depends on LSP manager)
    |
    +---> buster-syntax (independent, but shares "edit range" prerequisite with LSP)

buster-dap (independent — fix UB, add event forwarding)

buster-terminal-pro (independent — additive improvements)

buster-collab-server (independent — but integration touches editor core)

buster-test-harness (wraps everything — start early, grow continuously)
```

The editor engine needs to emit **edit ranges** (byte offset + length + new text) for both `buster-syntax` and `buster-lsp-manager`. This is a shared prerequisite that should be tackled first as an internal change to `engine.ts`.

---

## What This Creates

Each of these projects, when integrated, will create its own wave of problems:

- **buster-sandbox** will break AI tool calls and extension commands that relied on shell behavior the sandbox now blocks. Every AI workflow and extension needs re-testing.
- **buster-path** will surface bugs in every file that was doing manual string splitting. Expect a long tail of edge cases.
- **buster-lsp-manager** requires the editor to report edit ranges, which is a fundamental change to the edit pipeline.
- **buster-syntax** requires the same edit-range infrastructure plus changes to how the frontend requests highlights.
- **buster-collab-server** requires the editor engine to accept remote operations, which means the text model needs to become conflict-aware.
- **buster-remote** touches files, LSP, terminal, and workspace state — the widest blast radius of any project.
- **buster-test-harness** will immediately surface bugs you didn't know existed. That's the point.

This is the work that turns a strong alpha into a production IDE.
