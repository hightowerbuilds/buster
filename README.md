# BusterMark

This is the macOS version of BusterMark, kept in step with
[hightowerbuilds/bustermark-linux](https://github.com/hightowerbuilds/bustermark-linux).
The current shared source is Linux commit `b1897d4`; see
[macOS parity](docs/macos-parity.md) for the exact revision and platform details.
See the [October 2 build log](growth/build-log/2026-10-02-macos-parity-split-print-dmg.md)
for the packaged Mac build and verification record.

BusterMark is a local Markdown and plain-text writing workbench built with
Tauri 2, Rust, and SolidJS. Markdown notes use a ProseMirror block editor backed
by the shared text engine; other text files use the canvas editor. One tab bar
holds your notes and settings. Switching tabs preserves editor state, and closing
all tabs reveals the spinning Old English B.

Use **Split View** to see two notes, or a note and Settings, alongside each other.
Right-click a tab and choose **Open Alongside** to pair it with the current tab.
Each pane has a tab selector; drag the divider to resize, and use **Single View**
or a pane's expand button to return to one tab. Both editors retain their state,
and the pair and its width are restored when you reopen the app.

Print a note with the **Print** button, **File → Print…**, or **Command-P**.
BusterMark's confirmation dialog asks for the printer, copies, pages, paper size,
orientation, and sides. **Save as PDF** uses the same layout and a save-location
picker. Printing includes the current draft and unsaved changes. Ask the Language
Model to print a note and it opens the same dialog, waiting for your confirmation.
Markdown prints as formatted text; plain-text files retain their literal content.

New notes autosave in the persistent Notes directory and receive an unused
periodic-table element name. The Desktop shortcut points to that directory and
preserves existing Desktop items. Settings contains Appearances and Hotkeys,
including writing styles, interface zoom, and animated WGSL note backgrounds.

The Language Model sidebar supports Claude through your signed-in Claude Code
subscription and local Ollama models such as Qwen. It keeps multiple saved chats,
searchable history, and per-chat drafts. Proposed document edits require approval
and support undo. It can create shader backgrounds and search the web when a
Brave Search key is configured. Selection-scoped AI review also supports Ollama,
Anthropic, and OpenAI. The integrated terminal has been retired, matching Linux.

macOS retains native speech, Apple Dictionary lookup, clipboard and dictation
integration, and Keychain storage for API keys. Version 2 sessions preserve tab
order, the active tab, split view, cursor and selection, scrolling, and unsaved writing.
Version 1 sessions migrate while preserving their original session and backups.
The application identifier and storage locations remain unchanged.

## Development

Install Rust, Bun, and Xcode Command Line Tools. From this repository:

```sh
bun install --cwd packages/buster-path
bun run --cwd packages/buster-path build
bun install --frozen-lockfile
bun run tauri dev
```

Stop an older dev instance before launching the updated native app.

## Mac shortcuts

| Action | Shortcut |
| --- | --- |
| New note | Command-N |
| Save | Command-S |
| Print | Command-P |
| Quick Open | Command-Option-P |
| Search commands | Command-Shift-P |
| Close tab | Command-W |
| Quit after saving the session | Command-Q |
| Settings | Command-comma |
| Language Model sidebar | Command-Shift-A |
| Internal commands | Control-backtick |

## Checks and packaging

```sh
bunx tsc --noEmit
bun run test
bun run --cwd packages/buster-path test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml --workspace --locked
bun run tauri build --bundles app,dmg
```

Mac installers appear under `src-tauri/target/release/bundle/`. For a local debug
app, use `bun run tauri build --debug --bundles app`.

## Architecture

| Location | Responsibility |
| --- | --- |
| `src/editor/` | Block editor, canvas editor, and shared document engine |
| `src/ui/` | Tab workspace, settings, backgrounds, and Language Model sidebar |
| `src/lib/` | State, feature commands, persistence, model transports, and IPC |
| `src-tauri/src/` | Native filesystem, Claude bridge, Ollama, shaders, and Mac services |
| `src-tauri/crates/` | Supporting Rust libraries |
| `packages/buster-path/` | Shared path utilities |

See [internal commands](docs/internal-commands.md) for the shared human and AI
command services. The [implementation reference](docs/documentation.md) and
[growth plans](growth/phases/phase-0.md) retain historical implementation context.

## License

MIT
