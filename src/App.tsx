import { Component, Show, createSignal, onCleanup } from "solid-js";
import Sidebar from "./ui/Sidebar";
import CanvasTabBar from "./ui/CanvasTabBar";
import CanvasStatusBar from "./ui/CanvasStatusBar";
import FindReplace from "./ui/FindReplace";
import CommandPalette from "./ui/CommandPalette";
import CommandLineSwitchboard from "./ui/CommandLineSwitchboard";
import PanelLayout from "./ui/PanelLayout";
import WelcomeCanvas from "./ui/WelcomeCanvas";
import CanvasToasts from "./ui/CanvasToasts";
import DirtyCloseDialog from "./ui/DirtyCloseDialog";
import ExternalChangeDialog from "./ui/ExternalChangeDialog";
import BranchPicker from "./ui/BranchPicker";
import DebugMode from "./ui/DebugMode";
import { createAppCommands, registerAppCommands, unregisterAppCommands, buildHotkeyDefinitions, type CommandDeps } from "./lib/app-commands";
import { createHotkeys } from "@tanstack/solid-hotkeys";
import { useBuster } from "./lib/buster-context";
import { createPanelRenderer } from "./ui/PanelRenderer";
import type { PanelCount } from "./lib/panel-count";
import { splitLeaf, removeLeaf, reindexAfterRemoval, countLeaves, leaf } from "./ui/panel-layout-tree";
import { focusTabPanel, focusSidebarPrimary, restorePrimaryWorkspaceFocus, sidebarHasFocus } from "./lib/focus-service";
import "./styles/ide.css";

const App: Component = () => {
  const { store, setStore, engines, actions } = useBuster();
  let ideRootRef: HTMLDivElement | undefined;
  const [commandLineVisible, setCommandLineVisible] = createSignal(false);

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

  function applyPanelCount(count: PanelCount, options?: { restoreFocus?: boolean }) {
    setStore("panelCount", count);
    if (options?.restoreFocus !== false) restorePrimaryWorkspaceFocus(store.activeTabId, ideRootRef);
  }

  let splitGuard = false;

  /** Create a terminal that lives inside a split — hidden from tab bar. */
  function createSplitTerminal(): number {
    const tabId = `split_term_${Date.now()}_${store.tabs.length}`;
    const cwd = store.workspaceRoot ?? "";
    const newTab = {
      id: tabId,
      name: "Terminal",
      path: cwd,
      dirty: false,
      type: "terminal" as const,
      splitChild: true,
    };
    setStore("tabs", [...store.tabs, newTab]);
    return store.tabs.length - 1; // index of the just-added tab
  }

  function splitRight() {
    if (splitGuard || countLeaves(store.layoutTree) >= 6) return;
    splitGuard = true;

    const activeIdx = store.tabs.findIndex((t) => t.id === store.activeTabId);
    const targetIdx = activeIdx >= 0 ? activeIdx : 0;
    const newIdx = createSplitTerminal();

    const newTree = splitLeaf(store.layoutTree, targetIdx, "row", newIdx);
    setStore("layoutTree", newTree);
    setStore("panelCount", countLeaves(newTree) as PanelCount);
    requestAnimationFrame(() => { splitGuard = false; });
  }

  function splitDown() {
    if (splitGuard || countLeaves(store.layoutTree) >= 6) return;
    splitGuard = true;

    const activeIdx = store.tabs.findIndex((t) => t.id === store.activeTabId);
    const targetIdx = activeIdx >= 0 ? activeIdx : 0;
    const newIdx = createSplitTerminal();

    const newTree = splitLeaf(store.layoutTree, targetIdx, "column", newIdx);
    setStore("layoutTree", newTree);
    setStore("panelCount", countLeaves(newTree) as PanelCount);
    requestAnimationFrame(() => { splitGuard = false; });
  }

  function closeSplit() {
    const leaves = countLeaves(store.layoutTree);
    if (leaves <= 1) return;

    // Find the last split child in the tree to remove (preserve the original tab)
    const splitChildIndices = store.tabs
      .map((t, i) => t.splitChild ? i : -1)
      .filter((i) => i >= 0);

    if (splitChildIndices.length === 0) return;

    // Remove the last split child
    const removeIdx = splitChildIndices[splitChildIndices.length - 1];

    // Remove the leaf from the tree and reindex
    let newTree = removeLeaf(store.layoutTree, removeIdx);
    if (!newTree) newTree = leaf(0);
    newTree = reindexAfterRemoval(newTree, removeIdx);

    // Remove the tab from the array
    setStore("tabs", store.tabs.filter((_, i) => i !== removeIdx));

    // If only 1 leaf left, reset to clean single-panel state
    const newLeaves = countLeaves(newTree);
    if (newLeaves <= 1) {
      newTree = leaf(0);
    }

    setStore("layoutTree", newTree);
    setStore("panelCount", newLeaves as PanelCount);
  }

  function openCommandLine() {
    setCommandLineVisible(true);
  }

  function toggleCommandLine() {
    setCommandLineVisible((visible) => !visible);
  }

  function closeCommandLine() {
    setCommandLineVisible(false);
  }

  function handleCommandLineExtensions() {
    actions.createExtensionsTab();
    closeCommandLine();
  }

  function handleCommandLineDebug() {
    actions.createDebugTab();
    closeCommandLine();
  }

  function handleCommandLineGit() {
    actions.createGitTab();
    closeCommandLine();
  }

  function handleCommandLineBrowser() {
    actions.createBrowserTab();
    closeCommandLine();
  }

  function handleCommandLineConsole() {
    actions.createConsoleTab();
    closeCommandLine();
  }

  function handleCommandLineSettings() {
    actions.createSettingsTab();
    closeCommandLine();
  }

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
    createGitTab: actions.createGitTab,
    createBrowserTab: actions.createBrowserTab,
    setSidebarVisible: (v: boolean | ((prev: boolean) => boolean)) =>
      updateSidebarVisible(v),
    jumpToDiagnostic: actions.jumpToDiagnostic,
    findVisible: () => store.findVisible,
    paletteVisible: () => store.paletteVisible,
    settings: () => store.settings,
    updateSettings: actions.updateSettings,
    tabTrapping: () => store.tabTrapping,
    setTabTrapping: (v: boolean) => setStore("tabTrapping", v),
    splitRight,
    splitDown,
    closeSplit,
    closeTabOrSplit: () => {
      const hasSplits = store.tabs.some(t => t.splitChild);
      if (hasSplits) { closeSplit(); return; }
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

  createHotkeys(
    () => [
      {
        hotkey: { key: "`", ctrl: true },
        callback: () => toggleCommandLine(),
        options: { ignoreInputs: false },
      },
      {
        hotkey: "Escape",
        callback: () => closeCommandLine(),
        options: { enabled: commandLineVisible(), ignoreInputs: false },
      },
    ],
    () => ({
      target: ideRootRef ?? document,
    }),
  );

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
    diagnosticsMap: () => {
      // Convert Record to Map for PanelRenderer compatibility
      const m = new Map<string, any[]>();
      for (const [k, v] of Object.entries(store.diagnosticsMap)) m.set(k, v);
      return m;
    },
    diffHunksMap: () => store.diffHunksMap,
    handleFileSelect: actions.handleFileSelect,
    handleTermIdReady: actions.handleTermIdReady,
    handleTermTitleChange: actions.handleTermTitleChange,
    handleTabClose: actions.handleTabClose,
    openWorkspace: actions.openWorkspace,
    changeDirectory: actions.changeDirectory,
    closeDirectory: actions.closeDirectory,
    setCursorLine: (line: number) => setStore("cursorLine", line),
    setCursorCol: (col: number) => setStore("cursorCol", col),
    setTabs: (fn) => setStore("tabs", fn(store.tabs)),
    engineMap: engines.map,
    getFileTextForTab: actions.getFileTextForTab,
  });

  // ── Helpers ─────────────────────────────────────────────

  function handleGoToLine(line: number, col: number) {
    const engine = actions.activeEngine();
    if (engine) engine.setCursor({ line, col });
  }

  function groupedTabIds() {
    const count = Math.min(store.panelCount, store.tabs.length);
    if (count <= 1) return undefined;
    return new Set(store.tabs.slice(0, count).map((tab) => tab.id));
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
            onCloseDirectory={actions.closeDirectory}
            onHideSidebar={() => updateSidebarVisible(false)}
            onPopOut={actions.popOutSidebar}
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
        <Show when={!store.sidebarVisible}>
          <button
            class="sidebar-show-btn"
            title="Show Sidebar"
            aria-label="Show Sidebar"
            onClick={() => updateSidebarVisible(true, { focusSidebar: true })}
          >&raquo;</button>
        </Show>
        <div class="editor-area" role="main" aria-label="Editor">
          <div class="editor-toolbar">
            <CanvasTabBar
              tabs={store.tabs.filter(t => !t.splitChild)}
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
            <PanelLayout
              layoutTree={store.layoutTree}
              tabs={store.tabs}
              activeTabId={store.activeTabId}
              renderPanel={renderPanel}
              welcome={
                <WelcomeCanvas
                  recentFolders={store.settings.recent_folders}
                  onOpenFolder={(path) => actions.openWorkspace(path)}
                  onNewFile={() => actions.createNewFile()}
                  onOpenDirectory={() => actions.changeDirectory()}
                />
              }
            />
          </div>
          <CanvasStatusBar
              line={store.cursorLine}
              col={store.cursorCol}
              totalLines={actions.activeEngine()?.lineCount() ?? 0}
              fileName={actions.activeTab()?.name ?? null}
              gitBranch={store.gitBranchName}
              onBranchClick={() => { if (store.workspaceRoot) setStore("branchPickerVisible", true); }}
              onSync={store.workspaceRoot ? actions.handleSync : undefined}
              syncing={store.syncing}
              lspState={store.lspState}
              lspLanguages={store.lspLanguages}
              errorCount={actions.diagnosticCounts().errors}
              warningCount={actions.diagnosticCounts().warnings}
              onDiagnosticsClick={() => actions.jumpToDiagnostic(1)}
              onLspClick={actions.restartLsp}
              fileLoading={store.fileLoading}
              vimMode={store.vimMode}
              lineEnding={actions.activeEngine()?.lineEnding() ?? null}
            />
        </div>
      </div>
      <CommandLineSwitchboard
        visible={commandLineVisible()}
        onClose={closeCommandLine}
        onOpenExtensions={handleCommandLineExtensions}
        onOpenDebug={handleCommandLineDebug}
        onOpenGit={handleCommandLineGit}
        onOpenBrowser={handleCommandLineBrowser}
        onOpenConsole={handleCommandLineConsole}
        onOpenSettings={handleCommandLineSettings}
      />
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
      <Show when={store.branchPickerVisible && store.workspaceRoot}>
        <BranchPicker
          workspaceRoot={store.workspaceRoot!}
          onClose={() => setStore("branchPickerVisible", false)}
          onBranchChanged={() => actions.refreshGitBranch(store.workspaceRoot!)}
        />
      </Show>
      <Show when={store.debugModeVisible}>
        <DebugMode onMinimize={() => setStore("debugModeVisible", false)} />
      </Show>
    </div>
  );
};

export default App;
