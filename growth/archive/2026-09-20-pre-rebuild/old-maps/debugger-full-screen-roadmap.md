# Full-Screen Debugger Roadmap

**Created:** 2026-04-12
**Status:** Planning

---

## Vision

The debugger should feel like entering a different place in the app — not a side panel, but a full-screen modal environment that takes over when you're debugging. Think of it as "debug mode" vs "edit mode." When you launch a debug session, the entire screen transforms into a purpose-built debugging workspace rendered on canvas.

---

## Current State

**What exists today:**
- `DebugPanel.tsx` — DOM-based side panel with launch config, controls, stack trace, variables
- `src-tauri/src/debugger/` — `DebugManager` + `DapClient` (DAP protocol over stdio)
- `buster-dap` crate — safe adapter registry, breakpoint persistence, event channels (Arc-based, no unsafe)
- Supported adapters: CodeLLDB (Rust/C/C++), debugpy (Python), Delve (Go), js-debug (JS/TS)
- State polling every 500ms (no event-driven updates yet)

**What's wrong:**
- The panel is a small side tab competing for space with the editor
- DOM-rendered, not canvas — breaks the "every pixel is canvas" thesis
- Polling instead of event forwarding
- No source view integration (can't see code at breakpoint)
- No breakpoint gutter integration in the editor
- No watch expressions, no conditional breakpoint UI, no memory view

---

## Architecture: Full-Screen Debug Modal

### The Modal

When a debug session starts (or the user enters debug mode), a full-screen overlay appears over the editor workspace. It's a canvas-rendered environment with its own layout:

```
+------------------------------------------------------------------+
|  DEBUG MODE                                    [Minimize] [Stop]  |
+------------------------------------------------------------------+
|                    |                           |                   |
|   SOURCE VIEW     |    VARIABLES / WATCH      |   CALL STACK     |
|                    |                           |                   |
|   (canvas editor   |    Locals                |   main()          |
|    read-only, with |      x = 42              |   > handle_req()  |
|    breakpoint      |      name = "hello"      |     parse()       |
|    highlights and  |      items = [...]        |                   |
|    current-line    |                           |                   |
|    indicator)      |    Watch                  |                   |
|                    |      + Add expression     |                   |
|                    |                           |                   |
+--------------------+---------------------------+-------------------+
|                          CONTROLS + OUTPUT                        |
|  [Continue] [Step Over] [Step Into] [Step Out]  | Debug console   |
+------------------------------------------------------------------+
```

### Key Design Decisions

1. **Canvas-rendered** — entire debug modal is canvas, including the source view, variable tree, stack frames. Uses the same `CanvasChrome` hit-region pattern as tab bar and dock bar.

2. **Source view reuses the editor engine** — the left pane is a read-only `CanvasEditor` instance pointed at the current file/line. Breakpoint indicators rendered as gutter decorations. Current paused line highlighted with accent color.

3. **Minimize, don't close** — "Minimize" button shrinks debug mode back to the dock bar (small indicator showing debug state). The session keeps running. User can flip between edit mode and debug mode without stopping the session.

4. **Keyboard-first** — F5 (continue), F10 (step over), F11 (step into), Shift+F11 (step out), Shift+F5 (stop). These work globally when a debug session is active, even in edit mode.

---

## Implementation Tiers

### Tier 1: Event-Driven Debug State

Replace 500ms polling with proper event forwarding from `buster-dap`.

- Wire `EventChannel` from `buster-dap` to Tauri events (`app.emit("debug-event", ...)`)
- Frontend listens via `listen("debug-event", ...)` instead of polling
- Events: `Stopped` (hit breakpoint), `Continued`, `Exited`, `Output` (debug console)
- Remove `setInterval` polling from DebugPanel

### Tier 2: Full-Screen Modal Shell

Build the modal container and basic layout.

- New component: `DebugMode.tsx` — full-screen overlay, canvas-rendered
- Three-pane layout: source (left), variables (center-right), stack (right)
- Bottom bar: controls + debug console output
- Minimize/Stop buttons in header
- Entry: launch from command palette or existing debug panel
- Exit: Stop ends session and returns to editor, Minimize hides modal

### Tier 3: Source View Integration

Connect the editor engine to the debug source view.

- Read-only `CanvasEditor` instance in the left pane
- On `Stopped` event: open the file at the paused line, scroll to it
- Breakpoint gutter decorations (red dots in line number gutter)
- Current-line highlight (accent-colored full-width band)
- Click gutter to toggle breakpoints (calls `debug_set_breakpoints`)

### Tier 4: Variable Explorer

Canvas-rendered tree view for locals, globals, and watch expressions.

- Expandable tree: objects/structs expand to show fields
- Type annotations in muted text
- Value changes highlighted (flash when a value changes between steps)
- Watch expressions: user-added expressions evaluated in current frame
- Hover over variable in source view → tooltip with current value

### Tier 5: Editor Gutter Integration

Breakpoints visible in the main editor (not just debug mode).

- Red dot in gutter for active breakpoints
- Gray dot for unverified breakpoints
- Click gutter to toggle breakpoints (works outside debug mode)
- Breakpoints persisted via `buster-dap::BreakpointStore` (survives restarts)
- Conditional breakpoints: right-click gutter → input condition expression

### Tier 6: Debug Console

Canvas-rendered output pane for debug adapter messages.

- `Output` events from DAP displayed in scrollable canvas view
- User can type expressions to evaluate in current frame
- REPL-style interaction during paused state

---

## Integration with buster-dap

The `buster-dap` crate already provides the safe foundations:

| buster-dap Feature | Debug Mode Usage |
|---|---|
| `AdapterRegistry` | Auto-detect adapter from file type (`.rs` → codelldb, `.py` → debugpy) |
| `BreakpointStore` | Persist breakpoints across sessions and restarts |
| `EventChannel` | Drive the entire UI reactively (no polling) |
| `DebugEvent` | Map to specific UI updates (Stopped → jump to source, Output → console) |

The current `DapClient` in `debugger/client.rs` handles the DAP wire protocol. `buster-dap` wraps it with safe concurrency (Arc-based, no raw pointers).

---

## What NOT to Build

- **Multi-session debugging** — one session at a time is fine for v1
- **Remote debugging** — local only (remote dev is shelved)
- **Memory/hex view** — not needed for most languages
- **Profiler integration** — separate concern, separate feature
- **Custom debug adapter installation** — users install adapters themselves via their package manager
