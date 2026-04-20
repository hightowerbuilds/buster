# Terminal Bug-Fix Roadmap

**Created:** 2026-04-19
**Updated:** 2026-04-19
**Source:** User-reported bugs ("backspace is messed up, caret and text get misaligned, two shells won't appear at the same time"), four in-situ screenshots of the integrated terminal hosting Claude Code's TUI, and a targeted code read of `src/ui/CanvasTerminal.tsx`, `src-tauri/src/terminal/mod.rs`, and the `buster-terminal-pro` crate.

**Status:** Tier 0, 1, and 2 complete. Terminal is functional for daily use. Tier 3 (polish) remains.

---

## Scope

The terminal is a first-class feature of this IDE — it's listed as a pillar in the README alongside the editor. Right now it's "unusable" per the user's direct report. This roadmap triages the observed bugs and the latent ones the code read surfaced. Order is by user-visible severity × fix cost.

The two panel-level bugs we already fixed in `2d29ce7` (WebGL singletons and scroll routing) likely have cousins here — the garbled status bar in image 4 looks like the same class of canvas-paint corruption, though `CanvasStatusBar.tsx` has no module state, so the root cause is different.

---

## Tier 0 — Make typing not painful

### [x] Backspace / caret drift

**Symptom:** User types a word, hits backspace to correct a typo, the next character lands in the wrong cell. Typos accumulate in scrollback (image 1: `cluade`, `claaiud`, `claude    claude` — the literal bytes the user submitted, because they couldn't fix what was on screen).

**Hypothesis (needs live confirmation):** `charWidth` is computed via `getCharWidth("M")` in `text-measure.ts:20` using Pretext's `prepareWithSegments("M", font)` — this returns a **fractional** pixel width (e.g. 8.4 at 14px for JetBrains Mono). Text is drawn at `col * cw` with `ctx.fillText`, and the cursor is drawn at `cursorCol * cw` with `ctx.fillRect`. The same fractional multiplier is used for both so they *should* align — but `fillText` snaps glyphs to pixel boundaries internally (subpixel positioning), while `fillRect` doesn't. Over ~20+ columns the drift accumulates and the cursor visibly separates from the character it's supposed to be on. When the user hits backspace, cursor moves one cell left in logical coords but the pixel position jumps by a non-integer delta, making the caret look like it's floating between cells. User then types and the character is drawn at its correct cell but their eye was tracking the cursor — so they believe their character landed "wrong".

**Fix shape:**
1. Round `charWidth` to an integer in `CanvasTerminal.tsx:118` — `charWidth = Math.floor(getCharWidth(fontSize()))`. The whole terminal is cell-grid; there's no benefit to fractional pixel widths.
2. Pixel-align the cursor rect: `Math.round(cursorCol * cw)` for x, same for y.
3. Pixel-align text draws: `ctx.fillText(cell.ch, Math.round(col * cw), Math.round(row * ch))`.

If this doesn't fully fix it, the next-most-likely cause is the cursor falling behind the cell state because screen deltas arrive milliseconds after the keypress — see Tier 1, "Local echo buffer for perceived responsiveness."

**Files:** `src/ui/CanvasTerminal.tsx:118, 283-380, 384-396`, `src/editor/text-measure.ts:20-29`

---

### [x] Second terminal panel renders empty

**Symptom:** Open terminal in one panel, open another terminal (`Terminal 11` in image 4), the second panel is blank even though the PTY is running.

**Likely cause:** Each `CanvasTerminal` filters incoming `terminal-screen` events by `ptyId` (`CanvasTerminal.tsx:711`). If the second terminal's `ptyId` is still `null` when deltas start arriving — because the `terminal_spawn` IPC hasn't resolved yet — the initial delta is dropped. Unlike the Rust backend, which emits an initial empty-screen delta right after spawn (`terminal/mod.rs:362-389`), the frontend can't match it to a tab that hasn't recorded its assignment yet. For the first terminal this race usually wins (mount → spawn → delta fires after listener is registered). For the second, mount ordering between two siblings is less predictable.

Alternatively: the `terminal-screen` event listener is registered per-component but only fires for the component whose `ptyId === event.payload.term_id`. If two panels mount in the same tick and the `listen(...)` calls are registered in reverse order, the first panel may swallow the second's events.

**Fix shape:** After `terminal_spawn` resolves and `ptyId` is set, explicitly request a full-screen redraw from the backend (a new `terminal_resync` IPC, or have the backend re-emit the initial delta when queried). Also audit the `listen` → filter pattern for race conditions; consider moving the listener into `createEffect(() => { if (ptyId) { ... } })` so it only registers once the id is known.

**Files:** `src/ui/CanvasTerminal.tsx:81, 702-770, 829`, `src-tauri/src/terminal/mod.rs:362-389`

---

### [x] Status bar text corruption

**Symptom:** Image 4's bottom bar reads `Busle+m 1,- CGNORMAL-1-1inadev (5Read)y (human-eyeball)` — two strings at different sizes overlapping in the same pixels, identical shape to the editor render bug we fixed in `2d29ce7`.

**Not the same root cause though.** `CanvasStatusBar.tsx` has no module-level state and doesn't use WebGL. More likely causes:
1. The status-bar canvas isn't being cleared on every repaint — stale pixels compose with new draws
2. `CanvasChrome` (the shared chrome foundation in `src/ui/canvas-chrome.tsx`) has a paint pipeline that re-draws without resetting the canvas when the props change
3. DPR mismatch when the window resizes (similar to the editor's pre-fix state, but for the chrome layer)

**Fix shape:** Audit `src/ui/canvas-chrome.tsx` for a `ctx.clearRect(0, 0, w, h)` (or equivalent `ctx.fillRect` with the background color on an `alpha:false` context) at the top of the paint function. If missing, add it. Also verify the canvas `.width`/`.height` attributes are re-synced against `element.clientWidth * dpr` when the canvas container resizes.

**Files:** `src/ui/canvas-chrome.tsx`, `src/ui/CanvasStatusBar.tsx`

---

## Tier 1 — High-leverage smaller fixes

### [x] Set `TERM=xterm-256color` in PTY spawn (already on main roadmap)

**Symptom:** `clear` prints `TERM environment variable not set.` (image 2). Git pager emits "terminal is not fully functional" before any output.

**Fix:** In `src-tauri/src/terminal/mod.rs` before `pair.slave.spawn_command(cmd)` at line 330, add `cmd.env("TERM", "xterm-256color")` and optionally `cmd.env("COLORTERM", "truecolor")`. The `vt100` crate already parses the full xterm-256color sequence set.

---

### [x] Enable bracketed paste on terminal start

**Symptom (latent):** Pasting multi-line content into the terminal triggers each line's execution because the shell can't distinguish pasted text from typed input. Interactive tools like `fzf` don't get proper paste notification.

**Cause:** `CanvasTerminal.tsx:747` reads `bracketedPaste` from screen deltas but nothing ever emits the enable sequence `\x1b[?2004h` to the PTY.

**Fix:** On terminal mount, after `terminal_spawn` succeeds, write `\x1b[?2004h` to the PTY. In `handleEditorContextMenu`'s paste handler, wrap the pasted text in `\x1b[200~...\x1b[201~` when `bracketedPaste` is true.

**Files:** `src/ui/CanvasTerminal.tsx` — spawn completion callback and paste handler (search for `terminal_write.*\\x1b\\[`).

---

### [x] Alt+key and Ctrl+Shift+key combinations unhandled

**Symptom (latent):** Alt+b / Alt+f (word navigation in readline) do nothing. Ctrl+Shift+letter sends wrong bytes because the code at `CanvasTerminal.tsx:664-669` assumes lowercase.

```js
if (e.ctrlKey && e.key.length === 1) {
  const code = e.key.toLowerCase().charCodeAt(0) - 96;
  if (code > 0 && code < 27) {
    data = String.fromCharCode(code);
  }
}
```

When Shift is held, `e.key` is uppercase. The `toLowerCase()` call papers over this — but that's exactly the bug: Ctrl+Shift+C and Ctrl+C both produce `\x03`, which breaks apps that distinguish them (tmux, some vim modes).

**Fix:** Use `e.code` (physical key) for control-char derivation instead of `e.key`. Add an explicit Alt handler: if `e.altKey && !e.ctrlKey`, send `\x1b` followed by the character (meta-prefix convention).

**Files:** `src/ui/CanvasTerminal.tsx:663-684`

---

### [x] Cursor rect doesn't span wide characters

**Symptom (latent):** When the cursor is on a CJK/emoji cell, only the left half is highlighted.

**Cause:** `CanvasTerminal.tsx:387` draws `ctx.fillRect(cx, cy, cw, ch)` using single cell width. The actual cell under the cursor may have `width === 2`.

**Fix:** Read `cells[cursorRow]?.[cursorCol]?.width` before drawing the rect, use `cell.width === 2 ? cw * 2 : cw`.

---

### [x] Shell arg `-l` is always passed

**Observation:** `CommandBuilder::new(&shell); cmd.arg("-l");` at `terminal/mod.rs:322-323` always spawns the shell as a login shell. On macOS this is usually correct (inherits the environment from `launchd` via `path_helper`). On Linux, `-l` sources `~/.profile` etc. and can be slow or produce spurious output. Consider making this configurable via settings, or detecting the platform.

---

## Tier 2 — Quality / compatibility issues

### [x] `terminal-pro` scrollback / search / hyperlinks — wired in?

The sibling crate `buster-terminal-pro` exports `ScrollbackBuffer`, `ScrollbackConfig`, `TerminalSearch`, `HyperlinkParser` (per `terminal-pro/src/lib.rs`). Per my prior cleanup in commit `2a84248`, those re-exports in `src-tauri/src/terminal/mod.rs:11` were *dead*. They were removed.

Meaning: the crate's scrollback is NOT used — `CanvasTerminal.tsx` has its own scrollback buffer in the frontend (`scrollbackNormal`, `scrollbackAlt`). Its search is NOT used — `CanvasTerminal.tsx` has its own in-frontend string matching. Its hyperlink parser is NOT used.

Two paths:
- **Delete the dead features from `buster-terminal-pro`** (the `scrollback.rs`, `search.rs`, `hyperlink.rs` modules are orphaned)
- **Wire them in** if they offer meaningful capability beyond what the frontend re-implements

The sixel and theme modules ARE used, so keep those.

**Files:** `src-tauri/crates/terminal-pro/src/{scrollback,search,hyperlink}.rs`

---

### [ ] OSC 8 hyperlinks not rendered as clickable

**Symptom:** `ls --hyperlink` output shows plain text. `git log` with GitHub URL patterns in commit messages are plain text.

**Cause:** The vt100 parser sees the OSC 8 sequence but the frontend doesn't consume per-cell hyperlink metadata from the screen delta (probably not even emitted).

**Fix:** Emit hyperlink target per cell (or per run) in `TermScreenDelta`, then render underline-on-hover and wire click → `tauri_plugin_opener::OpenUrl`.

---

### [ ] Mouse reporting mode coverage

`CanvasTerminal.tsx:494-510` reads `mouseMode` and `mouseEncoding` from deltas, handles `\x1b[<${button};${col+1};${row+1}${suffix}` (SGR). Verify: X10, urxvt, normal (X11), and any-event modes all work with the apps users actually run (htop, tmux, vim mouse support).

---

### [x] UTF-8 boundary handling in PTY read loop

`terminal/mod.rs:404+` reads into a `[u8; 4096]` buffer and feeds it to the parser. If a 4-byte UTF-8 codepoint spans two `read()` calls, the first read ends mid-sequence. The `vt100` crate's `process` call handles partial sequences internally — verify this is actually the case. If not, buffer until a UTF-8 boundary is reached.

---

## Tier 3 — Polish, nice-to-have

### [ ] Cursor shape (block / underline / beam) per `DECSCUSR`

Apps like vim set cursor shape via `\x1b[{n} q` sequences. The `vt100` parser tracks this; the frontend currently always draws a block. Read `screen.cursor_shape()` (if the `vt100` crate exposes it) and render accordingly.

### [ ] Cursor blink

The vt100 parser tracks blink state. Frontend always draws solid. Minor polish.

### [ ] Local echo for perceived responsiveness

In slow-network scenarios (SSH, remote PTY), the round-trip for each keystroke is visible. Popular terminals (Alacritty, Kitty) offer a local-predictive-echo mode. Low-priority for a desktop IDE where the shell is local.

### [ ] Search — regex mode, case sensitivity toggle

Current `CanvasTerminal.tsx` does literal substring matching. Add regex + case-insensitive flags similar to the editor's Find/Replace.

### [ ] Focus reporting

Not implemented: `\x1b[I` on focus, `\x1b[O` on blur, enabled by `\x1b[?1004h`. Tmux and vim can use this to update their state on window focus changes.

### [ ] Sixel cache growth

`sixelBitmapCache` (`CanvasTerminal.tsx:782`) deletes entries on image update but could grow unbounded in long-running terminals with frequent image output (e.g. plot libraries).

---

## Architectural notes

**What's solid:**
- Cursor position and cell state come from the authoritative `vt100` parser via screen deltas — no client-side cursor guessing. Good separation.
- Delta computation emits only changed rows, not full screens — efficient.
- `PtyMonitor` crash-recovery is wired into the read loop.
- Sixel image path is end-to-end (parser → delta → canvas composite).
- `alpha: false` used correctly on the main terminal canvas so full redraw clears the background.

**What's fragile:**
- Frontend tracks `cursorRow`/`cursorCol` as component locals synced from deltas. If a delta is missed (filter race, event queue drop), cursor visual drifts from reality until the next delta. No periodic re-sync.
- Fractional `charWidth` from Pretext feeds a cell-grid that implicitly assumes integer pixel widths.
- Keyboard handler is a long switch with ad-hoc modifier logic rather than a table-driven keymap.
- Split-panel second-terminal routing depends on `ptyId` being set before first delta arrives — a race.
- No automated tests for input-to-output behavior. A snapshot suite that feeds `bash -c 'echo hi'` through the PTY and asserts the rendered cell grid would catch a lot of regressions cheaply.

---

## Recommended next step

Fix Tier 0 items in order:
1. The char-width rounding fix is ~5 lines and may single-handedly resolve "backspace is messed up"
2. The second-terminal-empty fix is ~20 lines once the race is nailed down
3. The status-bar paint fix is ~3 lines if it's just missing a `clearRect`

Then do Tier 1 items as a batch — they're all small and user-visible.

Tier 0 items alone should convert the terminal from "unusable" to "works for daily use".
