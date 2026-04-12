# Buster Extension Developer Guide

Build WASM-sandboxed extensions for Buster IDE. This guide covers everything you need — paste it into an AI model to generate extensions, or follow it step by step.

---

## Quick Start

```bash
# 1. Create a Rust project
cargo init --lib my-extension
cd my-extension

# 2. Set crate type to cdylib (WASM library)
# Edit Cargo.toml — see below

# 3. Write your extension — see below

# 4. Build for WASM
cargo build --target wasm32-unknown-unknown --release

# 5. Install
mkdir -p ~/.buster/extensions/my-extension
cp target/wasm32-unknown-unknown/release/my_extension.wasm ~/.buster/extensions/my-extension/extension.wasm
cp extension.toml ~/.buster/extensions/my-extension/

# 6. Enable in Buster: Settings > Extensions > Enable
```

---

## Manifest (extension.toml)

Every extension needs an `extension.toml` in its directory:

```toml
[extension]
id = "my-extension"                    # Unique ID (kebab-case)
name = "My Extension"                  # Display name
version = "0.1.0"
description = "What it does"

[capabilities]
workspace_read = true                  # Read files in workspace
workspace_write = true                 # Write files in workspace
commands = true                        # Execute shell commands
notifications = true                   # Show toast notifications
network = false                        # Connect to external gateways
terminal = false                       # Terminal access

[[commands]]
id = "my-extension.do-thing"
label = "Do The Thing"

[[commands]]
id = "my-extension.another-command"
label = "Another Command"
```

Commands declared here auto-register in the Command Palette when the extension loads.

---

## Cargo.toml

```toml
[package]
name = "my-extension"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[profile.release]
opt-level = "s"
lto = true
strip = true
```

---

## Minimal Extension (src/lib.rs)

```rust
#![no_std]
extern crate alloc;
use alloc::vec::Vec;

// ── Host functions (provided by Buster) ──────────────────────

extern "C" {
    fn log(level: i32, ptr: *const u8, len: usize);
    fn notify(title_ptr: *const u8, title_len: usize, msg_ptr: *const u8, msg_len: usize);
    fn set_return(ptr: *const u8, len: usize);
    fn host_read_file(path_ptr: *const u8, path_len: usize) -> i32;
    fn host_write_file(path_ptr: *const u8, path_len: usize, content_ptr: *const u8, content_len: usize) -> i32;
    fn host_run_command(cmd_ptr: *const u8, cmd_len: usize) -> i32;
    fn host_list_directory(path_ptr: *const u8, path_len: usize) -> i32;
}

// ── Memory management (required exports) ─────────────────────

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    core::mem::forget(buf);
    ptr
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    unsafe { let _ = Vec::from_raw_parts(ptr, 0, len); }
}

// ── Lifecycle ────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn activate() -> i32 {
    log_info(b"Extension activated");
    0 // 0 = success
}

#[no_mangle]
pub extern "C" fn deactivate() {
    log_info(b"Extension deactivated");
}

// ── Your commands ────────────────────────────────────────────

/// Called when user runs "Do The Thing" from Command Palette.
/// Receives JSON params as UTF-8 bytes. Returns 0 on success.
#[no_mangle]
pub extern "C" fn do_thing(ptr: *const u8, len: usize) -> i32 {
    // Read the input (if any)
    let input = unsafe { core::slice::from_raw_parts(ptr, len) };
    let input_str = core::str::from_utf8(input).unwrap_or("");

    // Do your work here...
    let result = b"Done!";

    // Return data to the caller
    unsafe { set_return(result.as_ptr(), result.len()); }

    // Show a notification
    let title = b"My Extension";
    let msg = b"Thing was done successfully";
    unsafe { notify(title.as_ptr(), title.len(), msg.as_ptr(), msg.len()); }

    0
}

// ── Helpers ──────────────────────────────────────────────────

fn log_info(msg: &[u8]) {
    unsafe { log(1, msg.as_ptr(), msg.len()); }
}

// ── Required boilerplate ─────────────────────────────────────

use core::alloc::{GlobalAlloc, Layout};

struct WasmAllocator;
unsafe impl GlobalAlloc for WasmAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let total = layout.size() + layout.align();
        let mut buf: Vec<u8> = Vec::with_capacity(total);
        let raw = buf.as_mut_ptr();
        core::mem::forget(buf);
        let addr = raw as usize;
        ((addr + layout.align() - 1) & !(layout.align() - 1)) as *mut u8
    }
    unsafe fn dealloc(&self, _: *mut u8, _: Layout) {}
}

#[global_allocator]
static ALLOC: WasmAllocator = WasmAllocator;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
```

---

## Host Functions Reference

These are the functions Buster provides to your extension. Declare them as `extern "C"` imports.

### Always available

| Function | Signature | Description |
|----------|-----------|-------------|
| `log` | `(level: i32, ptr: *const u8, len: usize)` | Log a message. Levels: 0=debug, 1=info, 2=warn, 3=error |
| `set_return` | `(ptr: *const u8, len: usize)` | Set return data for the current call |

### Requires `notifications = true`

| Function | Signature | Description |
|----------|-----------|-------------|
| `notify` | `(title_ptr, title_len, msg_ptr, msg_len)` | Show a toast notification |

### Requires `workspace_read = true`

| Function | Signature | Returns | Description |
|----------|-----------|---------|-------------|
| `host_read_file` | `(path_ptr, path_len) -> i32` | 0=ok, -1=denied | Reads file, content available via return buffer |
| `host_list_directory` | `(path_ptr, path_len) -> i32` | 0=ok, -1=denied | Lists dir as JSON array in return buffer |

### Requires `workspace_write = true`

| Function | Signature | Returns | Description |
|----------|-----------|---------|-------------|
| `host_write_file` | `(path_ptr, path_len, content_ptr, content_len) -> i32` | 0=ok, -1=denied | Write content to file |

### Requires `commands = true`

| Function | Signature | Returns | Description |
|----------|-----------|---------|-------------|
| `host_run_command` | `(cmd_ptr, cmd_len) -> i32` | 0=ok, 1=fail, -1=blocked | Run shell command, result in return buffer as JSON |

Command results are JSON: `{"status": 0, "stdout": "...", "stderr": "..."}`

All paths are validated against the workspace root. Paths outside the workspace are rejected.

---

## Reading the Return Buffer

Host functions that return data use the `set_return` mechanism. After calling a host function, read the return buffer:

```rust
static mut RETURN_BUF: Vec<u8> = Vec::new();

#[no_mangle]
pub extern "C" fn set_return(ptr: *const u8, len: usize) {
    unsafe {
        RETURN_BUF = Vec::from_raw_parts(ptr as *mut u8, len, len);
    }
}

fn read_file(path: &str) -> Option<Vec<u8>> {
    let code = unsafe { host_read_file(path.as_ptr(), path.len()) };
    if code != 0 { return None; }
    Some(unsafe { RETURN_BUF.clone() })
}

fn run_cmd(cmd: &str) -> (i32, Vec<u8>) {
    let code = unsafe { host_run_command(cmd.as_ptr(), cmd.len()) };
    (code, unsafe { RETURN_BUF.clone() })
}
```

---

## Capabilities

Extensions run in a WASM sandbox. They can only do what their declared capabilities allow:

| Capability | What it enables |
|-----------|----------------|
| `workspace_read` | Read files and list directories in the workspace |
| `workspace_write` | Create and modify files in the workspace |
| `commands` | Execute shell commands (validated against safety blocklist) |
| `notifications` | Show toast notifications to the user |
| `network` | Connect to external services via WebSocket or HTTP SSE |
| `terminal` | Access terminal (reserved for future use) |

If you call a host function without the required capability, it returns `-1` and does nothing.

---

## Gateway Connections (network capability)

Extensions can connect to external AI agents or services:

```toml
[capabilities]
network = true
```

From the frontend (TypeScript), connect your extension to a gateway:

```typescript
const connId = await connectGateway("my-extension", {
  protocol: "websocket",    // or "http-sse"
  url: "ws://agent.local:8000/stream",
  auth_token: "bearer-token",
});

onGatewayEvent("my-extension", (event) => {
  // event.kind: "connected" | "text" | "tool_call" | "tool_result" | "done" | "error" | "disconnected"
  // event.content: string
  // event.tool_name: string | null
});

await sendToGateway(connId, JSON.stringify({ query: "hello" }));
await disconnectGateway(connId);
```

The gateway system auto-detects multiple agent protocols (ZeroClaw, OpenAI-compatible SSE, ACP, plain text).

---

## Command Palette Integration

Commands declared in `extension.toml` automatically appear in the Command Palette (Cmd+Shift+P > type command name).

Each command maps to a WASM export with the same ID (dots replaced with underscores):

```toml
[[commands]]
id = "my-ext.format-file"
label = "Format Current File"
```

Buster calls the exported function `format_file` (or the exact ID) when the user selects the command.

---

## Directory Structure

```
~/.buster/extensions/
  my-extension/
    extension.toml          # Manifest (required)
    extension.wasm          # Compiled WASM binary
  another-extension/
    extension.toml
    extension.wasm
  state.json                # Tracks which extensions are enabled
```

---

## Security Model

- Extensions run in Wasmtime with epoch-based interruption (5-second timeout)
- All file paths are canonicalized and checked against the workspace root
- Shell commands pass through the same safety blocklist as the AI agent (blocks rm -rf, sudo, credential access, etc.)
- No filesystem access outside the declared workspace
- Memory is freed when the WASM instance drops
- Each capability must be explicitly declared and is visible to the user in the Extensions panel

---

## Example: File Formatter Extension

```rust
#[no_mangle]
pub extern "C" fn format_file(ptr: *const u8, len: usize) -> i32 {
    let path = unsafe {
        let slice = core::slice::from_raw_parts(ptr, len);
        core::str::from_utf8(slice).unwrap_or("")
    };

    let ext = path.rsplit('.').next().unwrap_or("");
    let cmd = match ext {
        "rs" => alloc::format!("rustfmt {}", path),
        "js" | "ts" | "jsx" | "tsx" => alloc::format!("prettier --write {}", path),
        "py" => alloc::format!("black {}", path),
        "go" => alloc::format!("gofmt -w {}", path),
        _ => {
            let msg = b"No formatter for this file type";
            unsafe { notify(b"Format".as_ptr(), 6, msg.as_ptr(), msg.len()); }
            return -1;
        }
    };

    let code = unsafe { host_run_command(cmd.as_ptr(), cmd.len()) };
    if code == 0 {
        let msg = b"File formatted";
        unsafe { notify(b"Format".as_ptr(), 6, msg.as_ptr(), msg.len()); }
    }
    code
}
```

---

## Tips

- Keep WASM binaries small — use `opt-level = "s"`, `lto = true`, `strip = true`
- Use `#![no_std]` to avoid pulling in the Rust standard library (saves ~1MB)
- The `alloc` crate gives you `Vec`, `String`, `format!` without std
- Test locally with `cargo build --target wasm32-unknown-unknown --release` before installing
- Check `~/.buster/extensions/` to verify your files are in the right place
- Use the Extensions panel in Buster to enable/disable without restarting
