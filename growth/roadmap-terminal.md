# Terminal Roadmap

> Status: In Progress
> Last updated: 2026-04-28

The terminal is in solid shape — PTY management, crash recovery, 256/truecolor, mouse forwarding, scrollback, search, sixel images, and accessibility are all working. This roadmap covers maintenance items, missing standard features, and quality-of-life improvements.

---

## Phase 1: Maintenance & Bug Fixes

Addressing known limitations in the current implementation.

- [ ] **Strikethrough / faint text rendering** — the backend hardcodes these to `false` (vt100 crate v0.15 limitation); upgrade the vt100 crate or parse SGR 2/9 manually
- [x] **Cursor style support (DECSCUSR)** — parses cursor style escape sequences so shells/apps can request block, beam/bar, or underline cursors
- [x] **Double/triple-click word/line selection** — double-click selects a word, triple-click selects the full line
- [x] **Selection preservation on output** — copied text is snapshotted after selection so new output does not change what copy returns
- [ ] **WebGL rendering evaluation** — code exists but is disabled (`TERMINAL_WEBGL_ENABLED = false`); evaluate performance benefit, fix issues, or remove dead code
- [ ] **Resize edge cases** — verify resize behavior is smooth during rapid window resizing and when switching between split panel configurations
- [x] **Bell behavior configuration** — visual, audible, and off modes are configurable in Settings
- [x] **Sixel warning cleanup** — removed unused first-pass assignments in the sixel parser so terminal tests run without those warnings

---

## Phase 2: Standard Terminal Features

Features users expect from any modern integrated terminal.

- [ ] **Clickable URLs / hyperlinks** — plain `http://` and `https://` URLs are clickable; OSC 8 hyperlink sequences still pending
- [x] **Cursor blink** — terminal cursor now respects the existing cursor blink setting
- [ ] **Blinking text attribute** — render SGR 5/6 blink (can use a subtle animation or steady highlight)
- [ ] **Overline attribute** — render SGR 53 overline decoration
- [ ] **Custom underline colors** — support SGR 58/59 for colored underlines (currently uses foreground color)
- [ ] **Box drawing optimization** — render box drawing characters (U+2500-U+257F) with pixel-perfect lines instead of font glyphs for cleaner TUI rendering
- [x] **Smart word boundaries** — when double-click selecting, treat shell metacharacters (`;`, `|`, `&`, etc.) as word delimiters

---

## Phase 3: Shell Integration

Making the terminal aware of what's happening inside the shell.

- [ ] **Current working directory tracking** — detect CWD changes via OSC 7 or shell integration hooks, display in tab title or status bar
- [ ] **Prompt detection** — detect command prompts via OSC 133 (FinalTerm) or heuristics so the terminal knows where commands start/end
- [ ] **Command decoration** — visual markers between commands (separator lines, status badges for exit codes)
- [ ] **Run recent command** — quick-pick list of recently executed commands
- [ ] **Scroll to command** — navigate between command boundaries (Cmd+Up/Down to jump to previous/next prompt)
- [ ] **Command duration** — show how long each command took to execute

---

## Phase 4: Multi-Terminal & Layout

Expanding beyond one-terminal-per-tab.

- [ ] **Split terminal panes** — horizontal and vertical splits within a single terminal tab (not relying on the editor's panel system)
- [ ] **Terminal tab strip** — a lightweight tab bar within the terminal panel for switching between multiple shells without using editor tabs
- [ ] **Drag-and-drop terminal reordering** — rearrange terminal tabs/panes by dragging
- [ ] **Named terminals** — allow users to name terminal instances ("server", "build", "tests") for easy identification
- [ ] **Default shell configuration** — setting to override the auto-detected shell
- [ ] **Shell profiles** — save configurations (shell, CWD, env vars, name) and launch from a menu

---

## Phase 5: Quality of Life

Polish that makes daily terminal use more comfortable.

- [ ] **Font family selection** — allow users to choose a different font for the terminal (currently shares the editor's monospace font)
- [ ] **Font ligature support** — render programming ligatures in terminal output
- [ ] **Per-terminal theme override** — currently theme is global; allow individual terminals to have different color schemes
- [ ] **Scrollback search improvements** — add match count display ("3/17"), persistent search history, and incremental search-as-you-type highlighting
- [x] **Scrollback size configuration** — configurable from 1,000 to 100,000 rows in Settings
- [ ] **Copy with formatting** — option to copy terminal text with ANSI colors preserved (for pasting into documents or bug reports)
- [x] **Clear terminal** — Cmd+K clears local scrollback and sends clear-screen to the shell
- [ ] **Broadcast input** — type into multiple terminal instances simultaneously (useful for multi-server commands)
- [ ] **Terminal screenshot / export** — capture terminal contents as text or image

---

## Phase 6: Advanced Features

Longer-term improvements for power users.

- [ ] **Kitty image protocol** — support alongside sixel for broader image rendering compatibility
- [ ] **Synchronized updates (DCS 2026)** — buffer rendering during rapid output to prevent tearing
- [ ] **Focus event reporting (DECDAFM)** — send focus in/out sequences to the shell so apps like vim can detect terminal focus
- [ ] **Kitty keyboard protocol** — extended key reporting for apps that support it
- [ ] **Session recording & replay** — record terminal sessions for playback or sharing
- [ ] **Inline terminal in editor** — run a command inline within the editor (like VS Code's "Run in Terminal" for selections)
- [ ] **Terminal multiplexer awareness** — detect tmux/screen sessions and offer UI integration
