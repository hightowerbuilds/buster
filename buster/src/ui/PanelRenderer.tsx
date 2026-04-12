/**
 * Panel renderer — creates and caches tab panel components.
 * Extracted from App.tsx.
 */

import { createSignal, createEffect, createRoot, Show, type Accessor, type JSX } from "solid-js";
import CanvasEditor from "../editor/CanvasEditor";
import CanvasTerminal from "./CanvasTerminal";
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
import DisplayListSurface from "./DisplayListSurface";
import CanvasBreadcrumbs from "./CanvasBreadcrumbs";
import type { Tab } from "../lib/tab-types";
import type { SearchMatch, DiffHunk } from "../lib/ipc";
import type { AppSettings } from "../lib/ipc";
import type { EditorEngine } from "../editor/engine";
import { basename, relativeTo } from "buster-path";

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
  switchToTab: (id: string) => void;
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

  function wrapPanel(tabId: string, content: JSX.Element): JSX.Element {
    const syncActiveTab = () => {
      if (deps.activeTabId() !== tabId) deps.switchToTab(tabId);
    };

    return (
      <div
        class="tab-panel-host"
        data-tab-panel-id={tabId}
        style={{ width: "100%", height: "100%" }}
        onPointerDown={syncActiveTab}
        onFocusIn={syncActiveTab}
      >
        {content}
      </div>
    );
  }

  function createPanelElement(tab: Tab, isActive: Accessor<boolean>): JSX.Element {
    if (tab.type === "terminal") {
      return wrapPanel(tab.id, (
        <CanvasTerminal
          termTabId={tab.id}
          active={isActive()}
          cwd={deps.workspaceRoot() ?? undefined}
          onTermIdReady={deps.handleTermIdReady}
          autoFocus={tab.id === deps.activeTabId()}
        />
      ));
    }

    if (tab.type === "settings") {
      return wrapPanel(tab.id, (
        <SettingsPanel
          settings={deps.settings()}
          onChange={deps.updateSettings}
        />
      ));
    }

    if (tab.type === "git") {
      return wrapPanel(tab.id, (
        <GitPage
          active={isActive()}
          workspaceRoot={deps.workspaceRoot() ?? undefined}
          onFileSelect={deps.handleFileSelect}
        />
      ));
    }

    if (tab.type === "extensions") {
      return wrapPanel(tab.id, <ExtensionsPage />);
    }

    if (tab.type === "search-results") {
      return wrapPanel(tab.id, (
        <SearchResultsPanel
          workspaceRoot={deps.workspaceRoot()}
          onFileSelect={async (path, line, col) => {
            await deps.handleFileSelect(path);
            deps.setCursorLine(line);
            deps.setCursorCol(col);
          }}
        />
      ));
    }

    if (tab.type === "problems") {
      return wrapPanel(tab.id, (
        <ProblemsPanel
          diagnosticsMap={deps.diagnosticsMap()}
          onJumpTo={async (filePath, line, col) => {
            await deps.handleFileSelect(filePath);
            deps.setCursorLine(line);
            deps.setCursorCol(col);
          }}
        />
      ));
    }

    if (tab.type === "manual") {
      return wrapPanel(tab.id, <ManualTab />);
    }

    if (tab.type === "debug") {
      return wrapPanel(tab.id, <DebugPanel />);
    }

    if (tab.type === "explorer") {
      return wrapPanel(tab.id, (
        <Sidebar
          onFileSelect={deps.handleFileSelect}
          workspaceRoot={deps.workspaceRoot()}
          onFolderOpen={(path) => deps.openWorkspace(path)}
          onChangeDirectory={deps.changeDirectory}
          onCloseDirectory={deps.closeDirectory}
          poppedOut={true}
          onReturn={() => deps.handleTabClose("explorer_tab")}
        />
      ));
    }

    if (tab.type === "image" && tab.path) {
      return wrapPanel(tab.id, (
        <ImageViewer
          filePath={tab.path}
          fileName={tab.name}
        />
      ));
    }

    if (tab.type === "surface") {
      const meta = JSON.parse(tab.path || "{}");
      return wrapPanel(tab.id, (
        <DisplayListSurface
          surfaceId={meta.surface_id ?? 0}
          extensionId={meta.extension_id ?? ""}
          initialWidth={meta.width ?? 800}
          initialHeight={meta.height ?? 600}
          label={tab.name}
          isActive={isActive}
        />
      ));
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
      const rel = root ? relativeTo(fp, root) : fp;
      return rel.split("/");
    };

    return wrapPanel(tab.id, (
      <div style={{ width: "100%", height: "100%", position: "relative", display: "flex", "flex-direction": "column" }}>
        <Show when={breadcrumbs().length > 1}>
          <CanvasBreadcrumbs segments={breadcrumbs()} />
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
            active={isActive()}
            autoFocus={tab.id === deps.activeTabId()}
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
    ));
  }

  return { renderPanel, blogModeSet };
}
