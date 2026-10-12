/**
 * Panel renderer — creates and caches tab panel components.
 *
 * Uses the panel registry for non-file panel types.
 * The file tab is handled separately due to its unique concerns
 * (block editing, editor engine lifecycle).
 */

import { createSignal, createEffect, createRoot, onCleanup, Show, type Accessor, type JSX } from "solid-js";
import CanvasEditor from "../editor/CanvasEditor";
import WritingViewport from "./WritingViewport";
import { isMarkdownPath } from "../editor/writing-viewport";
import BlockEditor from "../editor/BlockEditor";
import type { Tab } from "../lib/tab-types";
import type { PanelDeps, FileTabDeps } from "../lib/panel-registry";
import { getPanel } from "../lib/panel-registry";
import { resolveEditorSettings } from "../lib/editor-settings";

// Ensure all panel types are registered
import "../lib/panel-definitions";

export interface PanelRendererDeps extends PanelDeps, FileTabDeps {
  activateTab?: (id: string) => void;
}

export function createPanelRenderer(deps: PanelRendererDeps) {
  const panelCache = new Map<string, { element: JSX.Element; dispose: () => void; setActive: (value: boolean) => void }>();

  onCleanup(() => {
    for (const cached of panelCache.values()) cached.dispose();
    panelCache.clear();
  });

  // Closed tabs release their roots; inactive tabs retain their resources.
  createEffect(() => {
    const currentIds = new Set(deps.tabs().map(t => t.id));
    for (const [id, cached] of panelCache) {
      if (!currentIds.has(id)) {
        cached.setActive(false);
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
      if (deps.activeTabId() !== tabId) (deps.activateTab ?? deps.switchToTab)(tabId);
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

    // File tab (default) — has unique block-editor/engine concerns
    return renderFileTab(tab, isActive);
  }

  function renderFileTab(tab: Tab, isActive: Accessor<boolean>): JSX.Element {
    const existingEngine = deps.engineMap.get(tab.id);
    const initialText = existingEngine ? existingEngine.getText() : deps.getFileTextForTab(tab.id);
    if (initialText === null) return <div class="panel-empty" />;
    const currentTab = () => deps.tabs().find(t => t.id === tab.id) ?? tab;
    const languagePath = () => currentTab().path || currentTab().name || null;

    const isMd = () => isMarkdownPath(languagePath());
    const editorSettings = () => resolveEditorSettings(deps.settings(), languagePath());
    return wrapPanel(tab.id, (
      <div style={{ width: "100%", height: "100%", position: "relative", display: "flex", "flex-direction": "column" }}>
        <div style={{ width: "100%", flex: "1", "min-height": "0", display: "flex" }}>
          <Show when={isMd()} fallback={
          <WritingViewport tabId={tab.id} markdown={isMd()}><CanvasEditor
            tabId={tab.id}
            initialText={initialText}
            initialDirty={tab.dirty}
            initialCursor={existingEngine?.cursor() ?? tab.restoredCursor}
            initialSelection={existingEngine?.sel() ?? tab.restoredSelection}
            initialScrollTop={deps.scrollPositions()[tab.id] ?? 0}
            onScrollChange={top => deps.onScrollChange(tab.id, top)}
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
          /></WritingViewport>
          }>
            <BlockEditor
              tabId={tab.id} initialText={initialText} initialDirty={tab.dirty}
              initialCursor={existingEngine?.cursor() ?? tab.restoredCursor}
              initialSelection={existingEngine?.sel() ?? tab.restoredSelection}
              initialScrollTop={deps.scrollPositions()[tab.id] ?? 0}
              filePath={tab.path || null} active={isActive()} autoFocus={tab.id === deps.activeTabId()}
              onEngineReady={engine => deps.engineMap.set(tab.id, engine)}
              onDirtyChange={dirty => {
                const current = deps.tabs().find(t => t.id === tab.id);
                if (current && current.dirty !== dirty) deps.setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, dirty } : t));
              }}
              onCursorChange={(line, col) => {
                if (tab.id === deps.activeTabId()) { deps.setCursorLine(line); deps.setCursorCol(col); }
              }}
              onScrollChange={top => deps.onScrollChange(tab.id, top)}
            />
          </Show>
        </div>
      </div>
    ));
  }

  return { renderPanel };
}
