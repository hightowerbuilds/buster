import { Component, For, Show, createSignal, createEffect, on } from "solid-js";
import { workspaceSearch, type WorkspaceSearchResult } from "../lib/ipc";
import { basename } from "buster-path";

interface SearchResultsProps {
  workspaceRoot: string | null;
  initialQuery?: string;
  onFileSelect: (path: string, line: number, col: number) => void;
}

interface FileGroup {
  file: string;
  name: string;
  matches: WorkspaceSearchResult[];
}

const SearchResultsPanel: Component<SearchResultsProps> = (props) => {
  let inputRef: HTMLInputElement | undefined;
  const [query, setQuery] = createSignal(props.initialQuery ?? "");
  const [results, setResults] = createSignal<FileGroup[]>([]);
  const [totalMatches, setTotalMatches] = createSignal(0);
  const [searching, setSearching] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set());

  async function runSearch() {
    const q = query().trim();
    if (!q || !props.workspaceRoot) {
      setResults([]);
      setTotalMatches(0);
      return;
    }
    setSearching(true);
    try {
      const raw = await workspaceSearch(props.workspaceRoot, q);
      // Group by file
      const groups = new Map<string, WorkspaceSearchResult[]>();
      for (const m of raw) {
        const file = m.path;
        if (!groups.has(file)) groups.set(file, []);
        groups.get(file)!.push(m);
      }
      const fileGroups: FileGroup[] = [];
      for (const [file, matches] of groups) {
        const name = basename(file) || file;
        fileGroups.push({ file, name, matches });
      }
      fileGroups.sort((a, b) => b.matches.length - a.matches.length);
      setResults(fileGroups);
      setTotalMatches(raw.length);
    } catch {
      setResults([]);
      setTotalMatches(0);
    }
    setSearching(false);
  }

  function toggleCollapse(file: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }

  // Auto-search on initial query
  createEffect(on(() => props.initialQuery, (q) => {
    if (q) { setQuery(q); runSearch(); }
  }));

  return (
    <div class="search-results-panel">
      <div class="search-results-header">
        <input
          ref={inputRef}
          class="search-results-input"
          type="text"
          placeholder="Search in workspace..."
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
        />
        <button class="search-results-btn" onClick={runSearch}>
          {searching() ? "..." : "Search"}
        </button>
      </div>
      <div class="search-results-summary">
        <Show when={totalMatches() > 0}>
          {totalMatches()} match{totalMatches() === 1 ? "" : "es"} in {results().length} file{results().length === 1 ? "" : "s"}
        </Show>
        <Show when={totalMatches() === 0 && query().trim() && !searching()}>
          No results
        </Show>
      </div>
      <div class="search-results-body">
        <For each={results()}>
          {(group) => (
            <div class="search-results-group">
              <div
                class="search-results-file"
                onClick={() => toggleCollapse(group.file)}
              >
                <span class="search-results-arrow">{collapsed().has(group.file) ? ">" : "v"}</span>
                <span class="search-results-filename">{group.name}</span>
                <span class="search-results-count">{group.matches.length}</span>
              </div>
              <Show when={!collapsed().has(group.file)}>
                <For each={group.matches}>
                  {(m) => {
                    const q = query();
                    const hlStart = m.col;
                    const hlEnd = m.col + q.length;
                    return (
                      <div
                        class="search-results-match"
                        onClick={() => props.onFileSelect(m.path, m.line_number, m.col)}
                      >
                        <span class="search-results-line-num">{m.line_number + 1}</span>
                        <span class="search-results-context">
                          {m.line_content.slice(0, hlStart)}
                          <span class="search-results-highlight">
                            {m.line_content.slice(hlStart, hlEnd)}
                          </span>
                          {m.line_content.slice(hlEnd)}
                        </span>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default SearchResultsPanel;
