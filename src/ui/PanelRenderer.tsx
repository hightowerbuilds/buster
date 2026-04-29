/**
 * Panel renderer — creates and caches tab panel components.
 *
 * Uses the panel registry for non-file panel types.
 * The file tab is handled separately due to its unique concerns
 * (breadcrumbs, blog mode, editor engine lifecycle).
 */

import { createSignal, createEffect, createMemo, createRoot, Show, type Accessor, type JSX } from "solid-js";
import CanvasEditor from "../editor/CanvasEditor";
import BlogPreview from "./BlogPreview";
import CanvasBreadcrumbs from "./CanvasBreadcrumbs";
import type { Tab } from "../lib/tab-types";
import type { PanelDeps, FileTabDeps } from "../lib/panel-registry";
import { getPanel } from "../lib/panel-registry";
import { lspDocumentSymbol, type LspDocumentSymbol } from "../lib/ipc";
import { symbolBreadcrumbChain } from "../editor/symbol-breadcrumbs";
import { relativeTo } from "buster-path";
import { resolveEditorSettings } from "../lib/editor-settings";

// Ensure all panel types are registered
import "../lib/panel-definitions";

export interface PanelRendererDeps extends PanelDeps, FileTabDeps {}

export function createPanelRenderer(deps: PanelRendererDeps) {
  const panelCache = new Map<string, { element: JSX.Element; dispose: () => void; setActive: (value: boolean) => void }>();
  const [blogModeSet, setBlogModeSet] = createSignal<Set<string>>(new Set());

  // Remove closed tabs from the panel cache.
  // We intentionally do NOT call cached.dispose() — on macOS/WKWebView,
  // disposing the SolidJS root triggers WebGL teardown which crashes with
  // CFRelease(NULL). Instead we just drop the reference and let GC handle it.
  createEffect(() => {
    const currentIds = new Set(deps.tabs().map(t => t.id));
    for (const [id] of panelCache) {
      if (!currentIds.has(id)) {
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
    const currentTab = () => deps.tabs().find(t => t.id === tab.id) ?? tab;
    const languagePath = () => currentTab().path || currentTab().name || null;

    const isMd = tab.path?.endsWith(".md") || tab.path?.endsWith(".markdown");
    const blogActive = () => blogModeSet().has(tab.id);
    const editorSettings = () => resolveEditorSettings(deps.settings(), tab.path || null);
    const previewText = () => {
      const engine = deps.engineMap.get(tab.id);
      engine?.editSeq();
      return engine?.getText() ?? initialText;
    };
    const [symbols, setSymbols] = createSignal<LspDocumentSymbol[]>([]);
    let symbolRequestSeq = 0;

    createEffect(() => {
      const active = isActive();
      const root = deps.workspaceRoot();
      const fp = currentTab().path;
      if (!active || !root || !fp) {
        setSymbols([]);
        return;
      }

      const requestSeq = ++symbolRequestSeq;
      lspDocumentSymbol(fp, root)
        .then((next) => {
          if (requestSeq === symbolRequestSeq) setSymbols(next);
        })
        .catch(() => {
          if (requestSeq === symbolRequestSeq) setSymbols([]);
        });
    });

    const symbolSegments = createMemo(() => {
      if (!isActive()) return [];
      return symbolBreadcrumbChain(symbols(), deps.cursorLine(), deps.cursorCol())
        .map((symbol) => symbol.name);
    });

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
          <CanvasBreadcrumbs segments={breadcrumbs()} symbolSegments={symbolSegments()} />
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
        <div style={{ width: "100%", height: "100%", flex: "1", "min-height": "0", display: "flex" }}>
          <div style={{
            width: blogActive() ? "50%" : "100%",
            height: "100%",
            "min-width": "0",
            display: "flex",
          }}>
          <CanvasEditor
            initialText={initialText}
            filePath={tab.path || null}
            languagePath={languagePath}
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
            currentSearchIdx={isActive() ? deps.currentSearchIdx() : -1}
            wordWrap={editorSettings().word_wrap}
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
            <div class="markdown-side-preview">
              <BlogPreview
                text={previewText()}
                fontSize={deps.settings().font_size}
                theme={deps.settings().blog_theme}
              />
            </div>
          </Show>
        </div>
      </div>
    ));
  }

  return { renderPanel, blogModeSet };
}
