# Buster Release Roadmap

## 1. Error Handling Sweep
- [x] Audit every `catch {}` block across `src/` and `src-tauri/`
- [x] Define a standard error-reporting pattern using `CanvasToasts`
- [x] Create a `showError(title, detail?)` utility in `src/lib/`
- [x] Replace silent catches in git operations (GitPage, GitPanel)
- [x] Replace silent catches in LSP (start, completion, keymap load)
- [x] Replace silent catches in file I/O (save, read, import)
- [x] Replace silent catches in settings (theme import, settings load)
- [x] Replace silent catches in terminal IPC
- [x] Replace silent catches in browser display list parsing
- [x] Replace silent catches in extension loading/unloading
- [x] Add fallback states for unrecoverable errors (e.g. LSP crash loop)

## 2. Loading States
- [x] Add spinner/progress component for canvas-rendered panels
- [x] Git: show progress during push, pull, fetch, clone
- [x] LSP: show "starting..." indicator in status bar during init
- [x] File I/O: show loading state when opening large files
- [x] Settings: show feedback during theme import
- [x] Search: show "searching..." state during workspace search
- [x] Extensions: show loading state during WASM load/init

## 3. Distribution Pipeline
- [x] Set up GitHub Actions release workflow (trigger on version tag)
- [x] Configure Tauri bundler for macOS (DMG, app bundle)
- [x] Configure Tauri bundler for Windows (NSIS installer)
- [x] Configure Tauri bundler for Linux (deb, AppImage)
- [ ] Obtain Apple Developer certificate for code signing
- [x] Set up macOS notarization in CI
- [ ] Obtain Windows code signing certificate (or use Azure SignTool)
- [x] Configure Tauri Update API (auto-updater endpoint)
- [x] Set up release hosting (GitHub Releases or S3)
- [ ] Add changelog generation (git-cliff or manual CHANGELOG.md)
- [ ] Test full install/update cycle on each platform

## 4. Find/Replace Completion
- [x] Wire engine-level find into EditorEngine (not just UI layer)
- [x] Add match highlighting in the editor canvas (not just find panel)
- [x] Complete Vim `/` inline search (currently delegates to find bar)
- [x] Complete Vim `?` reverse search
- [x] Add Vim `:s/find/replace/g` support
- [x] Add keyboard shortcuts for toggling case/regex in find panel
- [x] Show match count and current match index
- [x] Add "replace all in file" with undo support
- [x] Show invalid regex feedback (currently silent)

## 5. Context Menus
- [x] Build a reusable canvas-rendered context menu component
- [x] Editor: right-click menu (cut, copy, paste, select all, go to definition)
- [x] File tree: right-click menu (new file, new folder, rename, delete, copy path)
- [x] Tab bar: right-click menu (close, close others, close all, copy path)
- [x] Terminal: right-click menu (copy, paste, clear, search)
- [x] Git panel: right-click menu (stage, unstage, discard, diff)

## 6. Security Fixes
- [x] Upgrade `@chenglou/pretext` from 0.0.4 to 0.0.5 (DoS fix)
- [ ] Remove `unstable` feature flag from Tauri in Cargo.toml (blocked: required for browser webview)
- [x] Replace custom shell word parser in extension runtime with `shlex` crate
- [x] Sandbox debugger: allowlist adapter commands instead of accepting arbitrary paths
- [x] Run `cargo audit` and address any findings (wasmtime v29 has CVEs; upgrade to v36+ is a major refactor)
- [x] Validate debug adapter paths against a registry before execution

## 7. Extract BusterProvider Actions
- [x] Create `src/lib/buster-actions.ts` with all action implementations
- [x] Move file operations (save, open, close, external change) to actions module
- [x] Move git operations (sync, branch refresh) to actions module
- [x] Move tab management (create, close, switch, reorder) to actions module
- [x] Move LSP orchestration to actions module
- [x] Move extension/browser/debug tab creation to actions module
- [x] Keep BusterProvider.tsx as store creation + effect wiring only
- [x] Add dependency injection so actions are testable without full store

## 8. Sandbox Debugger Commands
- [x] Define an adapter registry (map of language -> allowed adapter paths)
- [x] Validate `adapter_cmd` in `debug_launch()` against the registry
- [x] Reject arbitrary command paths from frontend
- [ ] Add configuration for custom adapter paths (user-approved only)
- [x] Log rejected adapter attempts for security auditing

## 9. Legal & Governance Files
- [x] Add `LICENSE` file (MIT, matching package.json claim)
- [ ] Add `CHANGELOG.md` with version history starting from current state
- [x] Add `CONTRIBUTING.md` with build instructions and contribution guidelines
- [x] Add `SECURITY.md` with vulnerability disclosure policy
- [x] Add GitHub issue templates (bug report, feature request)
- [x] Add pull request template

## 10. Accessibility Pass
- [x] Audit all canvas-rendered components for ARIA label coverage
- [x] Add `aria-label` to CanvasSurface instances (tab bar, status bar, dock bar)
- [ ] Add screen-reader-only text alternatives for canvas content
- [x] Verify keyboard navigation through all major panels
- [x] Add visible focus indicators for all interactive elements
- [ ] Test with VoiceOver (macOS) end-to-end
- [ ] Add high-contrast mode option (not just hue adjustment)
- [x] Ensure terminal is keyboard-accessible (tabindex, focus management)
- [ ] Document keyboard shortcuts in an accessible help dialog
