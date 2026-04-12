# Buster Mobile — A Phone and Tablet IDE

Research document for bringing Buster to iOS and Android as a native app via Tauri v2.

---

## Part 1: What Is a Mobile IDE Actually For?

Before writing any code, this question needs an honest answer. The history of mobile IDEs is a graveyard of desktop ports that nobody uses. The apps that survived — Working Copy, GitHub Mobile, Replit Mobile — succeeded because they understood what people actually do with code on a phone.

### What people do with code on their phone

1. **Read code.** You're on the bus, reviewing a PR. You're in a meeting, checking how a function works. You're at dinner and someone asks about a bug and you want to look at the file. Reading is the dominant activity.

2. **Check status.** Is the branch ahead or behind? What files changed? Did the CI pass? What's the git log look like? Status checking is fast, glanceable, and frequent.

3. **Make small fixes.** A typo in a string. A wrong config value. A missing comma. You're not writing a feature — you're applying a patch. The edit is 1-5 lines, you know exactly where it is, and you want to commit and push immediately.

4. **Ask questions about code.** "What does this function do?" "Where is this type defined?" "Why is this test failing?" AI assistants are uniquely well-suited to mobile because the interaction model — type a question, read an answer — already fits a phone screen.

5. **Manage git.** Commit, push, pull, switch branches, stash, resolve a simple merge conflict. Git operations are button presses and short text inputs. They translate perfectly to touch.

6. **Review diffs.** Side-by-side diffs don't fit on a phone, but unified diffs do. Viewing what changed, line by line, is a natural phone activity — it's basically reading a document.

### What people do NOT do with code on their phone

1. **Write a feature from scratch.** A virtual keyboard, no matter how good, is not a programming keyboard. You don't have Tab, you don't have brackets without mode-switching, you don't have Ctrl. Writing 50+ lines of new code on a phone is a hostile experience.

2. **Refactor across files.** You can't see two files simultaneously. You can't hold context for a multi-file rename in a 6-inch viewport. The working memory required for refactoring exceeds what the screen can support.

3. **Run and debug.** iOS and Android don't have shells. There's no `cargo test`, no `npm run dev`, no breakpoint debugger. The terminal — Buster's second-most-used feature — is physically impossible on mobile.

4. **Use keyboard shortcuts.** The entire keyboard binding system (70+ shortcuts) is irrelevant on a touchscreen. Every interaction needs a touch-native equivalent or it doesn't exist.

5. **Hover.** There is no hover on a touchscreen. Tooltips, hover documentation, signature help on mouse-over — these interaction patterns have no mobile equivalent. Long-press is not hover; it's too slow and deliberate.

### The honest conclusion

A mobile IDE is not an IDE. It's a **code companion** — a tool for reading, reviewing, quick-fixing, and managing the lifecycle of code you wrote on a real computer. The moment you accept this, the design becomes clear. The moment you fight it and try to shrink the desktop experience, you build something nobody wants to use.

The question is not "how do we fit the editor on a phone?" The question is: **what workflows matter when you're away from your desk, and how do we make those workflows feel native to a touchscreen?**

---

## Part 2: What Buster's Architecture Means for Mobile

### What works in our favor

**Tauri v2 supports iOS and Android.** The mobile entry point attribute (`#[cfg_attr(mobile, tauri::mobile_entry_point)]`) is already in `lib.rs`. Running `tauri ios init` and `tauri android init` generates the platform scaffolding. The Rust backend compiles for ARM targets. The SolidJS frontend runs in the platform's native WebView (WKWebView on iOS, Android WebView on Android). We're not starting from zero.

**Canvas rendering is platform-agnostic.** The entire rendering pipeline — syntax highlighting, diff gutters, line numbers, cursor drawing — runs on `<canvas>`, which works identically in mobile WebViews. The DPR-aware scaling in `canvas-renderer.ts` already handles high-density displays (iPhone is 3x, most Androids are 2.5-3x). The canvas doesn't care whether it's 1200px wide or 390px wide.

**PointerEvent is already the input model.** The codebase uses `PointerEvent` rather than separate mouse/touch handlers. PointerEvent fires for finger touches automatically. The drag system in `drag.ts`, the sidebar tree interactions, the sidebar resize handle — these all work with touch input out of the box, assuming touch targets are large enough.

**SolidJS is lightweight.** The 7KB runtime and fine-grained reactivity model are well-suited to mobile's tighter memory and CPU constraints. There's no virtual DOM diffing overhead.

**The Rust backend is the right language for mobile.** Rust compiles to efficient ARM binaries. The file operations, syntax highlighting (tree-sitter), and search functionality run natively with no performance penalty on mobile hardware.

### What works against us

**The terminal is impossible.** `portable-pty` spawns pseudo-terminal processes. iOS and Android don't expose a PTY interface or a shell. There is no `bash`, no `zsh`, no process spawning in the traditional sense. The terminal feature — including the entire `CanvasTerminal.tsx`, `terminal/mod.rs`, and PTY management — cannot exist on mobile. Full stop.

**Git shells out to the CLI.** Every git operation in `commands/git.rs` calls `Command::new("git").args(...)`. There is no `git` binary on iOS or Android. This is the single biggest technical blocker. Every git feature in the app — status, commit, push, pull, branch, stash, blame, diff, log — is dead on arrival without an alternative git implementation.

**LSP requires process spawning.** Language servers (rust-analyzer, typescript-language-server, etc.) are long-running processes started via `Command::new()`. Same problem as the terminal: no process spawning on mobile. Autocomplete, hover documentation, go-to-definition, diagnostics, inlay hints, signature help, and code actions all depend on LSP.

**The editor assumes a hardware keyboard.** The hidden textarea approach works — the virtual keyboard appears and characters flow through. But the interaction model is wrong. There's no Tab key, Escape requires a special gesture, bracket pairs require multiple taps through keyboard layers, and the textarea's autocorrect/suggestions are actively hostile to code. The keyboard handlers in `CanvasEditor.tsx` check for `metaKey`, `ctrlKey`, `altKey`, `shiftKey` — none of which exist on a virtual keyboard.

**Touch targets are microscopic.** A character cell in the editor at 14px font is roughly 8x22 CSS pixels. Apple's Human Interface Guidelines specify a minimum 44x44pt touch target. A single character is 1/5th the minimum size. The tab close button, the git stage/unstage buttons, the autocomplete items — all designed for mouse precision, not finger-sized tapping.

**The layout assumes width.** The sidebar (355px) + editor + status bar layout requires at minimum 800px (the enforced `minWidth`). An iPhone 15 is 393px wide. The entire spatial model breaks.

### What we share, what we rebuild, what we drop

| Feature | Desktop | Mobile | Strategy |
|---------|---------|--------|----------|
| File browser | Sidebar tree | Full-screen list | Rebuild for touch |
| Code viewer | Canvas editor | Canvas or DOM reader | Rebuild (read-first) |
| Code editor | Canvas + hidden textarea | Simplified edit mode | Rebuild (minimal) |
| Git operations | Shell out to git CLI | libgit2 (git2 crate) | Rebuild backend |
| Git UI | GitPanel + GitGraph | Touch-native panels | Rebuild for touch |
| Diff viewer | DiffView component | Unified diff (scrollable) | Adapt |
| AI chat | AiChat panel | Full-screen chat | Adapt (mostly works) |
| Search | Command palette | Full-screen search | Rebuild for touch |
| Terminal | CanvasTerminal + PTY | Not available | Drop |
| LSP | Process-based servers | Not available | Drop |
| Autocomplete | LSP-driven popup | AI-driven suggestions? | Rethink |
| Keyboard shortcuts | 70+ bindings | Gesture vocabulary | Rethink |
| Extensions (WASM) | wasmtime runtime | Possible but heavy | Defer |
| Syntax highlighting | tree-sitter | tree-sitter (shared) | Share |
| Theme system | Catppuccin + custom | Same | Share |
| Settings | SettingsPanel | Adapted for touch | Adapt |
| Session persistence | Rust file-based | Same | Share |
| API key management | Keyring + localStorage | Platform keychain | Adapt |

---

## Part 3: The Phone Experience

### The navigation model

A phone has one screen. Everything is a stack. You push a view onto the stack, you swipe back to pop it. This is the universal mobile pattern (UINavigationController on iOS, Fragment back stack on Android).

Buster Phone should be a stack:

```
Home (project list / recent files)
  -> File Browser (directory tree, flat list)
    -> File Viewer (syntax-highlighted, read-only)
      -> Edit Mode (virtual keyboard, focused editing)
  -> Git Status (files, staging, commit)
    -> Diff View (unified diff for a file)
    -> Branch Manager (list, switch, create)
    -> Commit Log (scrollable history)
  -> AI Chat (full conversation)
  -> Search (file search + content search)
  -> Settings
```

No tabs. No sidebar. No split panels. One thing at a time, with clear navigation between them.

**Question:** Should the home screen be a project list (like Working Copy), a recent-files list (like the current welcome screen), or the file browser of the last-opened project (like reopening where you left off)? What does the user expect to see when they open the app for the first time versus the hundredth time?

### The file browser

The sidebar tree with expand/collapse works on desktop. On a phone, a flat list with breadcrumb navigation is more natural — tap a folder to enter it, swipe back to go up. Each row should be at minimum 44pt tall with the full file name visible (no truncation).

**Question:** Should the file browser show git status indicators (M, A, D, ??) inline on each file, the way the desktop sidebar does? On a phone, horizontal space is precious — a colored dot might work better than a text label. But a colored dot requires learning what the colors mean. Is there a third option that communicates status without eating width or requiring memorization?

### The code viewer

This is where the biggest design question lives. The desktop editor is a canvas with custom text rendering. On mobile, there are two paths:

**Path A: Canvas viewer.** Reuse the existing `canvas-renderer.ts`. It already handles syntax highlighting, line numbers, diff gutters, and blame. The rendering is resolution-independent. But: canvas doesn't support native text selection, native scroll physics (momentum, rubber-banding), or native accessibility features. Pinch-to-zoom would need manual gesture recognition. Copy requires a custom selection mechanism.

**Path B: DOM viewer.** Render code as HTML `<pre>` with `<span>` elements for syntax tokens. The browser handles text selection, scrolling, accessibility, and zoom natively. But: we lose the exact visual match with the desktop editor, and the DOM can struggle with very large files (10,000+ lines of spans).

**Question:** Which path produces a better reading experience — pixel-perfect rendering via canvas with custom gesture handling, or native browser behavior via DOM with potential jank on large files? Is visual consistency with the desktop app worth the cost of rebuilding scroll, selection, and zoom? Or does "feeling native" matter more on mobile, and the DOM path gets you there faster?

### The edit mode

Editing code on a phone is bad. We can't make it good. We can make it less bad.

The virtual keyboard is the primary obstacle. It:
- Has no Tab key (indentation requires a custom toolbar)
- Has no Escape key (exiting modes requires a button)
- Autocorrects code (must be disabled: `autocorrect="off"`, `autocapitalize="off"`, `spellcheck=false`)
- Obscures 40% of the screen
- Has no modifier keys (Ctrl, Alt, Cmd)

A code-specific accessory bar above the keyboard could provide:
- Tab / Shift-Tab (indent/outdent)
- Common symbols: `{}`, `[]`, `()`, `<>`, `"`, `'`, `;`, `=`, `->`, `=>`, `//`
- Undo / Redo buttons
- A "Done" button to dismiss the keyboard

**Question:** Should edit mode be opt-in (tap an "Edit" button to enter it, tap "Done" to exit) or implicit (tapping in the code viewer places the cursor and raises the keyboard)? Opt-in prevents accidental edits but adds friction. Implicit feels more natural but risks unwanted changes, especially in a codebase you don't own. Working Copy uses opt-in. What's the right model for Buster?

**Question:** How important is multi-cursor on mobile? The desktop editor supports Alt+Click for additional cursors. On a phone, this could be long-press to place a second cursor, but the use case (editing the same pattern in multiple places simultaneously) seems vanishingly rare on a 6-inch screen. Should multi-cursor be dropped entirely on phone, or is there a touch gesture that makes it viable?

### Git on mobile

This might be the feature where Buster Mobile adds the most value. Most code editors on mobile have weak or no git integration. Working Copy is the gold standard but it's a standalone git client, not an IDE companion.

**The CLI problem:** Every git command in `commands/git.rs` uses `Command::new("git")`. On mobile, there's no `git` binary.

Options:
1. **libgit2 via the `git2` Rust crate.** Pure library implementation of git. Handles clone, fetch, push, pull, commit, branch, merge, diff, blame, log. Compiles for ARM. No CLI needed. This is what Working Copy uses (Objective-C bindings to libgit2). It's the serious option.

2. **isomorphic-git (JavaScript).** Pure JS git implementation that runs in the WebView. Handles most operations but is slower than native and has gaps (no merge, limited submodule support).

3. **GitHub/GitLab API only.** Don't do local git at all — operate on remote repos via API. Limits you to hosted repos and requires network.

**Question:** If we adopt `git2`, do we maintain the existing shell-based git backend for desktop and add a second `git2`-based backend for mobile? Or do we migrate the entire app to `git2` and drop the CLI dependency everywhere? The former means two code paths to maintain. The latter means a large refactor of 28 git commands on desktop for the sake of mobile, but it eliminates the `git` binary dependency entirely — which might also help users who don't have git installed.

**Question:** What git operations actually matter on a phone? The full list (status, stage, unstage, commit, push, pull, fetch, stash save/pop/list/drop, branch create/switch/delete, merge, rebase, log, diff, blame, conflict resolution) is comprehensive. But on a phone, is anyone doing `git stash` or `git rebase`? What's the minimum viable git surface for mobile — status, commit, push, pull, and branch switch? Or would that feel crippled compared to the desktop?

### AI chat on mobile

This is the easiest feature to adapt. The AI chat panel (`AiChat.tsx`) is already a message list + text input — the universal mobile chat pattern. The screen is a scrollable conversation. The input is at the bottom. The virtual keyboard works naturally for prose (asking questions).

The agent's tool-execution capability is the challenge. On desktop, the agent can read files, write files, search, and run commands. On mobile:
- Read files: works (filesystem is accessible in the app sandbox)
- Write files: works (same)
- Search files: works (the Rust search implementation runs natively)
- Run commands: impossible (no shell)

**Question:** Should the mobile AI agent be a reduced version (no command execution, file read/write/search only) or should it be a remote agent that executes on a server/desktop? A reduced local agent can still answer questions, suggest edits, and search code. A remote agent could do everything the desktop agent does but requires infrastructure (a running desktop instance, a relay server, or a cloud workspace). Which is more valuable for v1?

**Question:** Could the AI replace some of the features we're dropping? Without LSP, there's no autocomplete or hover docs. But an AI with access to the file contents could provide completion suggestions and documentation on request. Is "AI-powered code intelligence" a viable substitute for LSP on mobile, or is it too slow and expensive (API calls per keystroke)?

### Search

The command palette's file search and content search work well conceptually on mobile. The pattern — type in a search bar, see results, tap one — is native to every phone app.

**Question:** Should search be a dedicated screen (like the current command palette, but full-screen) or should it be integrated into the file browser as a filter bar at the top? The command palette's multi-mode approach (`:` for line, `#` for content, `@` for symbols, `?` for AI, `>` for commands) is powerful but the prefix syntax is unintuitive on mobile. Should each mode be a separate tab instead of a prefix character?

---

## Part 4: The Tablet Experience

Tablets occupy a middle ground. An iPad Pro with a Magic Keyboard is functionally a laptop. An iPad Mini held in portrait is functionally a large phone.

### The layout question

**Question:** Should the tablet app be the phone app with a wider layout, or the desktop app with touch adaptations? The answer probably depends on whether an external keyboard is connected.

Without keyboard (touch-only):
- Phone-style navigation stack, but with wider content areas
- Code viewer can show more columns (60-80 characters comfortably)
- Split view possible: file browser on left, file viewer on right
- Git diff could show side-by-side instead of unified

With keyboard connected:
- Desktop-like layout with sidebar + editor
- Most keyboard shortcuts become available
- The hidden textarea approach for text input works correctly
- Tab, Escape, modifier keys all function normally
- This is essentially the desktop experience with larger touch targets

**Question:** How does the app detect keyboard presence? On iPad, there's no reliable API to know if a hardware keyboard is connected — you can only detect when the virtual keyboard appears or doesn't. Should the layout switch be manual (a toggle in settings) or automatic (detect first keypress from a hardware keyboard and switch)?

### Editor on tablet

With a keyboard, the canvas editor can work almost identically to desktop. The main adaptations:
- Larger touch targets for gutter (tap to set breakpoints, select lines)
- Touch-based text selection (the system long-press + drag handles)
- Pinch-to-zoom to change font size
- No hover states (but long-press could substitute for hover documentation)

**Question:** Should the tablet editor be the exact same `CanvasEditor.tsx` component with responsive adjustments, or a separate component that shares the engine but has tablet-specific event handling? Forking the component means maintenance burden. Sharing it means conditional logic throughout. What's the right abstraction boundary?

### Terminal on tablet

iPadOS doesn't have a native terminal, but it does have process capabilities that phones don't — specifically, the ability to run background tasks and maintain network connections. An SSH terminal (connecting to a remote machine) is feasible and useful on a tablet.

Apps like Blink Shell, Termius, and Prompt prove that terminal emulation over SSH works well on iPad. Buster could offer an SSH-based terminal rather than a local PTY.

**Question:** Is an SSH terminal in scope for v1, or is it a distraction from the core mobile experience? It would require a new connection management UI, SSH key management, and a different backend path (SSH socket instead of local PTY). The existing `CanvasTerminal.tsx` rendering could potentially be reused — the cell grid, cursor, and scroll are the same — but the data source would be entirely different.

---

## Part 5: Technical Roadmap

### Phase 0 — Platform scaffolding

Generate the mobile project structure:
```
tauri ios init
tauri android init
```

This creates `src-tauri/gen/ios/` (Xcode project) and `src-tauri/gen/android/` (Gradle project). The existing Rust code compiles for ARM targets. The SolidJS frontend runs in the native WebView.

**What this gives you immediately:** the app launches on mobile and renders the current desktop UI in a WebView. It will look terrible (800px minimum width in a 393px viewport) but it runs.

### Phase 1 — Responsive shell

Build the mobile navigation shell that replaces the desktop layout:

- Detect viewport width at startup
- Below 768px: phone layout (navigation stack, no sidebar)
- 768-1024px: tablet portrait (collapsible sidebar)
- Above 1024px: desktop layout (current)
- New `MobileShell.tsx` component with stack navigation
- Bottom tab bar: Files, Git, AI, Search, Settings

**Key files to create:**
- `src/mobile/MobileShell.tsx`
- `src/mobile/MobileFileList.tsx`
- `src/mobile/MobileViewer.tsx`
- `src/styles/mobile.css`

**Key files to modify:**
- `src/App.tsx` — conditional render based on viewport
- `src/styles/base.css` — first media queries
- `tauri.conf.json` — remove `minWidth`/`minHeight` constraints

### Phase 2 — Git backend migration

Replace shell-based git with libgit2:

- Add `git2` crate to `Cargo.toml`
- Create `src-tauri/src/git/` module parallel to `commands/git.rs`
- Implement core operations: status, stage, unstage, commit, push, pull, fetch, log, diff, blame, branch list/create/switch/delete
- Feature-gate: `#[cfg(not(mobile))]` for CLI backend, `#[cfg(mobile)]` for git2 backend (or migrate entirely)

**Question:** libgit2's push/fetch requires authentication. On desktop, git CLI uses the user's SSH agent or credential helper. With `git2`, we need to handle auth ourselves — SSH key management (including passphrase), HTTPS token storage, and OAuth flows for GitHub/GitLab. How much auth plumbing is needed, and should we use the platform's native keychain (iOS Keychain, Android Keystore) for credential storage?

### Phase 3 — Mobile code viewer

Build a touch-native code viewing experience:

- Syntax-highlighted code display (canvas or DOM — decision needed)
- Native scroll with momentum
- Pinch-to-zoom for font size
- Tap line number to select entire line
- Swipe left on file browser to peek file content
- Breadcrumb header showing file path

### Phase 4 — Mobile editor

Build the minimal edit mode:

- Code-specific accessory bar above virtual keyboard
- Disable autocorrect, autocapitalize, spellcheck
- Opt-in editing (tap "Edit" button)
- Single cursor only (no multi-cursor on phone)
- Undo/redo via accessory bar buttons
- Auto-save on keyboard dismiss
- Commit prompt on save ("Commit this change?")

### Phase 5 — AI chat adaptation

Adapt the AI chat for mobile:

- Full-screen chat interface
- Reduced tool set (no command execution)
- File context attachment ("Ask about this file")
- Code block rendering with copy button
- Streaming responses

### Phase 6 — Tablet enhancements

- Keyboard detection and layout switching
- Split view support (sidebar + content)
- iPad multitasking (Slide Over, Split View)
- External keyboard shortcut support
- Optional SSH terminal

---

## Part 6: The Hard Questions

These are the questions that don't have obvious answers. They should be resolved before significant mobile development begins.

### Identity

**What is Buster Mobile's identity — is it the same app on a different screen, or a different app with the same brand?** The answer determines everything. If it's the same app, we optimize for feature parity and accept that some features are compromised. If it's a different app, we optimize for the mobile use cases and accept that the feature sets diverge. Every successful mobile companion app chose the second path. Every failed desktop-port-to-mobile chose the first.

### Workspace

**Where do the files live?** On desktop, Buster operates on the local filesystem. On a phone, the options are:

1. **App sandbox.** Clone the repo into the app's local storage. Git operations work locally. But the repo is isolated — other apps can't see it, and syncing between phone and desktop requires git push/pull.

2. **iCloud/Google Drive.** Store files in cloud storage. Syncs automatically. But git doesn't work well with cloud-synced files (`.git` directory conflicts, partial sync, lock files).

3. **Remote workspace.** The phone connects to a running desktop instance or cloud VM. Files aren't local — every read is a network request. Low storage requirements, always in sync, but requires connectivity and infrastructure.

4. **GitHub API only.** Don't store files locally at all. Browse repos, view files, make edits, and commit — all through the GitHub/GitLab API. No local clone. The simplest option, but limits you to hosted repos and requires network.

Each has different implications for offline access, storage management, sync conflicts, and performance. **Which model does Buster Mobile use?**

### Revenue

**Does mobile change the business model?** Desktop Buster is free and open source. A mobile app requires App Store distribution ($99/year Apple developer account, 15-30% revenue share). Mobile apps with ongoing API costs (AI) typically use subscriptions. If Buster Mobile uses the user's own API key (current model), there's no revenue to offset development costs. If it offers a managed AI backend, there's a service to monetize. **Is Buster Mobile a free companion, a paid app, or a gateway to a subscription service?**

### Scope

**What is v1?** A mobile app that tries to do everything will ship never. The smallest useful mobile app might be:

1. Open a project (from files app, clone from URL, or connect to GitHub)
2. Browse files with syntax highlighting
3. View git status and diffs
4. Make a small edit
5. Commit and push
6. Ask AI a question about the code

That's six features. No terminal, no LSP, no extensions, no split view, no branch management, no stash, no blame, no graph. Is that enough to be useful, or does it feel like a demo?

### Competition

**What exists today and where is the gap?** Working Copy (iOS, $22) is the gold standard git client with a built-in editor. GitHub Mobile (free) handles PRs and issues but not editing. Replit Mobile (free/subscription) is a cloud IDE. Buffer Editor (iOS, $10) is a local code editor. Textastic (iOS, $10) is a code editor with SFTP/SSH. **Where does Buster Mobile fit in this landscape — what does it do that none of them do?** The answer might be: AI-native code companion with real git integration, running entirely on-device with no cloud dependency. That's a gap. But only if the AI works offline or with the user's own key, and only if the git integration (via libgit2) is as solid as Working Copy's.
