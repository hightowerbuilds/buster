/**
 * Manual — informational reference for Buster IDE newcomers.
 * Replaces the animated TourCanvas with a scrollable, text-based manual
 * covering all features, keyboard shortcuts, and workflows.
 */

import { Component } from "solid-js";

interface ManualProps {
  onClose: () => void;
}

const Manual: Component<ManualProps> = (props) => {
  return (
    <div class="manual-overlay">
      <div class="manual-container">
        <div class="manual-header">
          <h1 class="manual-title">Buster Manual</h1>
          <button class="manual-close" onClick={props.onClose} aria-label="Close manual">
            &times;
          </button>
        </div>

        <div class="manual-content">
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

          {/* ── Editor ────────────────────────────────────── */}
          <section class="manual-section">
            <h2>Editor</h2>
            <table class="manual-table">
              <thead><tr><th>Action</th><th>Shortcut</th></tr></thead>
              <tbody>
                <tr><td>Quick Open file</td><td><kbd>Cmd+P</kbd></td></tr>
                <tr><td>Command Palette</td><td><kbd>Cmd+Shift+P</kbd></td></tr>
                <tr><td>Go to line</td><td><kbd>Cmd+G</kbd></td></tr>
                <tr><td>Find / Replace</td><td><kbd>Cmd+F</kbd></td></tr>
                <tr><td>Find with regex</td><td><kbd>Cmd+F</kbd> then click <code>.*</code></td></tr>
                <tr><td>Multi-cursor</td><td><kbd>Cmd+Click</kbd></td></tr>
                <tr><td>Select all occurrences</td><td><kbd>Cmd+Shift+L</kbd></td></tr>
                <tr><td>Toggle line comment</td><td><kbd>Cmd+/</kbd></td></tr>
                <tr><td>Duplicate line</td><td><kbd>Cmd+Shift+D</kbd></td></tr>
                <tr><td>Move line up/down</td><td><kbd>Alt+Up/Down</kbd></td></tr>
                <tr><td>Join lines</td><td><kbd>Cmd+J</kbd></td></tr>
                <tr><td>Indent / Outdent</td><td><kbd>Tab</kbd> / <kbd>Shift+Tab</kbd></td></tr>
                <tr><td>Toggle code fold</td><td>Click gutter fold marker</td></tr>
                <tr><td>Undo / Redo</td><td><kbd>Cmd+Z</kbd> / <kbd>Cmd+Shift+Z</kbd></td></tr>
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
            <table class="manual-table">
              <thead><tr><th>Action</th><th>Shortcut</th></tr></thead>
              <tbody>
                <tr><td>Autocomplete</td><td>Appears automatically as you type</td></tr>
                <tr><td>Hover info</td><td>Hover over any symbol</td></tr>
                <tr><td>Go to definition</td><td><kbd>Cmd+Click</kbd> or <kbd>F12</kbd></td></tr>
                <tr><td>Rename symbol</td><td><kbd>F2</kbd></td></tr>
                <tr><td>Find references</td><td><kbd>Shift+F12</kbd></td></tr>
                <tr><td>Next diagnostic</td><td><kbd>F8</kbd></td></tr>
                <tr><td>Previous diagnostic</td><td><kbd>Shift+F8</kbd></td></tr>
              </tbody>
            </table>
          </section>

          {/* ── Terminal ──────────────────────────────────── */}
          <section class="manual-section">
            <h2>Terminal</h2>
            <p>
              Full canvas-rendered terminal with real PTY support. Runs NeoVim, htop, tmux —
              anything your system terminal can run. Supports mouse reporting, bracketed paste,
              256-color palette, and 10,000-line scrollback.
            </p>
            <table class="manual-table">
              <thead><tr><th>Action</th><th>Shortcut</th></tr></thead>
              <tbody>
                <tr><td>New terminal</td><td><kbd>Cmd+T</kbd></td></tr>
                <tr><td>Paste into terminal</td><td><kbd>Cmd+V</kbd></td></tr>
                <tr><td>Scroll up/down</td><td>Mouse wheel</td></tr>
              </tbody>
            </table>
          </section>

          {/* ── Git ───────────────────────────────────────── */}
          <section class="manual-section">
            <h2>Git</h2>
            <p>
              32 built-in git commands with no terminal required. Visual commit graph with colored
              lanes, blame overlay, diff gutters, staging, and conflict detection.
            </p>
            <table class="manual-table">
              <thead><tr><th>Feature</th><th>Access</th></tr></thead>
              <tbody>
                <tr><td>Git panel</td><td>Click <strong>Git</strong> in the dock</td></tr>
                <tr><td>Stage / Unstage</td><td>Click +/- in the Git panel</td></tr>
                <tr><td>Commit</td><td>Type message and click Commit</td></tr>
                <tr><td>Branch switcher</td><td>Click branch name in status bar</td></tr>
                <tr><td>Diff view</td><td>Click any changed file in Git panel</td></tr>
                <tr><td>Commit graph</td><td>Scroll down in the Git panel</td></tr>
              </tbody>
            </table>
          </section>

          {/* ── AI Agent ──────────────────────────────────── */}
          <section class="manual-section">
            <h2>AI Agent</h2>
            <p>
              Integrated Claude AI that can read your files, write code, search the codebase,
              and run commands — all with your approval. Supports Sonnet, Opus, and Haiku models.
            </p>
            <table class="manual-table">
              <thead><tr><th>Feature</th><th>Access</th></tr></thead>
              <tbody>
                <tr><td>Open AI chat</td><td>Click <strong>Models</strong> in the dock</td></tr>
                <tr><td>Set API key</td><td>Settings &gt; API Keys</td></tr>
                <tr><td>Approve tool use</td><td>Click approve/deny in the chat</td></tr>
              </tbody>
            </table>
          </section>

          {/* ── Extensions ────────────────────────────────── */}
          <section class="manual-section">
            <h2>Extensions</h2>
            <p>
              WASM-sandboxed extension system with capability-based permissions.
              Extensions can read/write files, run commands (sandboxed), and register
              commands in the palette.
            </p>
            <p>
              Build extensions with the <code>buster-ext</code> CLI and the Rust guest SDK.
              See the Extensions panel in the dock for installed extensions.
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
              21 languages highlighted via Tree-sitter with native Rust parsing:
              JavaScript, TypeScript, TSX, Rust, Python, Go, C, C++, Java, Ruby,
              PHP, Lua, HTML, CSS, SCSS, Bash, YAML, TOML, JSON, XML, and Regex.
            </p>
            <p>
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
    </div>
  );
};

export default Manual;
