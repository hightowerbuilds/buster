# BUSTER IDE — Roadmap

**Created:** 2026-04-11
**Source:** Consolidated from canvas-first-app-review, core-loop-product-focus, and pre-launch-review research documents.

---

## Product Identity

Buster is a canvas-rendered coding workspace optimized for fast editing, terminal flow, and git operations. The core loop is:

**open project -> navigate fast -> edit fast -> run in terminal -> inspect git**

Everything in the roadmap serves that loop or the canvas-first architecture that makes it feel different.

---

## Completed (2026-04-11)

- [x] AI agent removed from core (shelved for future extension)
- [x] Dual state system unified — `app-state.ts` deleted, `useBuster()` is the single source of truth
- [x] Terminal theme follows app palette (dark/light/custom/imported)
- [x] Light theme redesigned (warm beige, not cold blue-gray)
- [x] Command palette wired to command registry (no more hardcoded duplicate command list)
- [x] Copy/paste fixed for Tauri dev window (native clipboard events)
- [x] AI blocklist/sandbox inconsistency resolved (AI removed; extensions use sandbox directly)
- [x] CJK text rendering — display-width-aware cursor, selection, wrapping, overlays
- [x] Static manual replaced with generated content from command registry
- [x] Canvas chrome — tab bar, dock bar, status bar, breadcrumbs, sidebar header all canvas-rendered
- [x] buster-syntax integrated — incremental tree-sitter with persistent DocumentTree, viewport-scoped highlighting, per-line span format
- [x] buster-lsp-manager integrated — crash recovery with auto-restart, proper URI percent-encoding

---

## Tier 1: Canvas-Native Shell

The editor and terminal already prove the thesis. The shell needs to catch up. The README says "every character on screen is drawn on Canvas" — make that true.

### ~~Move passive chrome to canvas rendering~~ (done 2026-04-11)

All 5 chrome elements migrated from DOM to canvas via a shared `CanvasChrome` foundation component (`src/ui/canvas-chrome.tsx`). Each strip is one `<canvas>` element with immediate-mode hit regions for interactivity.

1. **Tab bar** — `CanvasTabBar.tsx`: drag-and-drop reorder (DOM ghost), horizontal scroll, keyboard nav, per-type icon/color styling
2. **Dock bar** — `CanvasDockBar.tsx`: absorbs LayoutPicker, Git button + 6 layout preview thumbnails with static-noise hover effect
3. **Status bar** — `CanvasStatusBar.tsx`: clickable git branch/sync/diagnostics, LSP status, cursor position
4. **Breadcrumbs** — `CanvasBreadcrumbs.tsx`: path segments with separators, last-segment highlighting
5. **Sidebar header + actions** — `CanvasSidebarHeader.tsx`: workspace name, In/Out buttons, Open/New Folder/New File/Close Folder action buttons

### ~~Simplify panel layout to counts, not names~~ (already done)

Verified 2026-04-11: `PanelLayout.tsx` is already purely count-based. Named modes (`columns`, `trio`, `quint`, etc.) only exist in `panel-count.ts` as a legacy parse table for session backward compat. The layout tree, resize model, and demotion logic all operate on `PanelCount` (1-6). No work needed.

---

## Tier 2: Editor Core Performance

These are the technical debts that will bite under real-world use.

### ~~Fix CJK text rendering~~ (done 2026-04-11)

Added `isWideChar()`, `colToPixel()`, `pixelToCol()`, `stringDisplayWidth()` to text-measure.ts. Updated engine.ts (wrapping + mouse click mapping) and canvas-renderer.ts (~30 locations: cursor, selection, text segments, overlays, diagnostics, signature help, code actions) to use display-width-aware positioning instead of `col * charW`.

### ~~Integrate buster-syntax (incremental tree-sitter)~~ (done 2026-04-11)

`TreeSitterProvider` implements `ParseProvider` by wrapping existing tree-sitter-highlight, mapping `HIGHLIGHT_NAMES` indices to `TokenKind`. `SyntaxService` now manages persistent `DocumentTree` per open file via `open_document`/`close_document`/`edit_document`. New Tauri commands: `syntax_open`, `syntax_close`, `syntax_edit`. `highlight_code` now accepts viewport range and returns per-line `HighlightSpan{line, start_col, end_col, kind}`. Frontend `spansToLineTokens()` simplified — no more whole-file byte-offset-to-line conversion. Falls back to stateless parse if `syntax_open` wasn't called.

### ~~Integrate buster-lsp-manager (incremental sync)~~ (done 2026-04-11)

`DocumentState` was already integrated for incremental text sync. New this session: crash recovery in `ensure_server()` — detects crashed servers, auto-restarts up to 3 times, re-sends `didOpen` for all tracked documents. URI handling replaced with `path_to_lsp_uri()`/`lsp_uri_to_path()` for proper percent-encoding (fixes paths with spaces/special chars). `LspClient` gains `restart_count` field.

### Implement dirty-rect rendering

`renderEditor()` clears and redraws the entire viewport on every frame. Canvas lets you redraw only what changed. Implement dirty rectangles, incremental line updates, or cached glyph atlases.

### Turn on the GPU text renderer

`webgl-text.ts` exists but `useGPU` is never set to true. Evaluate and enable it. Monospace editors can skip the browser's text shaping pipeline entirely with pre-rasterized glyph atlases.

### Consider OffscreenCanvas for off-main-thread rendering

Move rendering to a Web Worker to keep the main thread free for input handling.

---

## Tier 3: Safety and Extensions

### Proper shell-word parsing for extension commands

Both the extension runtime and any future command execution parse commands with `split_whitespace()`. Quoted args like `git commit -m "fix bug"` break. Implement a proper shell-word parser (handle double quotes, single quotes, backslash escapes).

### Sandbox for local model execution

If local models return as an extension, they need the same `buster-sandbox` treatment: allowlist, workspace containment, OS sandbox. No `sh -c`, no blocklist.

### Integrate buster-dap (safe debugger)

The current DAP debugger has undefined behavior (raw pointer casting, unsafe Send/Sync). `buster-dap` fixes this with Arc-based threading, breakpoint persistence, and proper event channels. Integrate it when the debugger graduates from experimental.

---

## Tier 4: Product Polish

### Refactor App.tsx and PanelRenderer.tsx

Both files own too much UI policy. Move toward:
- A real panel registry model (panel metadata, activation, rendering separated)
- Reduced DOM query-based focus management

### Simplify settings controls

Settings checkboxes use a polling loop to redraw a tiny canvas control. Simplify until the main shell is stable.

### ~~Replace static manual with generated content~~ (done 2026-04-11)

ManualTab.tsx now derives keyboard shortcut tables from the command registry via `registry.getAllUnfiltered()`. Commands are grouped by category, tab-number shortcuts collapsed into one row, and stale content removed (AI Agent, Remote Dev). Editor built-in shortcuts (undo, copy/paste, cursor movement, etc.) kept as a small static table since they're handled by the editor keydown handler, not the registry.

### Rework the onboarding tour

The tour currently leads with architecture rationale (why Solid, why Tauri, why Canvas). Lead with the workflow instead:
1. Open a project
2. Jump anywhere with the palette
3. Edit instantly
4. Split panels when needed
5. Run in the terminal
6. Inspect and commit git changes

Architecture story comes later as supporting evidence.

### Add workflow-level tests

The app currently runs unit tests only. The missing test layer is workflow coverage:
- Switch tabs repeatedly
- Change panel counts and continue using hotkeys
- Close tabs and verify layout demotion
- Open pseudo-CLI and launch panels
- Verify focused tab and close behavior

---

## Features to Demote (not remove)

These stay in the app but stop being presented as equal pillars:

- **GitHub dashboard** — local git is core; GitHub browsing is adjacent
- **Extensions tab** — ecosystem strategy, not the product wedge yet
- **Debugger** — experimental until buster-dap is integrated
- **Manual tab** — support material, not a dock destination
- **Blog Mode** — personality, not the coding loop
- **Remote dev / Collaboration** — future growth, not proof the editor is best today

Move these behind the command palette or CLI switchboard. Don't put them in the main dock.

---

## Double Down On

- **Editor core** — local text engine, canvas rendering, no IPC per keystroke. This IS the product.
- **Terminal** — feels native to the thesis, not tacked on.
- **Canvas surface abstraction** — `DisplayListSurface` is the bridge to a full canvas shell.
- **Website parity** — the website is already more consistent with the canvas-first thesis than the app shell. Use it as the reference for how the shell should feel.
