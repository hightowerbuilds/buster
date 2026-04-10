export const FEATURES = [
  {
    name: "Canvas-Rendered Editor",
    desc: "Every character is drawn on canvas. No DOM text nodes. TypeScript string[] buffer backed by SolidJS signals. Syntax highlighting via Tree-sitter for 100+ languages. Code folding, find/replace with regex, minimap, multi-cursor editing, word wrap, virtual scrolling, and AI ghost text completions. Files over 50 MB are streamed on demand.",
  },
  {
    name: "Full Terminal Emulator",
    desc: "A real PTY-backed terminal rendered on canvas. VT100/ANSI parsing in Rust with sixel image support. Supports NeoVim, htop, tmux -- anything that runs in a terminal. Mouse reporting, bracketed paste, scrollback history, configurable themes. Each terminal opens as a tab alongside your files.",
  },
  {
    name: "AI Agent",
    desc: "Chat with Claude (Sonnet 4.6, Opus 4.6, Haiku 4.5), Ollama (local), Codex (OpenAI), or Gemini (Google). The agent can read files, write code, search the codebase, and run shell commands. State-changing tools require your approval before executing. Configurable rate limits for tool calls, writes, and commands. API keys stored securely in OS keychain.",
  },
  {
    name: "Git & GitHub",
    desc: "30 built-in git commands. Status, staging, commit, push, pull, fetch, branches, stash, remote management, blame overlay, diff gutter indicators, conflict resolution, and a canvas-rendered commit graph. Browse GitHub PRs and issues directly in the editor via the gh CLI. No terminal required.",
  },
  {
    name: "Language Server Protocol",
    desc: "LSP support for Rust (rust-analyzer), TypeScript/JavaScript (typescript-language-server), Python (pyright), and Go (gopls). Autocomplete, hover, signature help, code actions, inlay hints, go-to-definition, document symbols, rename refactoring, find all references, and a diagnostics panel with automatic crash recovery.",
  },
  {
    name: "Debugger",
    desc: "DAP-based debugging. Set breakpoints (with conditions), launch programs, step over/into/out, pause, and inspect stack frames and variables. Works with any Debug Adapter Protocol server.",
  },
  {
    name: "Quick Open & Command Palette",
    desc: 'Cmd+P opens fuzzy file search across your workspace. Prefix modes: > commands, : go-to-line, @ document symbols, # workspace content search, ? AI chat.',
  },
  {
    name: "Session Persistence",
    desc: "Auto-saves every 30 seconds. Hot-exit on window close. Restores your workspace, tabs, cursor positions, and unsaved buffers when you relaunch. Pick up exactly where you left off.",
  },
  {
    name: "WASM Extensions",
    desc: "Sandboxed extension runtime powered by Wasmtime. Capability-based permissions. Extensions can read/write files, run commands, show notifications, render custom UI surfaces, and connect to external services via WebSocket or HTTP SSE gateways.",
  },
  {
    name: "Panel Layouts",
    desc: "Seven layout modes: Tabs, Columns, Grid, Trio, Quint, Rerack, and HQ (3x2 grid). Draggable dividers between panels. Pop out the sidebar into a tab. Resize everything.",
  },
  {
    name: "11 MB Installer",
    desc: "Built on Tauri v2. Native performance without Electron overhead. The entire app ships as an 11 MB installer. Rust backend, SolidJS frontend, no bundle bloat.",
  },
];

export const TECH_STACK = [
  ["Desktop shell", "Tauri v2"],
  ["Backend", "Rust"],
  ["Frontend", "SolidJS"],
  ["Text buffer", "TypeScript string[] + SolidJS signals"],
  ["Syntax highlighting", "Tree-sitter (Rust)"],
  ["Text measurement", "Pretext"],
  ["Terminal", "portable-pty + vt100 crate"],
  ["AI models", "Claude API + Ollama + Codex + Gemini"],
  ["Extensions", "Wasmtime (WASM sandbox)"],
  ["Theme", "Catppuccin Mocha"],
  ["UI font", "Courier New"],
  ["Editor font", "JetBrains Mono"],
];

export const SHORTCUTS = [
  ["Cmd+S", "Save"],
  ["Cmd+Z / Cmd+Shift+Z", "Undo / Redo"],
  ["Cmd+F", "Find & Replace"],
  ["Cmd+P", "Quick Open"],
  ["Cmd+Shift+P", "Show All Commands"],
  ["Cmd+T", "New Terminal"],
  ["Cmd+L", "AI Agent"],
  ["Cmd+Shift+G", "Git Panel"],
  ["Cmd+B", "Toggle Sidebar"],
  ["Cmd+W", "Close Tab"],
  ["Cmd+,", "Settings"],
  ["F8", "Next Problem"],
];

export const HOST_API = [
  { sig: "activate() -> i32", desc: "Called when the extension is loaded. Return 0 for success, non-zero for error." },
  { sig: "deactivate()", desc: "Called when the extension is unloaded. Clean up resources here." },
  { sig: "host_read_file(path_ptr, path_len) -> i32", desc: "Read a file from the workspace. Requires workspace_read capability. The path is read from WASM linear memory at the given pointer and length. Returns 0 on success (-1 on error). File content is placed in the return buffer." },
  { sig: "host_write_file(path_ptr, path_len, content_ptr, content_len) -> i32", desc: "Write content to a file in the workspace. Requires workspace_write capability. Returns 0 on success, -1 on error or permission denied." },
  { sig: "host_list_directory(path_ptr, path_len) -> i32", desc: 'List entries in a directory. Requires workspace_read capability. Returns 0 on success. Result is a JSON array in the return buffer: [{"name": "file.rs", "is_dir": false}, ...]' },
  { sig: "host_run_command(cmd_ptr, cmd_len) -> i32", desc: 'Execute a shell command in the workspace. Requires commands capability. Returns 0 on success, 1 on non-zero exit, -1 on permission denied. Result JSON in return buffer: {"status": 0, "stdout": "...", "stderr": "..."}' },
  { sig: "notify(title_ptr, title_len, msg_ptr, msg_len) -> i32", desc: "Show a toast notification to the user. Requires notifications capability. Returns 0 on success." },
  { sig: "log(level, ptr, len)", desc: "Log a message. Always available (no capability required). Levels: 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR." },
];

export const TOML_CODE = `[extension]
id = "my-extension"
name = "My Extension"
version = "0.1.0"
description = "What this extension does"

[capabilities]
workspace_read = true       # Read files in workspace
workspace_write = true      # Write files in workspace
commands = true             # Run shell commands
notifications = true        # Show toast notifications
network = false             # WebSocket/SSE connections
terminal = false            # Terminal access`;

export const JSON_CODE = `{
  "protocol": "websocket",
  "url": "ws://localhost:8080/stream",
  "auth_token": "your-token",
  "headers": {
    "X-Custom-Header": "value"
  }
}`;

export const GATEWAY_PROTOCOLS = [
  ['ZeroClaw (Buster-native)', '{"type": "chunk", "data": "..."}'],
  ['OpenAI-compatible', '{"choices": [{"delta": {"content": "..."}}]}'],
  ['Agent Communication Protocol', '{"status": "completed"}'],
];

export const CAPABILITIES_TABLE = [
  ["workspace_read", "Read files and list directories"],
  ["workspace_write", "Create, modify, and delete files"],
  ["commands", "Run shell commands (blocklist enforced)"],
  ["notifications", "Show toast notifications"],
  ["network", "WebSocket and HTTP SSE connections"],
  ["terminal", "Access the terminal"],
];
