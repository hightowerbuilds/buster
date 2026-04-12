/**
 * ManualTab — scrollable reference tab for the Buster IDE.
 * Renders as a tab panel (like Settings or Git).
 * Includes all keyboard shortcuts from the former Legend tab.
 */

import { Component } from "solid-js";

const ManualTab: Component = () => {
  return (
    <div class="manual-tab">
      <div class="manual-tab-header">
        <h1 class="manual-title">Buster Manual</h1>
      </div>

      <div class="manual-tab-body">
        {/* ── Getting Started ───────────────────────────── */}
        <section class="manual-section">
          <h2>Getting Started</h2>
          <p>
            Buster is a canvas-rendered IDE built with Tauri, Rust, and SolidJS.
            Everything you see — the editor, terminal, sidebar, and this manual — renders
            directly on HTML Canvas for maximum performance.
          </p>
          <p>
            Open a project folder with <kbd>Cmd+O</kbd> or click a recent folder on the welcome screen.
            Your session is auto-saved every 30 seconds and restored on next launch.
          </p>
        </section>

        {/* ── Keyboard Shortcuts (from Legend) ────────────── */}
        <section class="manual-section">
          <h2>Keyboard Shortcuts — File</h2>
          <table class="manual-table">
            <thead><tr><th>Shortcut</th><th>Action</th></tr></thead>
            <tbody>
              <tr><td><kbd>Cmd+S</kbd></td><td>Save file</td></tr>
              <tr><td><kbd>Cmd+O</kbd></td><td>Open folder</td></tr>
              <tr><td><kbd>Cmd+W</kbd></td><td>Close tab / close window</td></tr>
              <tr><td><kbd>Cmd+T</kbd></td><td>New terminal</td></tr>
            </tbody>
          </table>
        </section>

        <section class="manual-section">
          <h2>Keyboard Shortcuts — Navigation</h2>
          <table class="manual-table">
            <thead><tr><th>Shortcut</th><th>Action</th></tr></thead>
            <tbody>
              <tr><td><kbd>Cmd+P</kbd></td><td>Open file picker</td></tr>
              <tr><td><kbd>Cmd+Shift+P</kbd></td><td>Command palette</td></tr>
              <tr><td><kbd>Cmd+Shift+O</kbd></td><td>Go to symbol (@)</td></tr>
              <tr><td><kbd>Ctrl+G</kbd></td><td>Go to line (:)</td></tr>
              <tr><td><kbd>Cmd+P</kbd> then <code>#</code></td><td>Search file contents</td></tr>
              <tr><td><kbd>Cmd+P</kbd> then <code>?</code></td><td>Ask AI a question</td></tr>
              <tr><td><kbd>Cmd+F</kbd></td><td>Find in file</td></tr>
            </tbody>
          </table>
        </section>

        <section class="manual-section">
          <h2>Keyboard Shortcuts — Editor</h2>
          <table class="manual-table">
            <thead><tr><th>Shortcut</th><th>Action</th></tr></thead>
            <tbody>
              <tr><td><kbd>Cmd+Z</kbd></td><td>Undo</td></tr>
              <tr><td><kbd>Cmd+Shift+Z</kbd></td><td>Redo</td></tr>
              <tr><td><kbd>Cmd+C</kbd> / <kbd>Cmd+X</kbd> / <kbd>Cmd+V</kbd></td><td>Copy / Cut / Paste</td></tr>
              <tr><td><kbd>Cmd+A</kbd></td><td>Select all</td></tr>
              <tr><td><kbd>Alt+Click</kbd></td><td>Add cursor</td></tr>
              <tr><td><kbd>Alt+Left/Right</kbd></td><td>Move by word</td></tr>
              <tr><td><kbd>Cmd+Left/Right</kbd></td><td>Move to line start/end</td></tr>
              <tr><td><kbd>Cmd+Up/Down</kbd></td><td>Move to file start/end</td></tr>
              <tr><td><kbd>Cmd+/</kbd></td><td>Toggle line comment</td></tr>
              <tr><td><kbd>Cmd+Shift+D</kbd></td><td>Duplicate line</td></tr>
              <tr><td><kbd>Alt+Up/Down</kbd></td><td>Move line up/down</td></tr>
              <tr><td><kbd>Cmd+J</kbd></td><td>Join lines</td></tr>
              <tr><td><kbd>Tab</kbd> / <kbd>Shift+Tab</kbd></td><td>Indent / Outdent</td></tr>
              <tr><td><kbd>Tab</kbd></td><td>Accept ghost text / Insert tab</td></tr>
              <tr><td><kbd>Ctrl+Space</kbd></td><td>Trigger autocomplete</td></tr>
              <tr><td><kbd>F12</kbd></td><td>Go to definition</td></tr>
              <tr><td><kbd>Cmd+.</kbd></td><td>Code actions</td></tr>
              <tr><td><kbd>F2</kbd></td><td>Rename symbol</td></tr>
              <tr><td><kbd>Shift+F12</kbd></td><td>Find references</td></tr>
              <tr><td><kbd>F8</kbd> / <kbd>Shift+F8</kbd></td><td>Next / Previous diagnostic</td></tr>
            </tbody>
          </table>
        </section>

        <section class="manual-section">
          <h2>Keyboard Shortcuts — Git & View</h2>
          <table class="manual-table">
            <thead><tr><th>Shortcut</th><th>Action</th></tr></thead>
            <tbody>
              <tr><td><kbd>Cmd+Shift+B</kbd></td><td>Toggle blame view</td></tr>
              <tr><td><kbd>Cmd+=</kbd></td><td>Zoom in</td></tr>
              <tr><td><kbd>Cmd+-</kbd></td><td>Zoom out</td></tr>
              <tr><td><kbd>Cmd+0</kbd></td><td>Reset zoom</td></tr>
              <tr><td><kbd>Cmd+,</kbd></td><td>Open settings</td></tr>
              <tr><td><kbd>Cmd+L</kbd></td><td>Open AI agent</td></tr>
              <tr><td><kbd>Ctrl+`</kbd></td><td>New terminal</td></tr>
            </tbody>
          </table>
        </section>

        {/* ── LSP & Intelligence ────────────────────────── */}
        <section class="manual-section">
          <h2>Language Intelligence (LSP)</h2>
          <p>
            Buster automatically starts language servers when you open a supported file.
            Supports 20 languages including Rust, TypeScript, Python, Go, C/C++, Java, Ruby, PHP, Lua, Bash, YAML, TOML, CSS, SCSS, and HTML.
          </p>
        </section>

        {/* ── Terminal ──────────────────────────────────── */}
        <section class="manual-section">
          <h2>Terminal</h2>
          <p>
            Full canvas-rendered terminal with real PTY support. Runs NeoVim, htop, tmux —
            anything your system terminal can run. Supports mouse reporting, bracketed paste,
            256-color palette, and 10,000-line scrollback.
          </p>
        </section>

        {/* ── Git ───────────────────────────────────────── */}
        <section class="manual-section">
          <h2>Git</h2>
          <p>
            32 built-in git commands with no terminal required. Visual commit graph with colored
            lanes, blame overlay, diff gutters, staging, and conflict detection.
            Open the Git panel from the dock.
          </p>
        </section>

        {/* ── AI Agent ──────────────────────────────────── */}
        <section class="manual-section">
          <h2>AI Agent</h2>
          <p>
            Integrated Claude AI that can read your files, write code, search the codebase,
            and run commands — all with your approval. Supports Sonnet, Opus, and Haiku models.
            Set your API key in Settings, then open the Models tab from the dock.
          </p>
        </section>

        {/* ── Extensions ────────────────────────────────── */}
        <section class="manual-section">
          <h2>Extensions</h2>
          <p>
            WASM-sandboxed extension system with capability-based permissions.
            Extensions can read/write files, run commands (sandboxed), and register
            commands in the palette. Build extensions with the <code>buster-ext</code> CLI
            and the Rust guest SDK.
          </p>
        </section>

        {/* ── Layouts ───────────────────────────────────── */}
        <section class="manual-section">
          <h2>Layouts</h2>
          <p>
            Six panel counts control the workspace layout:
            <strong> g1</strong>, <strong> g2</strong>, <strong> g3</strong>,
            <strong> g4</strong>, <strong> g5</strong>, and <strong> g6</strong>.
            The number matches the number of visible panels. Switch layouts from the
            layout picker in the dock bar or press <kbd>Ctrl+`</kbd> then <kbd>1</kbd> through <kbd>6</kbd>.
          </p>
        </section>

        {/* ── Syntax Highlighting ───────────────────────── */}
        <section class="manual-section">
          <h2>Syntax Highlighting</h2>
          <p>
            21 languages highlighted via Tree-sitter with native Rust parsing.
            Additional grammars can be loaded at runtime from <code>~/.buster/grammars/</code>.
            VS Code themes can be imported from Settings.
          </p>
        </section>

        {/* ── Quick Open & Command Palette ──────────────── */}
        <section class="manual-section">
          <h2>Quick Open & Command Palette</h2>
          <table class="manual-table">
            <thead><tr><th>Mode</th><th>Trigger</th><th>What it does</th></tr></thead>
            <tbody>
              <tr><td>File search</td><td><kbd>Cmd+P</kbd></td><td>Fuzzy find any file in the project</td></tr>
              <tr><td>Commands</td><td><kbd>Cmd+Shift+P</kbd> or type <code>&gt;</code></td><td>Run any command</td></tr>
              <tr><td>Go to line</td><td>Type <code>:</code></td><td>Jump to a line number</td></tr>
              <tr><td>Go to symbol</td><td>Type <code>@</code></td><td>Jump to a symbol in the file</td></tr>
              <tr><td>Workspace search</td><td>Type <code>#</code></td><td>Search across all files</td></tr>
              <tr><td>AI prompt</td><td>Type <code>?</code></td><td>Ask the AI agent a question</td></tr>
            </tbody>
          </table>
        </section>

        {/* ── Settings & Theming ────────────────────────── */}
        <section class="manual-section">
          <h2>Settings & Theming</h2>
          <p>
            Open Settings from the dock. Customize keyboard shortcuts by clicking any binding
            to rebind it. Import VS Code <code>.json</code> theme files to change the color scheme.
            The default theme is Catppuccin Mocha.
          </p>
        </section>

        {/* ── Debugger ──────────────────────────────────── */}
        <section class="manual-section">
          <h2>Debugger</h2>
          <p>
            DAP-based debugger with support for CodeLLDB (Rust/C/C++), debugpy (Python),
            Delve (Go), and JavaScript Debug. Set breakpoints by clicking the editor gutter.
            Conditional breakpoints and variable inspection with lazy child expansion.
          </p>
        </section>

        {/* ── Remote Development ────────────────────────── */}
        <section class="manual-section">
          <h2>Remote Development</h2>
          <p>
            SSH remote support with agent and key file authentication.
            Connect to remote hosts, browse files via SFTP, and execute commands over SSH.
          </p>
        </section>
      </div>
    </div>
  );
};

export default ManualTab;
