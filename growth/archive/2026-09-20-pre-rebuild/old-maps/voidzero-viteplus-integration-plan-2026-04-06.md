# VoidZero / Vite+ Integration Research for Buster IDE

**Date:** 2026-04-06

---

## What is VoidZero / Vite+?

VoidZero is Evan You's company building the next-generation JavaScript toolchain. Vite+ (`vp` CLI) is their unified tool that replaces Vite + ESLint + Prettier + Vitest + npm scripts with a single Rust-powered binary.

- **Repo**: github.com/voidzero-dev/vite-plus (3,987 stars)
- **Version**: v0.1.16 (Alpha, April 2026)
- **License**: MIT (underlying tools), source-available (Vite+ wrapper)

## The OXC Opportunity — This is the Big One

OXC (Oxidation Compiler) is VoidZero's collection of **Rust crates** that can be embedded directly in Buster's Tauri binary. No Node.js. No external processes. Native speed.

| Crate | What it does | What it gives Buster |
|-------|-------------|---------------------|
| `oxc_parser` | JS/TS/JSX/TSX parser | AST for completions, go-to-definition, symbol search |
| `oxc_semantic` | Scope/symbol/type analysis | Smart rename, find references, hover info |
| `oxc_linter` | 650+ lint rules, 50-100x faster than ESLint | Real-time diagnostics in the canvas editor |
| `oxc_formatter` | 30x faster than Prettier | Format-on-save without spawning processes |
| `oxc_resolver` | Module resolution | Click-to-navigate imports |
| `oxc_transformer` | TS/JSX transforms | Live preview, type stripping |
| `oxc_minifier` | JS minification | Bundle size analysis for user projects |

**This replaces the need for a traditional LSP for JS/TS files.** Tree-sitter stays for syntax highlighting (it's purpose-built for incremental parsing). OXC handles everything else — linting, formatting, semantic analysis — all in Rust, all inside the binary.

## Integration Priority

### 1. Immediate — Upgrade Vite 6 → Vite 8 (Rolldown)

- Swap `vite` version in `package.json` to Vite 8
- Rolldown (Rust bundler) replaces Rollup + esbuild
- 10-30x faster builds, dev/production parity
- `vite-plugin-solid` works unchanged
- **Effort**: 1 line change + test

### 2. Short-term — OXC Code Intelligence

Add to `Cargo.toml`:
```toml
[features]
code-intelligence = ["oxc"]

[dependencies]
oxc = { version = "*", optional = true, features = ["full"] }
```

New Tauri commands:
- `lint_file(path)` → returns diagnostics array
- `format_file(path)` → returns formatted text
- `get_symbols(path)` → returns symbol list for go-to-definition
- `get_completions(path, line, col)` → semantic completions (beyond current word-based)

**This gives Buster VS Code-level JS/TS intelligence with zero Node.js.**

### 3. Medium-term — AI Agent Integration

Architecture:
```
User prompt → Rust agentic loop → Claude/Ollama API (reqwest)
  → tool_use response → execute tool (read_file, write_file, terminal, search)
  → tool_result → send back → loop until done
  → stream tokens to frontend via Tauri events
```

Key facts:
- `reqwest` is already a Tauri transitive dependency — zero binary impact
- SSE streaming parsed in Rust, tokens emitted as Tauri events
- Buster's existing commands map directly to Claude tool definitions
- Local models via Ollama HTTP API on localhost:11434 — same reqwest code, different URL
- **Estimated binary impact**: ~0 KB (reqwest already present)

Minimal tool set for the agent:
- `read_file`, `write_file`, `list_directory` — already exist
- `run_terminal` — already exists via terminal_spawn + terminal_write
- `search_files` — already exists via buffer_find + list_workspace_files
- `get_diagnostics` — new, via OXC linter

### 4. Medium-term — Docker Integration

```toml
[features]
docker = ["bollard"]

[dependencies]
bollard = { version = "0.20", optional = true, default-features = false, features = ["pipe"] }
```

- `bollard` talks to user's existing Docker Desktop via Unix socket
- Parse `.devcontainer/devcontainer.json` for VS Code compatibility
- Route container terminal sessions through existing `TerminalManager` + `vt100`
- **Estimated binary impact**: ~200-400 KB (shares tokio/hyper with Tauri)

### 5. Long-term — WASM Extension System (Zed model)

- Extensions as WebAssembly modules via `wasmtime`
- Sandboxed execution, lazy activation
- Third parties can build: language support, themes, AI integrations, Docker tools
- Keeps core binary small — extensions load on demand
- **Estimated binary impact**: ~2-3 MB for wasmtime runtime

## Keeping It Lightweight

All new features use **Cargo feature flags**:

```toml
[features]
default = []                    # Base: 5.4 MB DMG
code-intelligence = ["oxc"]     # +OXC linting/formatting/semantics
ai = []                         # +AI agent loop (reqwest already present)
ai-local = ["ollama-rs"]        # +Local model support
docker = ["bollard"]            # +Docker container management
extensions = ["wasmtime"]       # +WASM extension runtime
```

Users who download base Buster get the same tiny binary. Power users compile with features enabled, or Buster ships tiered builds.

## What VoidZero Does NOT Help With

- **Terminal rendering** — Buster's vt100 + Canvas approach is already optimal
- **Text buffer** — TypeScript `string[]` engine (ropey was removed); OXC doesn't provide one
- **Canvas rendering** — Pretext + Canvas 2D is Buster's differentiator
- **Rust/Python/Go intelligence** — OXC is JS/TS only. Other languages need Tree-sitter + LSP
- **Git integration** — git2 crate (already added based on recent changes)

## Summary

VoidZero's tools turn Buster from "a fast editor" into "a fast IDE" without leaving Rust. The OXC crates are the highest-value integration — they give Buster native code intelligence that would otherwise require running `tsserver` (a 60MB+ Node.js process). Combined with AI agents via reqwest and Docker via bollard, Buster becomes a full development environment that still ships as a 5-8 MB binary.
