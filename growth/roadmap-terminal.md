# Terminal Roadmap

> Status: In Progress
> Last updated: 2026-04-24

The terminal is in solid shape — PTY management, crash recovery, 256/truecolor, mouse forwarding, scrollback, search, sixel images, and accessibility are all working. This roadmap covers maintenance items, missing standard features, and quality-of-life improvements.

---

## Phase 1: Maintenance & Bug Fixes

Addressing known limitations in the current implementation.

- [ ] **Strikethrough / faint text rendering** — the backend hardcodes these to `false` (vt100 crate v0.15 limitation); upgrade the vt100 crate or parse SGR 2/9 manually
- [ ] **Cursor style support (DECSCUSR)** — parse cursor style escape sequences so shells/apps can request block, beam, or underline cursors; currently always renders block
- [ ] **Double/triple-click word/line selection** — double-click should select a word, triple-click should select the full line; currently only single-click drag selection works
- [ ] **Selection preservation on output** — selection currently clears when new terminal output arrives; preserve selection until user explicitly clears it
- [ ] **WebGL rendering evaluation** — code exists but is disabled (`TERMINAL_WEBGL_ENABLED = false`); evaluate performance benefit, fix issues, or remove dead code
- [ ] **Resize edge cases** — verify resize behavior is smooth during rapid window resizing and when switching between split panel configurations
- [ ] **Bell behavior configuration** — currently visual-only (flash); add option for audible bell, or disable bell entirely

---

## Phase 2: Standard Terminal Features

Features users expect from any modern integrated terminal.

- [ ] **Clickable URLs / hyperlinks** — detect URLs in terminal output and make them clickable to open in browser; also support OSC 8 hyperlink sequences
- [ ] **Cursor blink** — add a blinking cursor option (currently always solid block)
- [ ] **Blinking text attribute** — render SGR 5/6 blink (can use a subtle animation or steady highlight)
- [ ] **Overline attribute** — render SGR 53 overline decoration
- [ ] **Custom underline colors** — support SGR 58/59 for colored underlines (currently uses foreground color)
- [ ] **Box drawing optimization** — render box drawing characters (U+2500-U+257F) with pixel-perfect lines instead of font glyphs for cleaner TUI rendering
- [ ] **Smart word boundaries** — when double-click selecting, treat shell metacharacters (`;`, `|`, `&`, etc.) as word delimiters

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
- [ ] **Scrollback size configuration** — currently fixed at 10,000 rows; make it a user setting
- [ ] **Copy with formatting** — option to copy terminal text with ANSI colors preserved (for pasting into documents or bug reports)
- [ ] **Clear terminal** — Cmd+K to clear scrollback and reset the screen
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
