/**
 * Panel renderer — creates and caches tab panel components.
 *
 * Uses the panel registry for non-file panel types.
 * The file tab is handled separately due to its unique concerns
 * (breadcrumbs, blog mode, editor engine lifecycle).
 */

import { createSignal, createEffect, createRoot, Show, type Accessor, type JSX } from "solid-js";
import CanvasEditor from "../editor/CanvasEditor";
import BlogPreview from "./BlogPreview";
import CanvasBreadcrumbs from "./CanvasBreadcrumbs";
import type { Tab } from "../lib/tab-types";
import type { PanelDeps, FileTabDeps } from "../lib/panel-registry";
import { getPanel } from "../lib/panel-registry";
import { relativeTo } from "buster-path";

// Ensure all panel types are registered
import "../lib/panel-definitions";

export interface PanelRendererDeps extends PanelDeps, FileTabDeps {}

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
    // Check panel registry for non-file types
    const def = getPanel(tab.type);
    if (def) {
      return wrapPanel(tab.id, def.render(tab, isActive, deps));
    }

    // File tab (default) — has unique breadcrumb/blog/engine concerns
    return renderFileTab(tab, isActive);
  }

  function renderFileTab(tab: Tab, isActive: Accessor<boolean>): JSX.Element {
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
