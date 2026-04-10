/**
 * Panel renderer — creates and caches tab panel components.
 * Extracted from App.tsx.
 */

import { createSignal, createEffect, createRoot, Show, type Accessor, type JSX } from "solid-js";
import CanvasEditor from "../editor/CanvasEditor";
import CanvasTerminal from "./CanvasTerminal";
import AiChat from "./AiChat";
import SettingsPanel from "./SettingsPanel";
import GitPage from "./GitPage";
import ExtensionsPage from "./ExtensionsPage";
import ManualTab from "./ManualTab";
import DebugPanel from "./DebugPanel";
import ProblemsPanel from "./ProblemsPanel";
import SearchResultsPanel from "./SearchResultsPanel";
import Sidebar from "./Sidebar";
import BlogPreview from "./BlogPreview";
import ImageViewer from "./ImageViewer";
import type { Tab } from "../lib/tab-types";
import type { SearchMatch, DiffHunk } from "../lib/ipc";
import type { AppSettings } from "../lib/ipc";
import type { EditorEngine } from "../editor/engine";

interface Diagnostic {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  severity: number;
  message: string;
}

export interface PanelRendererDeps {
  workspaceRoot: () => string | null;
  settings: () => AppSettings;
  updateSettings: (s: AppSettings) => void;
  tabs: () => Tab[];
  activeTabId: () => string | null;
  searchMatches: () => SearchMatch[];
  diagnosticsMap: () => Map<string, Diagnostic[]>;
  diffHunksMap: () => Record<string, DiffHunk[]>;
  handleFileSelect: (path: string) => Promise<void>;
  handleTermIdReady: (tabId: string, termId: string) => void;
  handleTabClose: (id: string) => void;
  openWorkspace: (path: string) => void;
  changeDirectory: () => void;
  closeDirectory: () => void;
  setCursorLine: (line: number) => void;
  setCursorCol: (col: number) => void;
  setTabs: (fn: (prev: Tab[]) => Tab[]) => void;
  engineMap: Map<string, EditorEngine>;
  getFileTextForTab: (tabId: string) => string | null;
}

export function createPanelRenderer(deps: PanelRendererDeps) {
  const panelCache = new Map<string, { element: JSX.Element; dispose: () => void; setActive: (value: boolean) => void }>();
  const [blogModeSet, setBlogModeSet] = createSignal<Set<string>>(new Set());

  // Clean up cached panels when tabs are closed
  createEffect(() => {
    const currentIds = new Set(deps.tabs().map(t => t.id));
    for (const [id, cached] of panelCache) {
      if (!currentIds.has(id)) {
        cached.dispose();
        panelCache.delete(id);
      }
    }
  });

  function renderPanel(tab: Tab, isActive: boolean): JSX.Element {
    const cached = panelCache.get(tab.id);
    if (cached) {
      cached.setActive(isActive);
      return cached.element;
    }

    let element!: JSX.Element;
    createRoot((d) => {
      const [active, setActive] = createSignal(isActive);
      element = createPanelElement(tab, active);
      panelCache.set(tab.id, { element, dispose: d, setActive });
      return d;
    });
    return element;
  }

  function createPanelElement(tab: Tab, isActive: Accessor<boolean>): JSX.Element {
    if (tab.type === "terminal") {
      return (
        <CanvasTerminal
          termTabId={tab.id}
          active={isActive()}
          cwd={deps.workspaceRoot() ?? undefined}
          onTermIdReady={deps.handleTermIdReady}
        />
      );
    }

    if (tab.type === "ai") {
      return (
        <AiChat
          active={isActive()}
          workspaceRoot={deps.workspaceRoot() ?? undefined}
          settings={deps.settings()}
          onSettingsChange={deps.updateSettings}
        />
      );
    }

    if (tab.type === "settings") {
      return (
        <SettingsPanel
          settings={deps.settings()}
          onChange={deps.updateSettings}
        />
      );
    }

    if (tab.type === "git") {
      return (
        <GitPage
          active={isActive()}
          workspaceRoot={deps.workspaceRoot() ?? undefined}
          onFileSelect={deps.handleFileSelect}
        />
      );
    }

    if (tab.type === "extensions") {
      return <ExtensionsPage />;
    }

    if (tab.type === "search-results") {
      return (
        <SearchResultsPanel
          workspaceRoot={deps.workspaceRoot()}
          onFileSelect={async (path, line, col) => {
            await deps.handleFileSelect(path);
            deps.setCursorLine(line);
            deps.setCursorCol(col);
          }}
        />
      );
    }

    if (tab.type === "problems") {
      return (
        <ProblemsPanel
          diagnosticsMap={deps.diagnosticsMap()}
          onJumpTo={async (filePath, line, col) => {
            await deps.handleFileSelect(filePath);
            deps.setCursorLine(line);
            deps.setCursorCol(col);
          }}
        />
      );
    }

    if (tab.type === "manual") {
      return <ManualTab />;
    }

    if (tab.type === "debug") {
      return <DebugPanel />;
    }

    if (tab.type === "explorer") {
      return (
        <Sidebar
          onFileSelect={deps.handleFileSelect}
          workspaceRoot={deps.workspaceRoot()}
          onFolderOpen={(path) => deps.openWorkspace(path)}
          onChangeDirectory={deps.changeDirectory}
          onCloseDirectory={deps.closeDirectory}
          poppedOut={true}
          onReturn={() => deps.handleTabClose("explorer_tab")}
        />
      );
    }

    if (tab.type === "image" && tab.path) {
      return (
        <ImageViewer
          filePath={tab.path}
          fileName={tab.name}
        />
      );
    }

    // File tab
    const existingEngine = deps.engineMap.get(tab.id);
    const initialText = existingEngine ? existingEngine.getText() : deps.getFileTextForTab(tab.id);
    if (initialText === null) return <div class="panel-empty" />;

    const isMd = tab.path?.endsWith(".md") || tab.path?.endsWith(".markdown");
    const blogActive = () => blogModeSet().has(tab.id);
    const toggleBlog = () => {
      setBlogModeSet(prev => {
        const next = new Set(prev);
        if (next.has(tab.id)) next.delete(tab.id);
        else next.add(tab.id);
        return next;
      });
    };

    // Breadcrumb segments from file path relative to workspace
    const breadcrumbs = () => {
      const root = deps.workspaceRoot();
      const fp = tab.path;
      if (!fp) return [];
      let rel = root && fp.startsWith(root) ? fp.slice(root.length).replace(/^\//, "") : fp;
      return rel.split("/");
    };

    return (
      <div style={{ width: "100%", height: "100%", position: "relative", display: "flex", "flex-direction": "column" }}>
        <Show when={breadcrumbs().length > 1}>
          <div class="breadcrumb-bar" aria-label="File path breadcrumbs">
            {breadcrumbs().map((seg, i) => (
              <>
                {i > 0 && <span class="breadcrumb-sep">/</span>}
                <span class={`breadcrumb-seg${i === breadcrumbs().length - 1 ? " breadcrumb-active" : ""}`}>{seg}</span>
              </>
            ))}
          </div>
        </Show>
        {isMd && (
          <button
            class={`blog-mode-toggle${blogActive() ? " active" : ""}`}
            onClick={toggleBlog}
            aria-pressed={blogActive()}
          >
            Blog Mode
          </button>
        )}
        <div style={{ width: "100%", height: "100%", flex: "1", "min-height": "0", display: blogActive() ? "none" : "flex" }}>
          <CanvasEditor
            initialText={initialText}
            filePath={tab.path || null}
            onEngineReady={(engine) => { deps.engineMap.set(tab.id, engine); }}
            onDirtyChange={(dirty) => {
              const current = deps.tabs().find(t => t.id === tab.id);
              if (current && current.dirty !== dirty) {
                deps.setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, dirty } : t));
              }
            }}
            onCursorChange={(line, col) => {
              if (tab.id === deps.activeTabId()) {
                deps.setCursorLine(line);
                deps.setCursorCol(col);
              }
            }}
            searchMatches={isActive() ? deps.searchMatches() : []}
            wordWrap={deps.settings().word_wrap}
            fontSize={deps.settings().font_size}
            lineNumbers={deps.settings().line_numbers}
            autocomplete={deps.settings().autocomplete}
            diagnostics={deps.diagnosticsMap().get(tab.path) ?? []}
            diffHunks={deps.diffHunksMap()[tab.id] ?? []}
            minimap={deps.settings().minimap}
            onGoToFile={async (path, line, col) => {
              await deps.handleFileSelect(path);
              deps.setCursorLine(line);
              deps.setCursorCol(col);
            }}
          />
        </div>
        <Show when={blogActive()}>
          <BlogPreview
            text={deps.engineMap.get(tab.id)?.getText() ?? initialText}
            fontSize={deps.settings().font_size}
          />
        </Show>
      </div>
    );
  }

  return { renderPanel, blogModeSet };
}
