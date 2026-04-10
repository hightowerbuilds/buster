import { Component, createSignal, createEffect, on, For, Show } from "solid-js";
import { listWorkspaceFiles, aiChat, workspaceSearch, lspDocumentSymbol } from "../lib/ipc";
import type { WorkspaceFile, AiChatRequest, WorkspaceSearchResult, LspDocumentSymbol } from "../lib/ipc";
import { listen } from "@tauri-apps/api/event";
import { workspaceRoot as globalWorkspaceRoot, apiKey as globalApiKey } from "../lib/app-state";
import { createFocusTrap } from "../lib/a11y";
import { basename, dirname } from "buster-path";

interface CommandPaletteProps {
  visible: boolean;
  workspaceRoot: string | null;
  onClose: () => void;
  onFileSelect: (path: string) => void;
  onGoToLine?: (line: number, col: number) => void;
  onNewTerminal: () => void;
  onOpenManual?: () => void;
  onNewAiChat?: () => void;
  onGitGraph?: () => void;
  initialQuery?: string;
  activeFilePath?: string | null;
  recentFiles?: { path: string; name: string }[];
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
      // Bonus for consecutive matches
      if (lastMatchIdx === ti - 1) score += 2;
      // Bonus for matching at word boundaries
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

const CommandPalette: Component<CommandPaletteProps> = (props) => {
  let inputRef: HTMLInputElement | undefined;

  const commands = [
    { name: "New Terminal", action: () => { props.onNewTerminal(); props.onClose(); } },
    { name: "Open Manual", action: () => { props.onOpenManual?.(); props.onClose(); } },
    { name: "AI Agent", action: () => { props.onNewAiChat?.(); props.onClose(); } },
    { name: "Git", action: () => { props.onGitGraph?.(); props.onClose(); } },
  ];

  const [query, setQuery] = createSignal("");
  const [files, setFiles] = createSignal<WorkspaceFile[]>([]);
  const [filtered, setFiltered] = createSignal<WorkspaceFile[]>([]);
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [isCommand, setIsCommand] = createSignal(false);
  const [isAiMode, setIsAiMode] = createSignal(false);
  const [isSearchMode, setIsSearchMode] = createSignal(false);
  const [searchResults, setSearchResults] = createSignal<WorkspaceSearchResult[]>([]);
  const [isLineMode, setIsLineMode] = createSignal(false);
  const [isSymbolMode, setIsSymbolMode] = createSignal(false);
  const [symbols, setSymbols] = createSignal<LspDocumentSymbol[]>([]);
  const [filteredSymbols, setFilteredSymbols] = createSignal<LspDocumentSymbol[]>([]);
  const [filteredCommands, setFilteredCommands] = createSignal(commands);
  const [aiResponse, setAiResponse] = createSignal("");
  const [aiLoading, setAiLoading] = createSignal(false);
  let aiUnlisten: (() => void) | null = null;
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
          setFilteredCommands(commands);
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
        setIsAiMode(false);
        setIsCommand(false);
        setIsSearchMode(false);
        setIsSymbolMode(false);
        setSelectedIdx(0);
        return;
      }

      setIsLineMode(false);

      if (q.startsWith("?")) {
        setIsAiMode(true);
        setIsCommand(false);
        setIsSearchMode(false);
        setIsSymbolMode(false);
        return;
      }

      setIsAiMode(false);

      if (q.startsWith("#")) {
        setIsSearchMode(true);
        setIsCommand(false);
        setSelectedIdx(0);

        const searchQuery = q.slice(1).trim();
        // Clear previous debounce
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

        if (!searchQuery) {
          setSearchResults([]);
          return;
        }

        // Debounce 300ms before calling backend
        searchDebounceTimer = setTimeout(async () => {
          if (props.workspaceRoot) {
            try {
              const results = await workspaceSearch(props.workspaceRoot, searchQuery);
              setSearchResults(results);
            } catch {
              setSearchResults([]);
            }
          }
        }, 300);
        return;
      }

      setIsSearchMode(false);
      if (q.startsWith("@")) {
        setIsSymbolMode(true);
        setIsCommand(false);
        setSelectedIdx(0);

        // Load symbols if not already loaded
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
        if (!cmdQuery) {
          setFilteredCommands(commands);
          return;
        }
        const scored = commands
          .map((cmd) => ({ cmd, score: fuzzyMatch(cmdQuery, cmd.name) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score);
        setFilteredCommands(scored.map((x) => x.cmd));
        return;
      }

      setIsCommand(false);
      setFilteredCommands(commands);
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
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isAiMode()) {
        const q = query().slice(1).trim();
        if (q && !aiLoading()) {
          sendAiQuery(q);
        }
      } else if (isSearchMode()) {
        const result = searchResults()[selectedIdx()];
        if (result) {
          props.onFileSelect(result.path);
          props.onGoToLine?.(result.line_number, result.col);
          props.onClose();
        }
      } else if (isLineMode()) {
        const target = query().slice(1).trim();
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
        if (cmd) cmd.action();
      } else {
        const file = filtered()[selectedIdx()];
        if (file) {
          props.onFileSelect(file.path);
          props.onClose();
        }
      }
    }
  }

  async function sendAiQuery(q: string) {
    setAiResponse("");
    setAiLoading(true);

    const apiKey = globalApiKey() || "";
    if (!apiKey) {
      setAiResponse("No API key set. Open AI Agent tab first to configure.");
      setAiLoading(false);
      return;
    }

    // Listen for streaming events
    if (aiUnlisten) { aiUnlisten(); aiUnlisten = null; }
    aiUnlisten = (await listen<{ kind: string; content: string }>("ai-event", (event) => {
      const { kind, content } = event.payload;
      if (kind === "text") {
        setAiResponse((prev) => prev + content);
      } else if (kind === "done" || kind === "error") {
        setAiLoading(false);
        if (kind === "error" && content) {
          setAiResponse((prev) => prev + "\n[Error: " + content + "]");
        }
      }
    })) as unknown as () => void;

    try {
      await aiChat({
        prompt: q,
        api_key: apiKey,
        workspace_root: globalWorkspaceRoot() ?? undefined,
      } as AiChatRequest);
    } catch (err) {
      setAiResponse("Request failed");
      setAiLoading(false);
    }
  }

  // Cleanup AI listener and search state when palette closes
  // Cleanup when palette closes
  createEffect(on(() => props.visible, (visible) => {
    if (!visible) {
      trap.deactivate();
      setAiResponse("");
      setAiLoading(false);
      setIsAiMode(false);
      setIsSearchMode(false);
      setIsLineMode(false);
      setSearchResults([]);
      setIsSymbolMode(false);
      setSymbols([]);
      setFilteredSymbols([]);
      setFilteredCommands(commands);
      if (aiUnlisten) { aiUnlisten(); aiUnlisten = null; }
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
          placeholder={isAiMode() ? "Ask a question... (Enter to send)" : isSearchMode() ? "Search file contents..." : isLineMode() ? "Go to line[:column]..." : isSymbolMode() ? "Search symbols by name..." : props.workspaceRoot ? "Search files by name... (: line, # content, @ symbols, ? AI, > commands)" : "Open a folder first (: line, ? AI, > commands)"}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <div class="palette-results">
          <Show when={isAiMode()}>
            <div class="palette-ai-response">
              <Show when={aiResponse()}>
                <pre class="palette-ai-text">{aiResponse()}</pre>
              </Show>
              <Show when={aiLoading() && !aiResponse()}>
                <div class="palette-empty">Thinking...</div>
              </Show>
              <Show when={!aiLoading() && !aiResponse()}>
                <div class="palette-empty">Type a question and press Enter</div>
              </Show>
            </div>
          </Show>
          <Show when={isSearchMode() && !isAiMode()}>
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
            <Show when={searchResults().length === 0 && query().slice(1).trim()}>
              <div class="palette-empty">No matches found</div>
            </Show>
          </Show>
          <Show when={isLineMode() && !isAiMode()}>
            <div class="palette-empty">Enter `line` or `line:column` and press Enter</div>
          </Show>
          <Show when={isSymbolMode() && !isAiMode()}>
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
          <Show when={isCommand() && !isAiMode() && !isSearchMode() && !isLineMode() && !isSymbolMode()}>
            <For each={filteredCommands()}>
              {(cmd, idx) => (
                <div
                  class={`palette-item ${idx() === selectedIdx() ? "palette-item-active" : ""}`}
                  onClick={() => cmd.action()}
                >
                  <span class="palette-item-icon">{">"}</span>
                  <span class="palette-item-name">{cmd.name}</span>
                </div>
              )}
            </For>
          </Show>
          <Show when={!isCommand() && !isAiMode() && !isSearchMode() && !isLineMode() && !isSymbolMode()}>
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
          <Show when={!isCommand() && !isAiMode() && !isSearchMode() && !isLineMode() && !isSymbolMode() && filtered().length === 0 && query()}>
            <div class="palette-empty">No files found</div>
          </Show>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
