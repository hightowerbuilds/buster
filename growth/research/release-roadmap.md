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
- [ ] Add spinner/progress component for canvas-rendered panels
- [ ] Git: show progress during push, pull, fetch, clone
- [ ] LSP: show "starting..." indicator in status bar during init
- [ ] File I/O: show loading state when opening large files
- [ ] Settings: show feedback during theme import
- [ ] Search: show "searching..." state during workspace search
- [ ] Extensions: show loading state during WASM load/init

## 3. Distribution Pipeline
- [ ] Set up GitHub Actions release workflow (trigger on version tag)
- [ ] Configure Tauri bundler for macOS (DMG, app bundle)
- [ ] Configure Tauri bundler for Windows (NSIS installer)
- [ ] Configure Tauri bundler for Linux (deb, AppImage)
- [ ] Obtain Apple Developer certificate for code signing
- [ ] Set up macOS notarization in CI
- [ ] Obtain Windows code signing certificate (or use Azure SignTool)
- [ ] Configure Tauri Update API (auto-updater endpoint)
- [ ] Set up release hosting (GitHub Releases or S3)
- [ ] Add changelog generation (git-cliff or manual CHANGELOG.md)
- [ ] Test full install/update cycle on each platform

## 4. Find/Replace Completion
- [ ] Wire engine-level find into EditorEngine (not just UI layer)
- [ ] Add match highlighting in the editor canvas (not just find panel)
- [ ] Complete Vim `/` inline search (currently delegates to find bar)
- [ ] Complete Vim `?` reverse search
- [ ] Add Vim `:s/find/replace/g` support
- [ ] Add keyboard shortcuts for toggling case/regex in find panel
- [ ] Show match count and current match index
- [ ] Add "replace all in file" with undo support
- [ ] Show invalid regex feedback (currently silent)

## 5. Context Menus
- [ ] Build a reusable canvas-rendered context menu component
- [ ] Editor: right-click menu (cut, copy, paste, select all, go to definition)
- [ ] File tree: right-click menu (new file, new folder, rename, delete, copy path)
- [ ] Tab bar: right-click menu (close, close others, close all, copy path)
- [ ] Terminal: right-click menu (copy, paste, clear, search)
- [ ] Git panel: right-click menu (stage, unstage, discard, diff)

## 6. Security Fixes
- [ ] Upgrade `@chenglou/pretext` from 0.0.4 to 0.0.5 (DoS fix)
- [ ] Remove `unstable` feature flag from Tauri in Cargo.toml
- [ ] Replace custom shell word parser in extension runtime with `shlex` crate
- [ ] Sandbox debugger: allowlist adapter commands instead of accepting arbitrary paths
- [ ] Run `cargo audit` and address any findings
- [ ] Validate debug adapter paths against a registry before execution

## 7. Extract BusterProvider Actions
- [ ] Create `src/lib/buster-actions.ts` with all action implementations
- [ ] Move file operations (save, open, close, external change) to actions module
- [ ] Move git operations (sync, branch refresh) to actions module
- [ ] Move tab management (create, close, switch, reorder) to actions module
- [ ] Move LSP orchestration to actions module
- [ ] Move extension/browser/debug tab creation to actions module
- [ ] Keep BusterProvider.tsx as store creation + effect wiring only
- [ ] Add dependency injection so actions are testable without full store

## 8. Sandbox Debugger Commands
- [ ] Define an adapter registry (map of language -> allowed adapter paths)
- [ ] Validate `adapter_cmd` in `debug_launch()` against the registry
- [ ] Reject arbitrary command paths from frontend
- [ ] Add configuration for custom adapter paths (user-approved only)
- [ ] Log rejected adapter attempts for security auditing

## 9. Legal & Governance Files
- [ ] Add `LICENSE` file (MIT, matching package.json claim)
- [ ] Add `CHANGELOG.md` with version history starting from current state
- [ ] Add `CONTRIBUTING.md` with build instructions and contribution guidelines
- [ ] Add `SECURITY.md` with vulnerability disclosure policy
- [ ] Add GitHub issue templates (bug report, feature request)
- [ ] Add pull request template

## 10. Accessibility Pass
- [ ] Audit all canvas-rendered components for ARIA label coverage
- [ ] Add `aria-label` to CanvasSurface instances (tab bar, status bar, dock bar)
- [ ] Add screen-reader-only text alternatives for canvas content
- [ ] Verify keyboard navigation through all major panels
- [ ] Add visible focus indicators for all interactive elements
- [ ] Test with VoiceOver (macOS) end-to-end
- [ ] Add high-contrast mode option (not just hue adjustment)
- [ ] Ensure terminal is keyboard-accessible (tabindex, focus management)
- [ ] Document keyboard shortcuts in an accessible help dialog
