/**
 * ManualTab — generated reference tab for the Buster IDE.
 * Keyboard shortcuts are derived from the command registry so they
 * stay in sync automatically when commands are added or rebound.
 */

import { Component, For, createMemo } from "solid-js";
import { registry } from "../lib/command-registry";

/** Display order for command categories. */
const CATEGORY_ORDER = ["File", "Editor", "View", "Terminal", "Tabs", "Git", "Help"];

/** Convert internal keybinding notation ("Mod+S") to display format ("Cmd+S"). */
function formatKeybinding(binding: string): string {
  return binding.replace(/Mod\+/g, "Cmd+");
}

/** Tab-number commands (Mod+1 through Mod+9) get collapsed into one row. */
const TAB_NUMBER_RE = /^tabs\.\d+$/;

const ManualTab: Component = () => {
  const commandsByCategory = createMemo(() => {
    const all = registry.getAllUnfiltered();
    const groups = new Map<string, Array<{ label: string; keybinding: string }>>();

    let hasTabNumbers = false;

    for (const cmd of all) {
      if (!cmd.keybinding) continue;

      // Collapse tabs.1–9 into one summary entry
      if (TAB_NUMBER_RE.test(cmd.id)) {
        if (!hasTabNumbers) {
          hasTabNumbers = true;
          const cat = "Tabs";
          if (!groups.has(cat)) groups.set(cat, []);
          groups.get(cat)!.push({ label: "Go to Tab 1–9", keybinding: "Cmd+1 – Cmd+9" });
        }
        continue;
      }

      const cat = cmd.category ?? "Other";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push({
        label: cmd.label,
        keybinding: formatKeybinding(cmd.keybinding),
      });
    }

    const ordered: Array<{ category: string; commands: Array<{ label: string; keybinding: string }> }> = [];
    for (const cat of CATEGORY_ORDER) {
      const cmds = groups.get(cat);
      if (cmds && cmds.length > 0) ordered.push({ category: cat, commands: cmds });
    }
    for (const [cat, cmds] of groups) {
      if (!CATEGORY_ORDER.includes(cat) && cmds.length > 0) {
        ordered.push({ category: cat, commands: cmds });
      }
    }
    return ordered;
  });

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
            Every character on screen is drawn on HTML Canvas for maximum performance.
          </p>
          <p>
            Open a project folder with <kbd>Cmd+O</kbd> or click a recent folder on the welcome screen.
            Your session is auto-saved every 30 seconds and restored on next launch.
          </p>
        </section>

        {/* ── Generated shortcut tables ────────────────── */}
        <For each={commandsByCategory()}>
          {(group) => (
            <section class="manual-section">
              <h2>Keyboard Shortcuts — {group.category}</h2>
              <table class="manual-table">
                <thead><tr><th>Shortcut</th><th>Action</th></tr></thead>
                <tbody>
                  <For each={group.commands}>
                    {(cmd) => (
                      <tr>
                        <td><kbd>{cmd.keybinding}</kbd></td>
                        <td>{cmd.label}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </section>
          )}
        </For>

        {/* ── Editor built-in shortcuts (handled by the editor, not the command registry) */}
        <section class="manual-section">
          <h2>Editor Built-ins</h2>
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
              <tr><td><kbd>Ctrl+Space</kbd></td><td>Trigger autocomplete</td></tr>
              <tr><td><kbd>F12</kbd></td><td>Go to definition</td></tr>
              <tr><td><kbd>Cmd+.</kbd></td><td>Code actions</td></tr>
              <tr><td><kbd>F2</kbd></td><td>Rename symbol</td></tr>
              <tr><td><kbd>Shift+F12</kbd></td><td>Find references</td></tr>
            </tbody>
          </table>
        </section>

        {/* ── Quick Open & Command Palette ──────────────── */}
        <section class="manual-section">
          <h2>Quick Open & Command Palette</h2>
          <table class="manual-table">
            <thead><tr><th>Mode</th><th>Trigger</th><th>What it does</th></tr></thead>
            <tbody>
              <tr><td>File search</td><td><kbd>Cmd+P</kbd></td><td>Fuzzy find any file in the project</td></tr>
              <tr><td>Commands</td><td><kbd>Cmd+Shift+P</kbd> or type <code>&gt;</code></td><td>Run any registered command</td></tr>
              <tr><td>Go to line</td><td>Type <code>:</code></td><td>Jump to a line number</td></tr>
              <tr><td>Go to symbol</td><td>Type <code>@</code></td><td>Jump to a symbol in the file</td></tr>
              <tr><td>Workspace search</td><td>Type <code>#</code></td><td>Search across all files</td></tr>
            </tbody>
          </table>
        </section>

        {/* ── Terminal ──────────────────────────────────── */}
        <section class="manual-section">
          <h2>Terminal</h2>
          <p>
            Full canvas-rendered terminal with real PTY support. Runs NeoVim, htop, tmux —
            anything your system terminal can run. Supports mouse reporting, bracketed paste,
            256-color palette, and 10,000-line scrollback. Terminal theme follows the app palette
            automatically.
          </p>
        </section>

        {/* ── Git ───────────────────────────────────────── */}
        <section class="manual-section">
          <h2>Git</h2>
          <p>
            32 built-in git commands with no terminal required. Visual commit graph with colored
            lanes, blame overlay, diff gutters, staging, and conflict detection.
            Open the Git panel with <kbd>Cmd+Shift+G</kbd>.
          </p>
        </section>

        {/* ── Language Intelligence ────────────────────── */}
        <section class="manual-section">
          <h2>Language Intelligence (LSP)</h2>
          <p>
            Buster automatically starts language servers when you open a supported file.
            Supports 20 languages including Rust, TypeScript, Python, Go, C/C++, Java, Ruby, PHP, Lua, Bash, YAML, TOML, CSS, SCSS, and HTML.
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
            <strong> 1</strong> through <strong>6</strong>.
            The number matches the number of visible panels. Switch layouts from the
            layout picker in the dock bar.
          </p>
        </section>

        {/* ── Settings & Theming ────────────────────────── */}
        <section class="manual-section">
          <h2>Settings & Theming</h2>
          <p>
            Open Settings with <kbd>Cmd+,</kbd>. Customize keyboard shortcuts by clicking any binding
            to rebind it. Import VS Code <code>.json</code> theme files to change the color scheme.
            The default dark theme is Catppuccin Mocha; the default light theme is a warm beige palette.
          </p>
        </section>

        {/* ── Debugger ──────────────────────────────────── */}
        <section class="manual-section">
          <h2>Debugger (Experimental)</h2>
          <p>
            DAP-based debugger with support for CodeLLDB (Rust/C/C++), debugpy (Python),
            Delve (Go), and JavaScript Debug. Set breakpoints by clicking the editor gutter.
            Conditional breakpoints and variable inspection with lazy child expansion.
          </p>
        </section>
      </div>
    </div>
  );
};

export default ManualTab;
