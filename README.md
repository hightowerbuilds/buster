# BusterMark

A writing workbench with AI integration, built with Tauri, Rust, and SolidJS.

BusterMark is being rebuilt from the Buster IDE. The existing canvas editor,
integrated terminal, and desktop foundation support the transition. Phase 1 is
underway with note-first split panes, keyboard navigation, resizing, and saved
layouts. Selecting text opens Copy/Paste, local macOS dictionary lookup, and AI
review beside the source note. AI results require explicit acceptance and support
undo. Selected text can be read aloud with installed macOS voices, with pause,
resume, stop, and word progress in a persistent playback strip. Speech model
discovery and full-document reading remain planned Phase 1 work.

Phase 2 adds Markdown formatting, adjustable padding/columns and typography,
local open-note search, and optional writing effects. Use **Writing appearance**
for preview/apply/reset, saved appearances, and app/workspace/pane scopes. The
shared catalog now exposes 66 commands. The next milestone is a Claude/Codex
connection UI and agent tool-calling integration.

The File Explorer stays in the sidebar; its right-edge bumper or **Cmd+B** toggles
it. The footer provides **Terminal**, **Settings**, and **Notes** (new Markdown
note). Notes live in the app's persistent `Notes` directory and autosave there.
`Desktop/BusterMark` is a symbolic link to that directory, so Finder and the app
use the same files. An existing Desktop item is preserved and a numbered shortcut
name is used instead; the footer displays the actual location or any setup error.

## Rebuild progress

- [Phase 0 — Foundation](growth/phases/phase-0.md)
- [Phase 1 — Writing panes, selection actions, and voice](growth/phases/phase-1.md)
- [Phase 2 — Word-processing interface and model-controlled appearance](growth/phases/phase-2.md)
- [Phase 3 — Claude and Codex connections](growth/phases/phase-3.md)
- [First writing workflow](growth/phases/writing-workflow.md)
- [Phase 0 demo](growth/build-log/phase-0-demo.md)
- [Build log](growth/build-log/)
- [Historical plans and summaries](growth/archive/2026-09-20-pre-rebuild/README.md)

Completed phase tasks are marked **COMPLETED** after implementation and relevant
verification. Unchecked tasks remain planned work.

## Development

Install Rust, Bun, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).
On macOS, install Xcode Command Line Tools.

```sh
git clone https://github.com/hightowerbuilds/buster.git
cd buster
bun install --cwd packages/buster-path
bun run --cwd packages/buster-path build
bun install
bun run tauri dev
```

The repository URL and directory name remain `buster` during the rebuild.

## Checks and builds

```sh
bunx tsc --noEmit
bun run test
bun run build
cd src-tauri
cargo check
cargo test
```

Use `bun run tauri build` from the project root for a desktop package. On macOS,
the application bundle is `src-tauri/target/release/bundle/macos/BusterMark.app`.

## Architecture

| Location | Responsibility |
| --- | --- |
| `src/` | SolidJS application and TypeScript UI state |
| `src/editor/` | Current canvas editor and document operations |
| `src/ui/` | Panels, terminal rendering, and application controls |
| `src/lib/` | Shared state, actions, commands, and Tauri IPC |
| `src-tauri/src/` | Native services, filesystem, PTYs, and IPC handlers |
| `src-tauri/crates/` | Supporting Rust libraries |
| `packages/buster-path/` | Shared path utilities |

The [internal command system](docs/internal-commands.md) lets human controls and
in-app AI adapters use the same feature services. Open it with Ctrl+backtick and
try `help`, `app status`, or `terminal create`. Phase 0 tracks the remaining scope.

## Compatibility

The product name is BusterMark. The application identifier
`com.lukehightower.buster`, existing storage and credential identifiers, and
internal library names are retained to preserve compatibility. The rename does
not relocate user data. See the build log for the identity inventory.

## License

MIT
