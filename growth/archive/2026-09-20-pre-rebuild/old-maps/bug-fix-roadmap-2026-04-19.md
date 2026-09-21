# Post-Cleanup Functionality Review — Bug Fix Roadmap

**Created:** 2026-04-19
**Source:** Hands-on walkthrough of the running `dev` binary after the two dead-code cleanup commits (`82aa4b7`, `2a84248`). All findings reproduced on branch `dev` against macOS 25.4.0.

---

## Scope

This is a focused defect list, not a feature roadmap. Every entry below was observed firsthand in the running app; each has a reproduction path, an impact assessment, and a concrete pointer to the likely code site so the fix can start from a real line rather than a guess.

Order is by expected ROI (how much pain per minute of fix time), not by severity alone.

---

## Tier 1 — High ROI, small patches

### [x] Set `TERM` env var in PTY spawn (fixed prior session)

**Impact:** Every `git log`, `git diff`, `git show`, `less`, `man`, `htop` session in the integrated terminal currently hits `WARNING: terminal is not fully functional` before outputting anything. Users work around it with `--no-pager` flags or by reading the warning and pressing RETURN. It's a constant papercut.

**Cause:** The Rust PTY spawn doesn't pass a `TERM` environment variable, so the child shell inherits an empty one. Pagers that probe `$TERM` fall back to the "dumb" path.

**Fix:** In `src-tauri/src/terminal/mod.rs` inside `TerminalManager::spawn`, set `cmd.env("TERM", "xterm-256color")` (and optionally `COLORTERM=truecolor`) before `pair.slave.spawn_command(cmd)`. The `vt100` crate already parses the full xterm-256color sequence set, so this just tells child programs to emit sequences the terminal already understands.

**Test:** Open terminal, run `git log --oneline -10`. No pager warning. Colors in output visible.

---

### [x] Fix Zoom In / Zoom Out shortcut labels (fixed 2026-04-22)

**Impact:** Cosmetic, but it's visible every time the palette opens. Both Zoom entries currently display `⌘-` in the shortcut column. Zoom In should show `⌘+` or `⌘=`.

**Cause:** Likely a copy-paste in the command registration in `src/lib/app-commands.ts` (the `editor.zoomIn` / `editor.zoomOut` entries). Either both commands got the same `hotkey` string, or the label formatter is normalizing `=` to `-`.

**Fix:** Grep for `Zoom In` in `src/lib/app-commands.ts`, verify the `hotkey` field differs between the two commands, and check `buildHotkeyDefinitions` for a normalization step that might collapse them.

**Test:** Open palette, visually confirm the two rows show different shortcuts.

---

### [x] Escape dismisses palette even when query is non-empty (fixed prior session)

**Impact:** UX papercut. After typing into the command palette or quick-open, Escape clears the input but doesn't close the overlay — users have to press Escape a second time or click outside. Most palette implementations dismiss on Escape regardless of input state.

**Cause:** The Escape handler in `src/ui/CommandPalette.tsx` (or `CommandLineSwitchboard.tsx`) likely has a two-step behavior: clear-if-has-text, then close-if-empty. Either the clear-first branch is always taken, or the second Escape event isn't reaching the handler.

**Fix:** In the palette's Escape hotkey handler, skip the clear-input branch entirely and go straight to `onClose()`. If someone needs to clear the query without closing, they can use Backspace.

**Test:** Open palette (`Cmd+Shift+P`), type `zoom`, press Escape once. Palette should close.

---

## Tier 2 — Medium effort, real correctness bugs

### [x] ~~Canvas render corruption when switching panel layouts~~ (fixed 2026-04-19)

Root cause was different from the initial guess. Not `clearRect`, not DPR — the real culprit was `webgl-text.ts` holding its renderer, canvas, atlas, and font tracking as **module-level singletons**. A second `CanvasEditor` mount clobbered those globals and re-parented the GL canvas into the new editor's container, while editor #1 was still alive and still scheduling paints that queued glyphs into editor #2's atlas. Two overlapping font sizes in one panel was exactly what that looked like.

Fix: replaced the module singletons with a `WebGLTextContext` class. Each `CanvasEditor` owns its own instance (`WebGLTextContext.tryCreate` in onMount, `.dispose()` in onCleanup). The renderer takes `gpu: WebGLTextContext | null` via `EditorRenderParams` and sets it into a render-scoped module var for `monoText` and co. to read — safe because `renderEditor` is synchronous.

### [x] ~~Scroll routes to wrong panel~~ (fixed 2026-04-19)

Root cause: the wheel handler was per-panel and hit-tested by cursor position, so scrolling over an inactive panel mutated that panel's `scrollTop` signal — but `doRender` early-exits when `props.active === false`, so the visible canvas never moved. From the user's POV, scroll landed in the "wrong" panel silently.

Fix: each `CanvasEditor` registers its `applyScroll` function with a module-level `activeScrollTarget` slot whenever `props.active` becomes true. The wheel handler now dispatches `e.deltaY` through that slot — so scrolling anywhere in the editor area always scrolls the click-focused panel. Inactive panels never receive scroll state mutations, so the paint-skip optimization remains sound.

### [x] Commit Graph missing newest commit (fixed 2026-04-22)

**Impact:** Data correctness. The Status tab correctly reports `Push 2↑` (I had two local commits ahead of origin), but the Commit Graph tab only renders 1 of the 2. Users who rely on the graph to review recent history will see incomplete state — especially bad right after committing.

**Repro:** Make a commit in the terminal, switch to Git → Commit Graph. HEAD commit is missing.

**Cause:** Suspect the Rust `git_log_graph` command in `src-tauri/src/commands/git.rs` — either:
1. An off-by-one in the range/limit (e.g. passing `HEAD^..` instead of `HEAD..`)
2. Caching in `GitGraph.tsx` keyed by branch name so new commits don't invalidate
3. The query is run once on tab mount and Refresh (in Status tab) doesn't re-trigger the graph query

**Fix:** First confirm which layer has the bug by adding a log/print in the Rust handler showing what commit list it returns. If Rust returns correct data, fix the frontend cache. If Rust returns incomplete data, fix the git-log invocation.

**Test:** Commit a change, open Commit Graph, confirm HEAD commit is at top.

---

### [x] ~~Canvas render corruption when switching panel layouts~~ (duplicate of fixed entry above)

**Impact:** Visual, recoverable, but jarring. Observed repro: open ≥2 editor tabs, change panel layout (e.g. single → 2-col → quad), switch which tab is in which panel. The canvas drew two offset copies of the same file stacked — different font sizes, partially overlapping. Only cleared by closing all editor tabs with `Cmd+W`.

**Cause:** Most likely one of:
1. Missing `ctx.clearRect(0, 0, w, h)` at the start of a paint pass, so a prior frame's pixels remain when the viewport resizes.
2. Stale DPR (device-pixel-ratio) value captured on mount — when the panel's pixel dimensions change, the canvas `.width`/`.height` attributes aren't re-synced with the new CSS size, causing the canvas to scale up its old contents.
3. Two editor instances rendering into the same canvas element because a keyed `<For>` lost its key on layout change.

**Fix:** Start by logging from the canvas renderer entry point on every paint — confirm that (a) the canvas size attributes match the CSS size, and (b) clearRect is called. Suspect files: `src/editor/canvas-renderer.ts` (paint pipeline), `src/ui/PanelLayout.tsx` and `src/ui/PanelRenderer.tsx` (layout resize handling), `src/editor/CanvasEditor.tsx` (onMount/onResize).

**Test:** Open 3 files, cycle through all 6 layouts with tab switches in between, watch for double-draw.

---

### [x] Settings panel doesn't mouse-wheel scroll in nested layouts (fixed 2026-04-22)

**Impact:** Settings has content below the viewport (keybindings section, theme import, etc.) that's unreachable when Settings is rendered in a split panel rather than as a full-viewport tab. Mouse wheel over the panel scrolled the neighboring editor instead.

**Cause:** Probably hit-testing: the scroll event handler is attached to an inner div that doesn't receive the wheel event because an outer stop-propagation eats it, or the panel's overflow is `visible` instead of `auto`.

**Fix:** Inspect `src/ui/SettingsPanel.tsx` for the outer scroll container's CSS. Check `src/styles/settings.css` for `overflow` rules. The panel should have `overflow-y: auto` on its outermost scrollable element and not rely on the parent panel to scroll.

**Test:** Open Settings in a quad layout, scroll over it, confirm the settings content scrolls (not the neighboring panel).

---

## Tier 3 — Rough edges, polish

### [x] Navigation keys (End/Home/PageUp/PageDown) in palette input type instead of navigate (fixed 2026-04-22)

**Observation:** While the palette is open, pressing `End` typed `]` into the search input. Expected: move selection to last entry. Pressing `PageDown` also didn't navigate.

**Fix:** The palette's keydown handler should intercept Home/End/PageUp/PageDown before the input component sees them, and translate them into list navigation. Arrow keys already work this way — extend the same pattern.

**Suspect file:** `src/ui/CommandPalette.tsx` key handler.

---

### [x] Default window size too small (fixed 2026-04-22)

**Observation:** App launches at ~550×360px — usable only after clicking the green maximize. The welcome canvas's "canvas-rendered ide" subtitle and recent-folders row are pushed below the fold at that size.

**Fix:** In `src-tauri/tauri.conf.json`, set a larger `width`/`height` default on the main window (e.g. 1400×900), or set `minWidth`/`minHeight` to reasonable minimums.

---

### [x] Welcome canvas layout at fullscreen drops subtitle/recent-folders below the fold (fixed 2026-04-22)

**Observation:** At fullscreen (1500+ px wide), the "Buster" particle logo centers in the top half and the subtitle + recent-folders row appear far below — spatially disconnected from the logo. At smaller sizes they cluster together correctly.

**Fix:** Either center the whole block vertically as a unit, or cap the logo's max size so it doesn't push the subtitle off-screen on large displays. See `src/ui/WelcomeCanvas.tsx`.

---

### [x] PageDown/Cmd+G in editor didn't scroll (fixed 2026-04-22)

**Observation:** Key capture on the canvas editor is finicky — PageDown was a no-op until I mouse-wheel-scrolled first. Cmd+G (Go to Line per the README) didn't show a dialog.

**Cause:** Probably focus-related: the canvas's hidden textarea isn't always focused after a click, so keydown events don't reach the engine. Or the hotkey is registered but its `target` binding doesn't include the canvas.

**Fix:** Audit focus handling in `src/editor/CanvasEditor.tsx` — on every click, ensure the textarea inside the canvas container receives focus. Verify `createHotkeys` in `App.tsx` binds to `ideRootRef` and that the ref is set before commands register.

---

### [ ] Auto-populate of 2nd panel on tab open is surprising

**Observation:** With the default layout being 2-column, opening a second file automatically put it in the right panel — no visible affordance that the user is about to "split" into two editors. Some users will expect tabs to stack in the active panel and manually move one to the other.

**Fix (soft):** Either make 1-column the default layout, or add a subtle visual hint when a new tab is about to land in an empty panel. This is more product-decision than bug.

---

## Out of scope (deferred)

Observations that surfaced during the walkthrough but don't belong on this roadmap:

- `package-lock.json` is out of sync with `package.json` after the `@tanstack/ai*` removals. Pre-existing state — the project uses `bun.lock` as the source of truth. Fix by running `npm install` and committing if the drift ever matters for CI.
- Two remaining Rust warnings in `crates/terminal-pro/src/sixel.rs` (value-assigned-never-read at lines 73, 77). Inside a sibling crate, benign, minor.
- The broad `#[allow(dead_code)]` annotations on the `extensions/{manifest,gateway,runtime,surface}` modules and the `LspManager`/`LspClient` impls almost certainly hide more dead helper methods. A future pass should remove those allows and let the compiler list specifics.

---

## How to use this document

Work tier-by-tier. Each Tier 1 item is a small patch landable in one focused commit. Tier 2 items need more investigation before the fix shape is clear. Tier 3 is polish — pick these up when the above are handled or when a Tier 1/2 fix naturally touches the same file.
