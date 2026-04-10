# Buster Suite — Remaining Work

Date: 2026-04-09
Source: Audit of all 10 supporting projects against original roadmap specifications

All 10 projects are built, tested, and integrated into Buster. This document lists the specific features from the original spec that were not implemented in this session. These are refinements and extensions to working code, not missing projects.

---

## buster-path — COMPLETE

No remaining work. All specified features implemented and tested (54 tests).

---

## buster-sandbox

**Built:** Allowlist model, filesystem restriction, network access control, resource limits, direct process spawning (no sh -c), read/write capability separation. 9 tests.

**Remaining:**
- [ ] Process-level sandboxing via seccomp-bpf (Linux) and Seatbelt (macOS) — currently enforces policy at the application level but does not use OS-level syscall filtering

---

## buster-ext-template

**Built:** CLI with init/build/package/validate, Rust guest SDK, manifest validator with path traversal protection, extension ID sanitizer. 19 tests.

**Remaining:**
- [ ] `publish` CLI command (upload to extension registry)
- [ ] AssemblyScript or TinyGo SDK for non-Rust extension authors
- [ ] Local dev server with hot-reload WASM on rebuild
- [ ] Integration test harness with mock host functions
- [ ] Template extensions beyond the init scaffold (formatter, linter, gateway proxy, language support)

---

## buster-collab-server

**Built:** WebSocket server (Bun.serve), operation log, broadcast to peers, fixed OT transform (all 4 op combinations), peer presence with cursor/selection, reconnection replay, snapshot mechanism. 18 tests.

**Remaining:**
- [ ] Vector clocks or Lamport timestamps for causal ordering (current timestamp field exists but is not used in transform logic)
- [ ] Auth layer with workspace-scoped tokens

---

## buster-dap

**Built:** Adapter registry (codelldb, debugpy, delve, js-debug), launch config with variable substitution, event channel (Mutex-wrapped, thread-safe), breakpoint persistence with JSON serialization, conditional breakpoints. 16 tests. Frontend Debug panel built.

**Remaining:**
- [ ] Watchpoints
- [ ] Process cleanup on IDE exit (kill zombie debug adapters)
- [ ] Fix the UB in buster's debugger/client.rs — the unsafe impl Send/Sync and raw pointer cast are still present (buster-dap provides the safe replacement but the old client.rs hasn't been fully replaced yet)

---

## buster-lsp-manager

**Built:** Incremental text sync (DocumentState with pending edits), server lifecycle with crash recovery, configurable registry (built once, O(1) lookup), stderr capture in background thread, request cancellation, URI encoding/decoding, UTF-16 offset mapping. 23 tests.

**Remaining:**
- [ ] workspace/symbol, callHierarchy, typeHierarchy, semanticTokens support (infrastructure exists but these LSP methods aren't wired)
- [ ] Progress reporting via window/workDoneProgress
- [ ] Actually replace buster's lsp/client.rs did_change() with incremental sync (currently namespaced but not swapped in)

---

## buster-syntax

**Built:** DocumentTree with persistent parse state, incremental edit interface (apply_edit + reparse), viewport-scoped highlighting, Arc-based grammar registry (no Box::leak), grammar hot-reload, Catppuccin Mocha theme mapping, fallback keyword highlighter. 12 tests.

**Remaining:**
- [ ] Wire actual tree-sitter Tree into DocumentTree (currently defines the interface with a fallback highlighter; real tree-sitter binding happens at integration)
- [ ] Replace buster's syntax/mod.rs full-reparse with incremental reparse calls
- [ ] Editor engine must emit edit ranges (shared prerequisite with LSP incremental sync)

---

## buster-remote

**Built:** Connection pool with multi-host support and reconnection, host config with auth method chaining (agent, key file, password), workspace file sync with mtime-based change detection. 11 tests.

**Remaining:**
- [ ] Async SSH client (replace sync Mutex + blocking I/O with tokio-based SSH)
- [ ] Remote LSP bridge (spawn LSP on remote, proxy requests over SSH)
- [ ] Remote terminal PTY allocation over SSH channel
- [ ] File change watching on remote (inotify over SSH or polling fallback)
- [ ] Host key verification implementation (known_hosts checking — config exists but no verification logic)

---

## buster-terminal-pro

**Built:** Runtime-switchable themes (Catppuccin Mocha + Solarized Dark), OSC 8 hyperlink parsing, CJK double-width character detection, Unicode combining character handling, bell notification modes, terminal search within scrollback, scrollback buffer with configurable limits and alt-screen isolation. 16 tests.

**Remaining:**
- [ ] PTY crash detection and graceful restart (error type exists but no recovery loop)
- [ ] Image protocol support (sixel or kitty — at least one)
- [ ] Wire theme switching into buster's terminal/mod.rs (currently hardcoded Catppuccin colors)

---

## buster-test-harness

**Built:** Filesystem fixture management (createWorkspace with seeded file trees), process runner (Bun.spawn, stdin/stdout/stderr, timeouts), IDE assertion helpers (file content, git status, performance timing). 20 tests.

**Remaining:**
- [ ] Headless Tauri test runner (launch the app, drive it programmatically)
- [ ] LSP integration tests (start real language server, verify completions/diagnostics)
- [ ] Extension lifecycle tests (install, load, call, unload, uninstall)
- [ ] Cross-platform CI matrix configuration
- [ ] Security boundary tests (verify sandbox blocks traversal, verify command restrictions)

---

## Integration leftovers (across all projects)

These are items where the library is built and imported but the old code hasn't been fully replaced yet:

- [ ] Replace buster's debugger/client.rs raw pointer + unsafe Send/Sync with buster-dap's Arc-based design
- [ ] Replace buster's lsp/client.rs full-document sync with buster-lsp-manager's incremental sync
- [ ] Replace buster's syntax/mod.rs Box::leak + full reparse with buster-syntax's Arc + incremental reparse
- [ ] Replace buster's terminal/mod.rs hardcoded colors with buster-terminal-pro's TerminalTheme
- [ ] Replace buster's remote/mod.rs single-session Mutex with buster-remote's ConnectionPool (fields added but not used for actual connections yet)
- [ ] Wire buster-sandbox into extensions/runtime.rs host_run_command (currently only wired into ai/tools.rs)
- [ ] Editor engine (engine.ts) must emit edit ranges for both incremental LSP sync and incremental syntax highlighting
- [ ] buster-path: replace remaining path.split("/").pop() calls in CanvasEditor.tsx (2 remaining), PanelRenderer.tsx, GitPanel.tsx, and other frontend files
