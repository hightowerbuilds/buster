# Lua Vim Keymap — Implementation Roadmap

**Created:** 2026-04-13
**Goal:** Vim-inspired modal editing configured via Lua scripts. Draw from Vim's strengths in a simplistic manner, using Lua as an easy object-oriented scripting language for keymap customization.

---

## Architecture

```
~/.buster/keymap.lua  -->  Rust (mlua, one-shot eval)  -->  JSON keymap  -->  vim-mode.ts (all local)
```

Lua is the **authoring format**, not a runtime. Evaluated once at startup, produces a JSON keymap table. The frontend uses the table at zero-IPC-per-keystroke cost. No Lua runtime persists after loading.

---

## Modes

| Mode | Cursor Shape | Behavior |
|------|-------------|----------|
| **Normal** | Block (full char width) | Keys are commands. hjkl movement, operators, mode switching |
| **Insert** | Line (2px, current style) | All existing editing unchanged. Escape returns to Normal |
| **Visual** | Block | Motions extend selection. d/y/c act on selection |
| **Command** | N/A | `:` opens command palette, `/` opens find bar |

---

## MVP Vim Commands (~40 bindings)

### Normal Mode

**Motion:**
| Key | Action | Engine Method |
|-----|--------|--------------|
| `h` | Left | `moveCursor("left")` |
| `l` | Right | `moveCursor("right")` |
| `j` | Down | `moveCursor("down")` |
| `k` | Up | `moveCursor("up")` |
| `w` | Word forward | `moveWord("right")` |
| `b` | Word backward | `moveWord("left")` |
| `e` | Word end | `moveToWordEnd()` (new) |
| `0` | Line start | `moveCursorToLineStart()` |
| `$` | Line end | `moveCursorToLineEnd()` |
| `^` | First non-blank | `moveCursorToFirstNonBlank()` (new) |
| `gg` | Document start | `setCursor({line: 0, col: 0})` |
| `G` | Document end | `setCursor({line: last, col: 0})` |
| `{count}G` | Go to line N | `setCursor({line: N-1, col: 0})` |

**Editing:**
| Key | Action |
|-----|--------|
| `x` | Delete char under cursor |
| `dd` | Delete line(s) |
| `yy` | Yank line(s) |
| `p` / `P` | Paste after / before |
| `u` | Undo |
| `Ctrl+R` | Redo |
| `.` | Repeat last edit |
| `J` | Join lines |
| `~` | Toggle case |
| `>>` / `<<` | Indent / outdent |

**Operators (pending motion):**
| Key | Meaning |
|-----|---------|
| `d{motion}` | Delete (e.g., `dw`, `d$`, `d0`) |
| `c{motion}` | Change (delete + Insert mode) |
| `y{motion}` | Yank |

**Mode Switching:**
| Key | Enter Mode |
|-----|------------|
| `i` | Insert before cursor |
| `a` | Insert after cursor |
| `o` / `O` | Open line below / above |
| `I` | Insert at first non-blank |
| `A` | Insert at line end |
| `v` / `V` | Visual / Visual Line |
| `:` | Command (palette) |
| `/` | Search (find bar) |

**Counts:** `5j` moves down 5, `3dd` deletes 3 lines, `2w` moves 2 words.

**Search:** `/` opens find, `n`/`N` next/prev, `*` word under cursor.

### Insert Mode

Only `Escape` and `Ctrl+[` to exit. Everything else passes through to existing handlers (autocomplete, bracket-close, etc.).

### Visual Mode

All Normal motions extend selection. `d`/`y`/`c` act on selection. `>`/`<` indent/outdent. `Escape` clears and returns to Normal.

### Command Mode (Minimal)

| Command | Action |
|---------|--------|
| `:w` | Save |
| `:q` | Close tab |
| `:wq` | Save + close |
| `:{n}` | Go to line |

Routes through existing command palette / find infrastructure.

---

## Lua Keymap Format

```lua
-- ~/.buster/keymap.lua
local keymap = {
  normal = {
    ["h"] = "cursor.left",
    ["l"] = "cursor.right",
    ["j"] = "cursor.down",
    ["k"] = "cursor.up",
    ["w"] = "cursor.word_right",
    ["b"] = "cursor.word_left",
    ["e"] = "cursor.word_end",
    ["0"] = "cursor.line_start",
    ["$"] = "cursor.line_end",
    ["^"] = "cursor.first_non_blank",
    ["gg"] = "cursor.document_start",
    ["G"] = "cursor.document_end",

    ["i"] = "mode.insert",
    ["a"] = "mode.insert_after",
    ["o"] = "mode.open_below",
    ["O"] = "mode.open_above",
    ["I"] = "mode.insert_line_start",
    ["A"] = "mode.insert_line_end",
    ["v"] = "mode.visual",
    ["V"] = "mode.visual_line",
    [":"] = "mode.command",
    ["/"] = "editor.find",

    ["x"] = "edit.delete_char",
    ["dd"] = "edit.delete_line",
    ["yy"] = "edit.yank_line",
    ["p"] = "edit.paste_after",
    ["P"] = "edit.paste_before",
    ["u"] = "edit.undo",
    ["<C-r>"] = "edit.redo",
    ["."] = "edit.repeat",
    ["J"] = "edit.join_lines",
    [">>"] = "edit.indent",
    ["<<"] = "edit.outdent",
    ["~"] = "edit.toggle_case",
    ["n"] = "search.next",
    ["N"] = "search.prev",
    ["*"] = "search.word_under_cursor",

    -- Operators (trigger pending-operator state)
    ["d"] = "op.delete",
    ["c"] = "op.change",
    ["y"] = "op.yank",
  },

  insert = {
    ["<Esc>"] = "mode.normal",
    ["<C-[>"] = "mode.normal",
  },

  visual = {
    ["<Esc>"] = "mode.normal",
    ["d"] = "visual.delete",
    ["y"] = "visual.yank",
    ["c"] = "visual.change",
    [">"] = "visual.indent",
    ["<"] = "visual.outdent",
  },

  passthrough = { "<Mod>+" },

  options = {
    timeout = 1000,
  },
}

return keymap
```

---

## Implementation Phases

### Phase 1: Settings + Lua Runtime (~1.5 hours)

| Step | File | What |
|------|------|------|
| 1.1 | `Cargo.toml` | Add `mlua = { version = "0.10", features = ["lua54", "serialize"] }` |
| 1.2 | `defaults/keymap.lua` (new) | Default Vim keymap (bundled via `include_str!`) |
| 1.3 | `commands/keymap.rs` (new) | `evaluate_keymap` Tauri command: read `~/.buster/keymap.lua`, fallback to default, eval with mlua, serialize to JSON |
| 1.4 | `commands/mod.rs` + `lib.rs` | Register module and command |
| 1.5 | `settings.rs` | Add `vim_mode: bool` to `AppSettings` |
| 1.6 | `ipc.ts` | Add `evaluateKeymap()` + `vim_mode` to `AppSettings` TS interface |
| 1.7 | `store-types.ts` | Add `vimMode: VimMode \| null` to store |

### Phase 2: Vim Key Interpreter (~3-4 hours, critical path)

| Step | File | What |
|------|------|------|
| 2.1 | `vim-mode.ts` (new, ~400 lines) | Mode state (SolidJS signals), key normalizer, multi-key sequence resolver with timeout, count buffer, operator-pending state, command dispatch table, yank register, repeat recording |

**Key interpreter logic:**
- Normalize KeyboardEvent → canonical string (`h`, `<Esc>`, `<C-r>`)
- Check passthrough patterns (Cmd+ shortcuts → return false)
- In Insert mode: only handle Escape/Ctrl+[ → return false for all else
- In Normal/Visual: buffer keys, resolve sequences, dispatch commands
- Count prefix: accumulate digits, consume with next command
- Operator pending: `d`/`c`/`y` wait for motion, execute motion with selection, apply operator

### Phase 3: Editor Integration (~2 hours)

| Step | File | What |
|------|------|------|
| 3.1 | `CanvasEditor.tsx` | Wire Vim handler into `handleKeyDown` (first check), guard `handleInput` in Normal mode, thread `cursorStyle`, add `onVimModeChange` prop |
| 3.2 | `canvas-renderer.ts` | Block cursor in `drawCursors`: `cursorStyle: "line" \| "block"`, block = `fillRect(x, y, charW, lineHeight)` with inverse char |
| 3.3 | `CanvasStatusBar.tsx` | Mode badge: `-- NORMAL --` / `-- INSERT --` / `-- VISUAL --` |
| 3.4 | `App.tsx` | Pass `vimMode` to status bar, wire mode change from active editor |

### Phase 4: Engine Extensions (~1.5 hours)

| Step | File | What |
|------|------|------|
| 4.1 | `engine.ts` | `moveCursorToFirstNonBlank()` — skip leading whitespace |
| 4.2 | `engine.ts` | `moveToWordEnd()` — forward to end of word |
| 4.3 | `engine.ts` | `deleteLine(count)` — delete N lines from cursor |
| 4.4 | `engine.ts` | `yankLine(count)` — return N lines as text |
| 4.5 | `engine.ts` | `openLineBelow()` / `openLineAbove()` — insert newline + position cursor |
| 4.6 | `engine.ts` | `joinLines()` — merge current + next line |
| 4.7 | `engine.ts` | `replaceChar(char)` — for `r` command |

### Phase 5: Polish (~30 min)

| Step | File | What |
|------|------|------|
| 5.1 | `SettingsPanel.tsx` | Vim Mode toggle in settings UI |
| 5.2 | `app-commands.ts` | `editor.toggleVimMode` command for Cmd+Shift+P |

---

## Key Design Decisions

1. **No IPC per keystroke** — Lua evaluated once, JSON cached in frontend
2. **Insert mode = existing editor** — only Escape is intercepted; autocomplete, brackets, all current behavior preserved
3. **Mod+ always passes through** — Cmd+S, Cmd+P, Cmd+W never captured by Vim handler
4. **Per-editor mode state** — each tab has its own mode, switching tabs preserves mode
5. **Operator-pending via selection** — `d{motion}` executes motion with `extend: true`, then deletes selection. Reuses existing selection infrastructure
6. **Yank register + clipboard sync** — internal register tracks linewise flag, syncs to system clipboard

---

## Risk Areas

| Area | Risk | Mitigation |
|------|------|-----------|
| Multi-key timeout | `d` is operator AND prefix of `dd` | Timer-based disambiguation (1000ms configurable) |
| Hidden textarea in Normal mode | Keypresses still fire `onInput` | Guard `handleInput` to suppress when mode !== "insert", clear textarea value |
| Escape conflicts | Dismisses overlays AND exits Insert | Priority: dismiss UI first, then mode switch (matches Vim) |
| mlua dependency | Adds ~2MB to binary | Acceptable for Lua scripting capability |
| Repeat (`.`) | Must record full edit sequences | Start simple: record last single command, expand later |

---

## Success Criteria

A user should be able to:
1. Enable Vim mode in settings
2. See block cursor in Normal mode, `-- NORMAL --` in status bar
3. Navigate with hjkl, w/b, 0/$, gg/G
4. Delete with x, dd, dw, d$
5. Enter Insert with i/a/o, type normally, Escape back
6. Visual select with v, yank with y, paste with p
7. Use counts: 5j, 3dd, 2w
8. Undo/redo with u/Ctrl+R
9. Search with /, navigate with n/N
10. Customize any binding by editing `~/.buster/keymap.lua`
