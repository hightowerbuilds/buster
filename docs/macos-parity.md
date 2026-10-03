# macOS parity with BusterMark Linux

The shared application was ported from
[bustermark-linux at b1897d4](https://github.com/hightowerbuilds/bustermark-linux/tree/b1897d458c81ee04f460535e66466bbc74b4bf2a).
The exact source revision and adaptations are recorded in [linux-parity.json](linux-parity.json).

The Mac app uses the same tab workspace, ProseMirror Markdown editor,
canvas text editor, spinning blackletter B welcome screen, periodic-table note
names, Appearances/Hotkeys settings, shader background gallery, and Language
Model sidebar. The sidebar supports Claude Code and local Ollama models,
approval before document edits, saved chat history, per-chat drafts, and web
search through a saved Brave Search key. The integrated terminal is retired.

The Mac workspace also supports an optional two-pane view requested after the
Linux port. **Split View** or a tab's **Open Alongside** menu pairs two notes,
or a note and Settings. Each pane's selector changes that pane's tab. The divider
resizes the pair; **Single View** and the pane expand buttons keep one visible.
Closing either visible tab expands the survivor, and saved sessions restore the
pair, focused tab, and divider width. Editors retain their text and undo history.

The Mac app also prints notes and text documents through a themed confirmation
dialog. Print, File → Print…, and Command-P share the `document print` command
with the Language Model. It captures the live draft, asks for destination and
basic print settings, and waits for confirmation. Save as PDF uses the same
native layout. The dedicated, script-free WebKit document contains only the
note, with formatted Markdown or literal plain text. The backend uses AppKit
and WebKit on macOS 11+; other platform builds report printing unavailable.

## Develop and build

Install Rust, Bun, and Xcode Command Line Tools, then run from the repository root:

```sh
bun install --cwd packages/buster-path
bun run --cwd packages/buster-path build
bun install --frozen-lockfile
bun run tauri dev
```

Close an older development instance before restarting. An existing process keeps
its old native services; frontend hot reload alone cannot update those services.

```sh
bun run tauri build --bundles app,dmg
```

The app and disk image are under `src-tauri/target/release/bundle/`.
For a local debug app, use `bun run tauri build --debug --bundles app`.
Release workflows build both Apple Silicon and Intel Mac targets. Publication,
Developer ID signing, and notarization require the configured release secrets.

## Mac behavior

| Control or service | macOS behavior |
| --- | --- |
| Close tab | Command-W or the tab's close button; the last close shows the welcome B |
| Quit | Command-Q or the red window close button; wait for durable session backup |
| Language Model | Command-Shift-A or the right-edge bumper |
| New note / save / settings | Command-N / Command-S / Command-comma |
| Print / Quick Open | Command-P / Command-Option-P |
| Internal commands | Control-backtick; try `help`, `app status`, or `notes list` |
| API and search keys | Login Keychain; keys stay out of saved settings |
| Read aloud | Native AVSpeechSynthesizer and installed macOS voices |
| Selection lookup | Installed Apple Dictionary dictionaries |
| Clipboard and dictation | Native Edit menu cut/copy/paste selectors |
| Distribution | `.app` and `.dmg` |

Claude uses the installed, signed-in Claude Code CLI. Ollama must be running
locally with a model installed. Live model requests and Brave Search require
those services to be configured; ordinary note editing works without them.

## Existing data

The identifier `com.lukehightower.buster` and existing credential service names
are unchanged. Notes, settings, and saved sessions stay in their existing Mac
locations. Version 1 sessions migrate to version 2 with a preserved original
session and unsaved backups. Retired terminal tabs are skipped. Closing cannot
exit the app after a failed session backup.

## Verification

```sh
bunx tsc --noEmit
bun run test
bun run --cwd packages/buster-path test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml --workspace --locked
bun run tauri build --debug --bundles app
```

The native sandbox integration tests create a macOS Seatbelt sandbox and need
to run outside an already restricted agent sandbox. CI checks Rust on macOS and
Linux. Frontend tests cover last-tab welcome, editor cleanup, chat persistence,
model transport, note edits, background playback, and session migration.

Verified on an Intel Mac running macOS 26.6.2, Rust 1.97.1, and Bun 1.3.10:
636 frontend tests, 54 path tests, 208 native tests, TypeScript, strict Clippy,
and the debug `.app` build passed. The real WKWebView also passed animation,
Unicode editing, formatting and undo, final-tab close, native shader rendering,
note autosave, saved-chat switching, restart recovery, and clean session-saving
quit checks. The [native smoke harness](../scripts/native-macos-smoke.js) runs
only in isolated test storage; see [its setup](../scripts/README.md).
Model and web-search transports were tested with fixtures rather than paid live requests.

The [split-view native harness](../scripts/native-macos-split-smoke.js) also
passed two-editor editing, focused formatting and undo, independent autosaves,
note-plus-Settings layout, pane selection, Open Alongside, resizing, collapse,
restoring both pane IDs and their width, final-tab welcome, and clean quit.

The [printing native harness](../scripts/native-macos-print-smoke.js) passed
toolbar, File menu, Command-P, Cancel, Escape, validation, captured draft,
editor preservation, model confirmation, model cancellation, and Stop. The
[PDFKit probe](../scripts/verify-print-pdfs.swift) verified an eight-page Letter
portrait PDF, its exact second page exported separately, and an eleven-page A4
landscape PDF, including paper dimensions, Unicode, and the complete draft.
These checks saved PDFs; physical printer output has not been exercised.

The October 2 optimized Intel `.app` and 14.79 MiB DMG also passed image
verification and inspection of the embedded executable and resources. TypeScript,
636 frontend tests, 54 path tests, and 208 native tests passed again for packaging.
See the [release build log](../growth/build-log/2026-10-02-macos-parity-split-print-dmg.md)
for artifact names, checksum, and signing status.
