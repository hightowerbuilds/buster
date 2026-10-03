# macOS Linux parity, split view, printing, and DMG

Status: **COMPLETED** — optimized Intel Mac app and DMG built and verified;
636 frontend tests, 54 path tests, and 208 native tests passed.

This build brings the Mac app forward to the shared BusterMark Linux source at
[`b1897d4`](https://github.com/hightowerbuilds/bustermark-linux/tree/b1897d458c81ee04f460535e66466bbc74b4bf2a)
and includes the requested split view and printing. Exact adaptations and source
differences are recorded in [the parity manifest](../../docs/linux-parity.json).

- [x] **COMPLETED** — Restore the Linux tab workspace, Markdown block editor,
  spinning Old English B, note naming, appearance settings, saved Language Model
  chats, Claude Code and Ollama transports, and shader backgrounds. Preserve
  macOS speech, Apple Dictionary, Keychain, session migration, and durable quit.
- [x] **COMPLETED** — Join notes, or a note and Settings, with Split View and
  Open Alongside. Preserve editor identity, drafts and undo. Add pane selectors,
  resizing, expand/collapse controls, and saved layout restoration.
- [x] **COMPLETED** — Print the live note draft from the toolbar, File menu,
  Command-P, or the shared `document print` command. A BusterMark-styled modal
  asks for destination, copies, pages, paper, orientation, and sides. The model
  opens the same modal and waits for confirmation. Save as PDF uses a native
  location picker. Cancelling or stopping before submission sends no job.
- [x] **COMPLETED** — Render a separate script-free native WebKit document with
  white paper, readable margins, formatted Markdown, and literal plain text.
  Images print their descriptions. Save PDFs atomically after successful native
  rendering. Retain the document and dialog after a failed job for explicit retry.
- [x] **COMPLETED** — Keep keyboard focus inside the print modal during printer
  discovery. Ignore disabled copies and unused page-range values when switching
  to PDF or all pages. Move Quick Open to Command-Option-P.
- [x] **COMPLETED** — Package the optimized Intel Mac app and DMG, verify the
  image and embedded application, and record its checksum and Desktop destination.

## Verification

- TypeScript: `bunx tsc --noEmit` passed on October 2.
- Frontend: **636 tests in 68 files passed** on October 2.
- Path utilities: **54 tests in 6 files passed** on October 2.
- Native workspace: **208 tests passed**, including macOS sandbox integration,
  native print validation, session migration, notes, atomic storage, and watching,
  on October 2 (`cargo test --manifest-path src-tauri/Cargo.toml --workspace --locked`).
- Strict workspace Clippy passed during the October 1 implementation checks.
- Real native WebKit checks from September 30–October 1 cover welcome animation,
  editing, undo, autosave, saved chats, restart recovery, and clean quit. The split
  harness checks both editors, focus, note-plus-Settings, pane controls, resizing,
  collapse, and restored layout; see [native acceptance setup](../../scripts/README.md).
- [Native printing evidence](assets/2026-10-02-print-native.json): **22 checks
  passed** on October 1, including toolbar, File menu, Command-P, cancellation,
  invalid page ranges, live draft capture, editor preservation, and model wait,
  cancellation, confirmed success, and Stop. The model transport and save-location
  picker used fixtures; printing, app command handlers, storage and WebKit were
  real. No paid live requests or physical printer jobs were submitted.
- PDFKit verified an **8-page Letter portrait PDF**, its **exact second page**
  exported separately, and an **11-page A4 landscape PDF**, including dimensions,
  Unicode, complete draft content, and exclusion of application controls.

## Artifact

Version: **0.1.0**. Target: **x86_64 macOS**. The app retains
`com.lukehightower.buster` and the existing notes and credential locations.
General app support starts at macOS 10.15; printing requires macOS 11 or later.

```sh
bun run tauri build --bundles app,dmg
```

The release build completed in **6 minutes 7 seconds**. Outputs:

- App: `src-tauri/target/release/bundle/macos/BusterMark.app` (**51.92 MiB**).
- DMG: `src-tauri/target/release/bundle/dmg/BusterMark_0.1.0_x64.dmg`
  (**14.79 MiB**, 15,506,255 bytes).
- Desktop destination: `~/Desktop/BusterMark_0.1.0_x64.dmg`.
- Signing: local **unsigned** build; not notarized.

DMG SHA-256:

```text
d2f9c7f5cd7e660a373e51f324d404ad1ea14b8a627bbb7a83776b7d7b62910e
```

`hdiutil verify` passed. The image was mounted read-only and checked for the
correct app identifier and version, an executable identical to the built release,
the matching bundled `browser.wasm`, and the Applications installation shortcut.
The executable is x86_64 and exports the native printing functions. Production
frontend assets contain no native smoke-test fixture. The verification image was
unmounted after inspection. The source and this build record are committed together.
