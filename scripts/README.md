# Native macOS acceptance

`native-macos-smoke.js` exercises real WKWebView controls and native IPC without
sending a model request. It creates test notes and chat drafts, closes tabs,
checks the animated B and WebGL shader pixels, and quits through Command-Q.
Launching it a second time checks persistence and quits again. Use a fresh app
identifier containing `.parity-smoke`; the harness refuses ordinary app storage.

From the repository root, build the frontend and prepare a disposable copy:

```sh
bun run build
python3 - <<'PY'
from pathlib import Path
import json, shutil, tempfile, uuid
root = Path.cwd()
dist = Path(tempfile.mkdtemp(prefix='buster-mac-smoke-', dir='/private/tmp'))
shutil.copytree(root / 'dist', dist, dirs_exist_ok=True)
shutil.copy2(root / 'scripts/native-macos-smoke.js', dist / 'native-macos-smoke.js')
index = dist / 'index.html'
index.write_text(index.read_text().replace('</body>', '<script src="/native-macos-smoke.js"></script></body>'))
identifier = 'com.lukehightower.buster.parity-smoke-' + uuid.uuid4().hex
config = {'identifier': identifier, 'build': {'frontendDist': str(dist)},
          'app': {'windows': [{'title': 'BusterMark Parity Smoke', 'width': 1400,
                              'height': 900, 'closable': True}]}}
Path('/private/tmp/bustermark-macos-smoke-config.json').write_text(json.dumps(config))
Path('/private/tmp/bustermark-macos-smoke-dist.txt').write_text(str(dist))
print('Result:', Path.home() / 'Library/Application Support' / identifier / 'Notes/native-macos-smoke-result.json')
PY
bun build src/lib/background-renderer.ts --target browser --format esm --outfile "$(cat /private/tmp/bustermark-macos-smoke-dist.txt)/background-renderer.js"
TAURI_CONFIG="$(cat /private/tmp/bustermark-macos-smoke-config.json)" cargo build --manifest-path src-tauri/Cargo.toml --locked --features tauri/custom-protocol
./src-tauri/target/debug/bustermark
./src-tauri/target/debug/bustermark
```

Inspect the printed result path: success is `ok: true` with `phase: 2`. The
session should be version 2 with no tabs, and `session/.running` should be absent.
On failure the test window stays open and the report includes the failed check.
Quit that isolated window before rebuilding.

Restore the ordinary binary and app bundle after testing:

```sh
bun run tauri build --debug --bundles app
```

The test identifier owns its own Application Support folder and Desktop shortcut.
Move those test artifacts aside after inspecting them; preserve the main app's
storage and any unrelated Desktop items.

For split-view acceptance, use `native-macos-split-smoke.js` in the same setup
instead of `native-macos-smoke.js` (the background-renderer bundle is unnecessary).
It checks two live editors, focused formatting and undo, independent autosaves,
note-plus-Settings layout, the pane selector, the tab context menu, resizing,
collapse, saved layout on a second launch, and last-tab welcome. Its report is
`Notes/native-macos-split-smoke-result.json`; success is `ok: true`, `phase: 2`.

For printing, prepare a disposable bundle with fixture routing using:

```sh
bun run build
python3 scripts/prepare-native-macos-smoke.py print
TAURI_CONFIG="$(cat /private/tmp/bustermark-macos-print-smoke-config.json)" cargo build --manifest-path src-tauri/Cargo.toml --locked --features tauri/custom-protocol
./src-tauri/target/debug/bustermark
```

One launch checks toolbar, File menu, Command-P, Cancel, Escape, inline
validation, live draft capture, native PDF output, and editor preservation. It
drives the real model command handler with a fixture transport to verify waiting,
cancellation, confirmed PDF success, and Stop. It intercepts the save-location
picker and refuses every physical printer request. Its report is
`Notes/native-macos-print-smoke-result.json`; success is `ok: true`. The generated
Letter portrait, page-two-only, and A4 landscape PDFs can be inspected with:

```sh
swift -module-cache-path /private/tmp/bustermark-print-swift-cache scripts/verify-print-pdfs.swift /absolute/test/Notes
```

The probe checks page counts, dimensions, text, range selection, and exclusion
of app controls. Physical printer output still needs a configured device.
