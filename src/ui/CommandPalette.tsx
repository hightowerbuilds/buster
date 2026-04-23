import { Component, createSignal, createEffect, on, For, Show } from "solid-js";
import { listWorkspaceFiles, workspaceSearch, lspDocumentSymbol } from "../lib/ipc";
import type { WorkspaceFile, WorkspaceSearchResult, LspDocumentSymbol } from "../lib/ipc";
import { registry, type Command } from "../lib/command-registry";
import { createFocusTrap } from "../lib/a11y";
import { basename, dirname } from "buster-path";
import type { EditorEngine } from "../editor/engine";
import { showInfo } from "../lib/notify";

interface CommandPaletteProps {
  visible: boolean;
  workspaceRoot: string | null;
  onClose: () => void;
  onFileSelect: (path: string) => void;
  onGoToLine?: (line: number, col: number) => void;
  initialQuery?: string;
  activeFilePath?: string | null;
  recentFiles?: { path: string; name: string }[];
  activeEngine?: EditorEngine | null;
}

function fuzzyMatch(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastMatchIdx = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 1;
      if (lastMatchIdx === ti - 1) score += 2;
      if (ti === 0 || t[ti - 1] === "/" || t[ti - 1] === "." || t[ti - 1] === "-" || t[ti - 1] === "_") {
        score += 3;
      }
      lastMatchIdx = ti;
      qi++;
    }
  }

  return qi === q.length ? score : -1;
}

const SYMBOL_KIND_ABBREV: Record<string, string> = {
  File: "file", Module: "mod", Namespace: "ns", Package: "pkg",
  Class: "C", Method: "m", Property: "prop", Field: "fld",
  Constructor: "ctor", Enum: "E", Interface: "I", Function: "fn",
  Variable: "var", Constant: "const", String: "str", Number: "num",
  Boolean: "bool", Array: "arr", Object: "obj", Key: "key",
  Null: "null", EnumMember: "em", Struct: "S", Event: "evt",
  Operator: "op", TypeParameter: "T",
};

function symbolKindAbbrev(kind: string): string {
  return SYMBOL_KIND_ABBREV[kind] ?? kind.toLowerCase();
}

function formatKeybinding(kb?: string): string {
  if (!kb) return "";
  return kb
    .replace(/Mod\+/g, navigator.platform.startsWith("Mac") ? "\u2318" : "Ctrl+")
    .replace(/Shift\+/g, "\u21E7")
    .replace(/Alt\+/g, "\u2325")
    .replace(/=$/, "+");
}

const CommandPalette: Component<CommandPaletteProps> = (props) => {
  let inputRef: HTMLInputElement | undefined;

  const [query, setQuery] = createSignal("");
  const [files, setFiles] = createSignal<WorkspaceFile[]>([]);
  const [filtered, setFiltered] = createSignal<WorkspaceFile[]>([]);
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [isCommand, setIsCommand] = createSignal(false);
  const [isSearchMode, setIsSearchMode] = createSignal(false);
  const [searchResults, setSearchResults] = createSignal<WorkspaceSearchResult[]>([]);
  const [isLineMode, setIsLineMode] = createSignal(false);
  const [isSymbolMode, setIsSymbolMode] = createSignal(false);
  const [symbols, setSymbols] = createSignal<LspDocumentSymbol[]>([]);
  const [filteredSymbols, setFilteredSymbols] = createSignal<LspDocumentSymbol[]>([]);
  const [filteredCommands, setFilteredCommands] = createSignal<Command[]>([]);
  const [searching, setSearching] = createSignal(false);
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let paletteRef: HTMLDivElement | undefined;

  const trap = createFocusTrap(() => paletteRef, () => props.onClose());

  // Load workspace files when opened
  createEffect(
    on(
      () => props.visible,
      async (visible) => {
        if (visible) {
          const initial = props.initialQuery ?? "";
          setQuery(initial);
          setSelectedIdx(0);
          setIsCommand(false);
          setIsSearchMode(false);
          setIsLineMode(initial.startsWith(":"));
          setSearchResults([]);
          setIsSymbolMode(initial.startsWith("@"));
          setFilteredCommands(registry.getAll());
          trap.activate();
          requestAnimationFrame(() => inputRef?.focus());

          if (props.workspaceRoot) {
            try {
              const result = await listWorkspaceFiles(props.workspaceRoot);
              setFiles(result);
              setFiltered(result.slice(0, 50));
            } catch {}
          }
        }
      }
    )
  );

  // Filter as user types
  createEffect(
    on(query, async (q) => {
      if (q.startsWith(":")) {
        setIsLineMode(true);
        setIsCommand(false);
        setIsSearchMode(false);
        setIsSymbolMode(false);
        setSelectedIdx(0);
        return;
      }

      setIsLineMode(false);

      if (q.startsWith("#")) {
        setIsSearchMode(true);
        setIsCommand(false);
        setSelectedIdx(0);

        const searchQuery = q.slice(1).trim();
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

        if (!searchQuery) {
          setSearchResults([]);
          setSearching(false);
          return;
        }

        setSearching(true);
        searchDebounceTimer = setTimeout(async () => {
          if (props.workspaceRoot) {
            try {
              const results = await workspaceSearch(props.workspaceRoot, searchQuery);
              setSearchResults(results);
            } catch {
              setSearchResults([]);
            }
          }
          setSearching(false);
        }, 300);
        return;
      }

      setIsSearchMode(false);
      if (q.startsWith("@")) {
        setIsSymbolMode(true);
        setIsCommand(false);
        setSelectedIdx(0);

        if (symbols().length === 0 && props.activeFilePath && props.workspaceRoot) {
          try {
            const syms = await lspDocumentSymbol(props.activeFilePath, props.workspaceRoot);
            setSymbols(syms);
          } catch {
            setSymbols([]);
          }
        }

        const symQuery = q.slice(1).trim();
        if (!symQuery) {
          setFilteredSymbols(symbols());
        } else {
          const scored = symbols()
            .map((s) => ({ sym: s, score: fuzzyMatch(symQuery, s.name) }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score);
          setFilteredSymbols(scored.map((x) => x.sym));
        }
        return;
      }

      setIsSymbolMode(false);

      if (q.startsWith(">")) {
        setIsCommand(true);
        const cmdQuery = q.slice(1).trim();
        setFiltered([]);
        setSelectedIdx(0);
        setFilteredCommands(registry.search(cmdQuery));
        return;
      }

      setIsCommand(false);
      setSelectedIdx(0);

      if (!q) {
        setFiltered(files().slice(0, 50));
        return;
      }

      const scored = files()
        .map((f) => ({ file: f, score: fuzzyMatch(q, f.relative_path) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 50);

      setFiltered(scored.map((x) => x.file));
    })
  );

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const max = isSearchMode() ? searchResults().length : isSymbolMode() ? filteredSymbols().length : isCommand() ? filteredCommands().length : filtered().length;
      setSelectedIdx(Math.min(selectedIdx() + 1, max - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(Math.max(selectedIdx() - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setSelectedIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      const max = isSearchMode() ? searchResults().length : isSymbolMode() ? filteredSymbols().length : isCommand() ? filteredCommands().length : filtered().length;
      setSelectedIdx(Math.max(max - 1, 0));
    } else if (e.key === "PageDown") {
      e.preventDefault();
      const max = isSearchMode() ? searchResults().length : isSymbolMode() ? filteredSymbols().length : isCommand() ? filteredCommands().length : filtered().length;
      setSelectedIdx(Math.min(selectedIdx() + 10, max - 1));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      setSelectedIdx(Math.max(selectedIdx() - 10, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isSearchMode()) {
        const result = searchResults()[selectedIdx()];
        if (result) {
          props.onFileSelect(result.path);
          props.onGoToLine?.(result.line_number, result.col);
          props.onClose();
        }
      } else if (isLineMode()) {
        const target = query().slice(1).trim();

        // Vim :s/pattern/replacement/flags substitution
        const subMatch = target.match(/^s\/(.+?)\/(.*)\/(\w*)$/);
        if (subMatch && props.activeEngine) {
          const [, pattern, replacement, flags] = subMatch;
          const global = flags.includes("g");
          const caseSensitive = !flags.includes("i");
          const eng = props.activeEngine;
          const matches = eng.findAll(pattern, { caseSensitive, regex: true });
          if (matches.length === 0) {
            showInfo("No matches found");
          } else {
            eng.beginUndoGroup();
            try {
              const toReplace = global ? [...matches].reverse() : [matches[0]];
              let re: RegExp;
              try { re = new RegExp(pattern, caseSensitive ? "" : "i"); } catch { re = new RegExp(""); }
              for (const m of toReplace) {
                const line = eng.getLine(m.line);
                const matched = line.substring(m.start_col, m.end_col);
                const replText = matched.replace(re, replacement);
                eng.deleteRange({ line: m.line, col: m.start_col }, { line: m.line, col: m.end_col });
                if (replText) { eng.setCursor({ line: m.line, col: m.start_col }); eng.insert(replText); }
              }
            } finally { eng.endUndoGroup(); }
            showInfo(`Replaced ${global ? matches.length : 1} occurrence${global && matches.length !== 1 ? "s" : ""}`);
          }
          props.onClose();
          return;
        }

        const match = target.match(/^(\d+)(?::(\d+))?$/);
        if (match && props.onGoToLine) {
          const line = Math.max(0, Number.parseInt(match[1], 10) - 1);
          const col = Math.max(0, Number.parseInt(match[2] ?? "1", 10) - 1);
          props.onGoToLine(line, col);
          props.onClose();
        }
      } else if (isSymbolMode()) {
        const sym = filteredSymbols()[selectedIdx()];
        if (sym && props.onGoToLine) {
          props.onGoToLine(sym.line, sym.col);
          props.onClose();
        }
      } else if (isCommand()) {
        const cmd = filteredCommands()[selectedIdx()];
        if (cmd) { cmd.execute(); props.onClose(); }
      } else {
        const file = filtered()[selectedIdx()];
        if (file) {
          props.onFileSelect(file.path);
          props.onClose();
        }
      }
    }
  }

  // Cleanup when palette closes
  createEffect(on(() => props.visible, (visible) => {
    if (!visible) {
      trap.deactivate();
      setIsSearchMode(false);
      setIsLineMode(false);
      setSearchResults([]);
      setSearching(false);
      setIsSymbolMode(false);
      setSymbols([]);
      setFilteredSymbols([]);
      setFilteredCommands([]);
      if (searchDebounceTimer) { clearTimeout(searchDebounceTimer); searchDebounceTimer = null; }
    }
  }));

  function handleBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains("palette-backdrop")) {
      props.onClose();
    }
  }

  return (
    <div
      class="palette-backdrop"
      style={{ display: props.visible ? "flex" : "none" }}
      onClick={handleBackdropClick}
    >
      <div ref={paletteRef} class="palette" onKeyDown={handleKeyDown}>
        <input
          ref={inputRef}
          class="palette-input"
          type="text"
          placeholder={isSearchMode() ? "Search file contents..." : isLineMode() ? "Go to line[:column]..." : isSymbolMode() ? "Search symbols by name..." : props.workspaceRoot ? "Search files by name... (: line, # content, @ symbols, > commands)" : "Open a folder first (: line, > commands)"}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <div class="palette-results">
          <Show when={isSearchMode()}>
            <For each={searchResults()}>
              {(result, idx) => {
                const fileName = basename(result.path) || result.path;
                const truncated = result.line_content.length > 60
                  ? result.line_content.substring(0, 60) + "..."
                  : result.line_content;
                return (
                  <div
                    class={`palette-item ${idx() === selectedIdx() ? "palette-item-active" : ""}`}
                    onClick={() => {
                      props.onFileSelect(result.path);
                      props.onGoToLine?.(result.line_number, result.col);
                      props.onClose();
                    }}
                  >
                    <span class="palette-item-icon">~</span>
                    <div style={{ "min-width": "0", flex: "1" }}>
                      <div class="palette-item-name">{fileName}:{result.line_number} — {truncated}</div>
                      <div class="palette-item-path">{result.relative_path}</div>
                    </div>
                  </div>
                );
              }}
            </For>
            <Show when={searching()}>
              <div class="palette-empty"><span class="spinner spinner-sm" style={{ "margin-right": "8px" }} /> Searching...</div>
            </Show>
            <Show when={!searching() && searchResults().length === 0 && query().slice(1).trim()}>
              <div class="palette-empty">No matches found</div>
            </Show>
          </Show>
          <Show when={isLineMode()}>
            <div class="palette-empty">line[:col] or s/find/replace/g</div>
          </Show>
          <Show when={isSymbolMode()}>
            <For each={filteredSymbols()}>
              {(sym, idx) => (
                <div
                  class={`palette-item ${idx() === selectedIdx() ? "palette-item-active" : ""}`}
                  onClick={() => {
                    if (props.onGoToLine) {
                      props.onGoToLine(sym.line, sym.col);
                      props.onClose();
                    }
                  }}
                >
                  <span class="palette-item-icon">{symbolKindAbbrev(sym.kind)}</span>
                  <span class="palette-item-name">{sym.name}</span>
                  <span class="palette-item-path">{":" + (sym.line + 1)}</span>
                </div>
              )}
            </For>
            <Show when={filteredSymbols().length === 0 && query().length > 1}>
              <div class="palette-empty">No symbols found</div>
            </Show>
          </Show>
          <Show when={isCommand() && !isSearchMode() && !isLineMode() && !isSymbolMode()}>
            <For each={filteredCommands()}>
              {(cmd, idx) => (
                <div
                  class={`palette-item ${idx() === selectedIdx() ? "palette-item-active" : ""}`}
                  onClick={() => { cmd.execute(); props.onClose(); }}
                >
                  <span class="palette-item-icon">{">"}</span>
                  <span class="palette-item-name">{cmd.label}</span>
                  <Show when={cmd.keybinding}>
                    <span class="palette-item-keybinding">{formatKeybinding(cmd.keybinding)}</span>
                  </Show>
                </div>
              )}
            </For>
          </Show>
          <Show when={!isCommand() && !isSearchMode() && !isLineMode() && !isSymbolMode()}>
            {/* Recent files — shown when query is empty */}
            <Show when={!query() && props.recentFiles && props.recentFiles.length > 0}>
              <div class="palette-section-label">Recent</div>
              <For each={props.recentFiles!}>
                {(file, idx) => (
                  <div
                    class={`palette-item ${idx() === selectedIdx() ? "palette-item-active" : ""}`}
                    onClick={() => {
                      props.onFileSelect(file.path);
                      props.onClose();
                    }}
                  >
                    <span class="palette-item-icon">~</span>
                    <span class="palette-item-name">{file.name}</span>
                    <span class="palette-item-path">{basename(dirname(file.path)) || ""}</span>
                  </div>
                )}
              </For>
            </Show>
            <For each={filtered()}>
              {(file, idx) => {
                const adjustedIdx = () => (!query() && props.recentFiles ? idx() + props.recentFiles.length : idx());
                return (
                  <div
                    class={`palette-item ${adjustedIdx() === selectedIdx() ? "palette-item-active" : ""}`}
                    onClick={() => {
                      props.onFileSelect(file.path);
                      props.onClose();
                    }}
                  >
                    <span class="palette-item-icon">#</span>
                    <span class="palette-item-name">{file.name}</span>
                    <span class="palette-item-path">{file.relative_path}</span>
                  </div>
                );
              }}
            </For>
          </Show>
          <Show when={isCommand() && filteredCommands().length === 0}>
            <div class="palette-empty">No commands found</div>
          </Show>
          <Show when={!isCommand() && !isSearchMode() && !isLineMode() && !isSymbolMode() && filtered().length === 0 && query()}>
            <div class="palette-empty">No files found</div>
          </Show>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
