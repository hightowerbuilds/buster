import { Component, Show, onCleanup } from "solid-js";
import Sidebar from "./ui/Sidebar";
import CanvasTabBar from "./ui/CanvasTabBar";
import CanvasStatusBar from "./ui/CanvasStatusBar";
import FindReplace from "./ui/FindReplace";
import CommandPalette from "./ui/CommandPalette";
import PanelLayout from "./ui/PanelLayout";
import SpeechDock from "./ui/SpeechDock";
import FooterNav from "./ui/FooterNav";
import CanvasToasts from "./ui/CanvasToasts";
import DirtyCloseDialog from "./ui/DirtyCloseDialog";
import ExternalChangeDialog from "./ui/ExternalChangeDialog";
import { createAppCommands, registerAppCommands, unregisterAppCommands, buildHotkeyDefinitions, resolveHotkey, type CommandDeps } from "./lib/app-commands";
import { createHotkeys } from "@tanstack/solid-hotkeys";
import { normalizeHotkey } from "./lib/keybinding-conflicts";
import { useBuster } from "./lib/buster-context";
import { createPanelRenderer } from "./ui/PanelRenderer";

import { focusTabPanel, focusSidebarPrimary, restorePrimaryWorkspaceFocus, sidebarHasFocus } from "./lib/focus-service";
import "./styles/ide.css";

const App: Component = () => {
  const { store, setStore, engines, actions } = useBuster();
  let ideRootRef: HTMLDivElement | undefined;

  function activateTab(tabId: string) {
    actions.switchToTab(tabId);
    focusTabPanel(tabId);
  }

  function updateSidebarVisible(
    value: boolean | ((prev: boolean) => boolean),
    options?: { focusSidebar?: boolean },
  ) {
    const prevVisible = store.sidebarVisible;
    const nextVisible = typeof value === "function" ? value(prevVisible) : value;
    if (nextVisible === prevVisible) return;

    const hadFocus = sidebarHasFocus();
    setStore("sidebarVisible", nextVisible);

    if (!nextVisible && hadFocus) {
      restorePrimaryWorkspaceFocus(store.activeTabId, ideRootRef);
      return;
    }

    if (nextVisible && options?.focusSidebar) {
      focusSidebarPrimary();
    }
  }

  function closeSplit() { actions.panes.closePane(); }

  // ── Command registry + keyboard handler ─────────────────

  const commandDeps: CommandDeps = {
    handleSave: actions.handleSave,
    createNewFile: actions.createNewFile,
    handleSaveAs: actions.handleSaveAs,
    changeDirectory: actions.changeDirectory,
    handleTabClose: actions.handleTabClose,
    activeTabId: () => store.activeTabId,
    tabs: () => store.tabs,
    switchToTab: activateTab,
    activeEngine: actions.activeEngine,
    setFindVisible: (v: boolean | ((prev: boolean) => boolean)) =>
      setStore("findVisible", typeof v === "function" ? v(store.findVisible) : v),
    setPaletteVisible: (v: boolean | ((prev: boolean) => boolean)) =>
      setStore("paletteVisible", typeof v === "function" ? v(store.paletteVisible) : v),
    setPaletteInitialQuery: (v: string | ((prev: string) => string)) =>
      setStore("paletteInitialQuery", typeof v === "function" ? v(store.paletteInitialQuery) : v),
    createTerminalTab: actions.createTerminalTab,
    createSettingsTab: actions.createSettingsTab,
    createKeybindingsTab: actions.createKeybindingsTab,
    setSidebarVisible: (v: boolean | ((prev: boolean) => boolean)) =>
      updateSidebarVisible(v),
    findVisible: () => store.findVisible,
    paletteVisible: () => store.paletteVisible,
    settings: () => store.settings,
    updateSettings: actions.updateSettings,
    tabTrapping: () => store.tabTrapping,
    setTabTrapping: (v: boolean) => setStore("tabTrapping", v),
    closeSplit,
    closeTabOrSplit: () => {
      const id = store.activeTabId;
      if (id) actions.handleTabClose(id);
    },
    navigateBack: () => actions.navigateBack(),
    navigateForward: () => actions.navigateForward(),
  };

  const appCommands = createAppCommands(commandDeps);
  registerAppCommands(appCommands);
  onCleanup(() => unregisterAppCommands(appCommands));

  // Listen for close-split events from the native Cmd+W menu handler
  const handleCloseSplitEvent = () => closeSplit();
  window.addEventListener("buster-close-split", handleCloseSplitEvent);
  onCleanup(() => window.removeEventListener("buster-close-split", handleCloseSplitEvent));

  // TanStack Hotkeys — user overrides from settings.keybindings
  createHotkeys(
    () => buildHotkeyDefinitions(commandDeps, store.settings.keybindings),
    () => ({
      target: ideRootRef ?? document,
    }),
  );

  let shortcutChordPending = false;
  let shortcutChordTimer: ReturnType<typeof setTimeout> | undefined;

  function clearShortcutChord() {
    shortcutChordPending = false;
    clearTimeout(shortcutChordTimer);
    shortcutChordTimer = undefined;
  }

  function eventStroke(e: KeyboardEvent): string {
    if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return "";

    const parts: string[] = [];
    if (e.metaKey || e.ctrlKey) parts.push("Mod");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");
    parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    return normalizeHotkey(parts.join("+"));
  }

  function shortcutChord(): [string, string] | null {
    const hotkey = normalizeHotkey(resolveHotkey("view.keybindings", store.settings.keybindings) ?? "");
    const parts = hotkey.split(" ").filter(Boolean);
    return parts.length === 2 ? [parts[0]!, parts[1]!] : null;
  }

  function handleShortcutChord(e: KeyboardEvent) {
    const chord = shortcutChord();
    if (!chord) return;

    const stroke = eventStroke(e);
    if (!stroke) return;

    if (stroke === chord[0]) {
      e.preventDefault();
      e.stopPropagation();
      shortcutChordPending = true;
      clearTimeout(shortcutChordTimer);
      shortcutChordTimer = setTimeout(clearShortcutChord, 1500);
      return;
    }

    if (shortcutChordPending && stroke === chord[1]) {
      e.preventDefault();
      e.stopPropagation();
      clearShortcutChord();
      actions.createKeybindingsTab();
      return;
    }

    if (shortcutChordPending) {
      clearShortcutChord();
    }
  }

  window.addEventListener("keydown", handleShortcutChord, true);
  onCleanup(() => {
    window.removeEventListener("keydown", handleShortcutChord, true);
    clearShortcutChord();
  });

  // ── Panel rendering ─────────────────────────────────────

  const { renderPanel } = createPanelRenderer({
    workspaceRoot: () => store.workspaceRoot,
    settings: () => store.settings,
    updateSettings: actions.updateSettings,
    tabs: () => store.tabs,
    activeTabId: () => store.activeTabId,
    switchToTab: actions.switchToTab,
    searchMatches: () => store.searchMatches,
    currentSearchIdx: () => store.currentSearchIdx,
    handleFileSelect: actions.handleFileSelect,
    handleTermIdReady: actions.handleTermIdReady,
    handleTermTitleChange: actions.handleTermTitleChange,
    handleTabClose: actions.handleTabClose,
    openWorkspace: actions.openWorkspace,
    changeDirectory: actions.changeDirectory,
    closeDirectory: actions.closeDirectory,
    cursorLine: () => store.cursorLine,
    cursorCol: () => store.cursorCol,
    setCursorLine: (line: number) => setStore("cursorLine", line),
    setCursorCol: (col: number) => setStore("cursorCol", col),
    setTabs: (fn) => setStore("tabs", fn(store.tabs)),
    engineMap: engines.map,
    getFileTextForTab: actions.getFileTextForTab,
    scrollPositions: () => store.scrollPositions,
    onScrollChange: (id, top) => setStore("scrollPositions", id, top),
  });

  // ── Helpers ─────────────────────────────────────────────

  function handleGoToLine(line: number, col: number) {
    const engine = actions.activeEngine();
    if (engine) engine.setCursor({ line, col });
  }

  function groupedTabIds() {
    return new Set(store.paneWorkspace.panes.flatMap(p => p.tabId ? [p.tabId] : []));
  }

  // ── JSX ─────────────────────────────────────────────────

  return (
    <div ref={(el) => { ideRootRef = el; }} class="ide-container" tabindex={-1}>
      <a class="skip-link" href="#" onClick={(e) => {
        e.preventDefault();
        const el = document.querySelector<HTMLTextAreaElement>(".canvas-editor textarea");
        if (el) el.focus({ preventScroll: true });
      }}>Skip to Editor</a>
      <Show when={store.sidebarVisible}>
        <a class="skip-link" href="#" onClick={(e) => {
          e.preventDefault();
          const el = document.querySelector<HTMLElement>(".sidebar button");
          if (el) el.focus({ preventScroll: true });
        }}>Skip to Sidebar</a>
      </Show>
      <a class="skip-link" href="#" onClick={(e) => {
        e.preventDefault();
        const el = document.querySelector<HTMLTextAreaElement>(".canvas-terminal textarea");
        if (el) el.focus({ preventScroll: true });
      }}>Skip to Terminal</a>
      <div class="ide-main">
        <div
          id="file-explorer-sidebar"
          class="sidebar-wrap"
          role="complementary"
          aria-label="Sidebar"
          style={{
            width: `${store.sidebarWidth}px`,
            display: store.sidebarVisible ? "flex" : "none",
          }}
        >
          <Sidebar
            onFileSelect={actions.handleFileSelect}
            workspaceRoot={store.workspaceRoot}
            onFolderOpen={(path) => actions.openWorkspace(path)}
            onChangeDirectory={actions.changeDirectory}
            onCloseDirectory={store.workspaceRoot !== store.notesRoot ? actions.closeDirectory : undefined}
          />
          <div
            class="sidebar-resize-handle"
            onPointerDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = store.sidebarWidth;
              document.body.style.userSelect = "none";
              document.body.style.cursor = "col-resize";
              const onMove = (ev: PointerEvent) => {
                const w = startW + (ev.clientX - startX);
                setStore("sidebarWidth", Math.max(140, Math.min(600, w)));
              };
              const onUp = () => {
                document.removeEventListener("pointermove", onMove);
                document.removeEventListener("pointerup", onUp);
                document.body.style.userSelect = "";
                document.body.style.cursor = "";
              };
              document.addEventListener("pointermove", onMove);
              document.addEventListener("pointerup", onUp);
            }}
          />
        </div>
        <button
          class="sidebar-bumper"
          title={`${store.sidebarVisible ? "Hide" : "Show"} File Explorer (⌘B)`}
          aria-label={`${store.sidebarVisible ? "Hide" : "Show"} File Explorer`}
          aria-expanded={store.sidebarVisible}
          aria-controls="file-explorer-sidebar"
          aria-keyshortcuts="Meta+B Control+B"
          onClick={() => updateSidebarVisible(v => !v)}
        ><span aria-hidden="true">{store.sidebarVisible ? "‹" : "›"}</span></button>
        <div class="editor-area" role="main" aria-label="Editor">
          <div class="editor-toolbar">
            <CanvasTabBar
              tabs={store.tabs}
              activeTab={store.activeTabId}
              groupedTabIds={groupedTabIds()}
              onSelect={actions.switchToTab}
              onActivate={activateTab}
              onClose={actions.handleTabClose}
              onRename={(tabId, name) => {
                const idx = store.tabs.findIndex(t => t.id === tabId);
                if (idx >= 0) setStore("tabs", idx, "name", name);
                // Re-focus the editor after rename so the user can type immediately
                requestAnimationFrame(() => focusTabPanel(tabId));
              }}
              onNewTerminal={actions.createTerminalTab}
              onReorder={(fromIdx, toIdx) => {
                const t = [...store.tabs];
                const [moved] = t.splice(fromIdx, 1);
                t.splice(toIdx, 0, moved);
                setStore("tabs", t);
              }}
            />
          </div>
          <FindReplace
            visible={store.findVisible}
            engine={actions.activeEngine()}
            onClose={() => setStore("findVisible", false)}
            onMatchesChange={(m) => setStore("searchMatches", m)}
            onCurrentIdxChange={(idx) => setStore("currentSearchIdx", idx)}
            onJumpTo={(line, col) => {
              const eng = actions.activeEngine();
              if (eng) eng.setCursor({ line, col });
            }}
          />
          <div class="editor-content">
            <PanelLayout renderPanel={renderPanel} />
          </div>
          <SpeechDock />
          <CanvasStatusBar
              line={store.cursorLine}
              col={store.cursorCol}
              totalLines={actions.activeEngine()?.lineCount() ?? 0}
              fileName={actions.activeTab()?.name ?? null}
              fileLoading={store.fileLoading}
              lineEnding={actions.activeEngine()?.lineEnding() ?? null}
            />
        </div>
      </div>
      <FooterNav />
      <CommandPalette
        visible={store.paletteVisible}
        workspaceRoot={store.workspaceRoot}
        onClose={() => { setStore("paletteVisible", false); setStore("paletteInitialQuery", ""); }}
        onFileSelect={actions.handleFileSelect}
        onGoToLine={handleGoToLine}
        initialQuery={store.paletteInitialQuery}
        activeFilePath={store.activeFilePath}
        recentFiles={store.recentFiles}
        activeEngine={actions.activeEngine()}
      />
      <CanvasToasts />
      <DirtyCloseDialog
        visible={store.dirtyCloseTabId !== null}
        fileName={store.dirtyCloseFileName}
        onResult={actions.handleDirtyCloseResult}
      />
      <ExternalChangeDialog
        visible={store.extChangeTabId !== null}
        fileName={store.extChangeFileName}
        onResult={actions.handleExternalChangeResult}
      />
    </div>
  );
};

export default App;
