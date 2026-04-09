import { Component, Show, onCleanup } from "solid-js";
import Sidebar from "./ui/Sidebar";
import TabBar from "./ui/TabBar";
import StatusBar from "./ui/StatusBar";
import FindReplace from "./ui/FindReplace";
import CommandPalette from "./ui/CommandPalette";
import PanelLayout from "./ui/PanelLayout";
import LayoutPicker from "./ui/LayoutPicker";
import WelcomeCanvas from "./ui/WelcomeCanvas";
import CanvasToasts from "./ui/CanvasToasts";
import DirtyCloseDialog from "./ui/DirtyCloseDialog";
import ExternalChangeDialog from "./ui/ExternalChangeDialog";
import BranchPicker from "./ui/BranchPicker";
import { createAppCommands, registerAppCommands, unregisterAppCommands, buildHotkeyDefinitions, type CommandDeps } from "./lib/app-commands";
import { createHotkeys } from "@tanstack/solid-hotkeys";
import { useBuster } from "./lib/buster-context";
import { createPanelRenderer } from "./ui/PanelRenderer";
import "./styles/ide.css";

const App: Component = () => {
  const { store, setStore, engines, actions } = useBuster();

  // ── Command registry + keyboard handler ─────────────────

  const commandDeps: CommandDeps = {
    handleSave: actions.handleSave,
    changeDirectory: actions.changeDirectory,
    handleTabClose: actions.handleTabClose,
    activeTabId: () => store.activeTabId,
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
    createAiTab: actions.createAiTab,
    setSidebarVisible: (v: boolean | ((prev: boolean) => boolean)) =>
      setStore("sidebarVisible", typeof v === "function" ? v(store.sidebarVisible) : v),
    setTourActive: (v: boolean | ((prev: boolean) => boolean)) =>
      setStore("tourActive", typeof v === "function" ? v(store.tourActive) : v),
    jumpToDiagnostic: actions.jumpToDiagnostic,
    tourActive: () => store.tourActive,
    findVisible: () => store.findVisible,
    paletteVisible: () => store.paletteVisible,
  };

  const appCommands = createAppCommands(commandDeps);
  registerAppCommands(appCommands);
  onCleanup(() => unregisterAppCommands(appCommands));

  // TanStack Hotkeys — user overrides from settings.keybindings
  const hotkeyDefs = buildHotkeyDefinitions(commandDeps, store.settings.keybindings);
  createHotkeys(hotkeyDefs);

  // ── Panel rendering ─────────────────────────────────────

  const { renderPanel } = createPanelRenderer({
    workspaceRoot: () => store.workspaceRoot,
    settings: () => store.settings,
    updateSettings: actions.updateSettings,
    tabs: () => store.tabs,
    activeTabId: () => store.activeTabId,
    searchMatches: () => store.searchMatches,
    diagnosticsMap: () => {
      // Convert Record to Map for PanelRenderer compatibility
      const m = new Map<string, any[]>();
      for (const [k, v] of Object.entries(store.diagnosticsMap)) m.set(k, v);
      return m;
    },
    diffHunksMap: () => store.diffHunksMap,
    handleFileSelect: actions.handleFileSelect,
    handleTermIdReady: actions.handleTermIdReady,
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
    const mode = store.layoutMode;
    if (mode === "tabs") return undefined;
    const sizes: Record<string, number> = { columns: 6, grid: 4, trio: 3, quint: 5, restack: 5, hq: 6 };
    const n = sizes[mode] ?? 1;
    return new Set(store.tabs.slice(0, n).map(t => t.id));
  }

  // ── JSX ─────────────────────────────────────────────────

  return (
    <div class="ide-container" tabindex={-1}>
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
        <Show when={store.sidebarVisible}>
        <div class="sidebar-wrap" role="complementary" aria-label="Sidebar" style={{ width: `${store.sidebarWidth}px` }}>
          <Sidebar
            onFileSelect={actions.handleFileSelect}
            workspaceRoot={store.workspaceRoot}
            onFolderOpen={(path) => actions.openWorkspace(path)}
            onChangeDirectory={actions.changeDirectory}
            onCloseDirectory={actions.closeDirectory}
            onHideSidebar={() => setStore("sidebarVisible", false)}
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
        </Show>
        <Show when={!store.sidebarVisible}>
          <button
            class="sidebar-show-btn"
            title="Show Sidebar"
            aria-label="Show Sidebar"
            onClick={() => setStore("sidebarVisible", true)}
          >&raquo;</button>
        </Show>
        <div class="editor-area" role="main" aria-label="Editor">
          <div class="editor-toolbar">
            <TabBar
              tabs={store.tabs}
              activeTab={store.activeTabId}
              groupedTabIds={groupedTabIds()}
              onSelect={actions.switchToTab}
              onClose={actions.handleTabClose}
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
            onJumpTo={(line, col) => {
              const eng = actions.activeEngine();
              if (eng) eng.setCursor({ line, col });
            }}
          />
          <div class="editor-content">
            <PanelLayout
              layout={store.layoutMode}
              tabs={store.tabs}
              activeTabId={store.activeTabId}
              renderPanel={renderPanel}
              welcome={
                <WelcomeCanvas
                  recentFolders={store.settings.recent_folders}
                  onOpenFolder={(path) => actions.openWorkspace(path)}
                />
              }
            />
          </div>
          <Show when={actions.activeTab()?.type !== "ai"}>
            <StatusBar
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
            />
          </Show>
        </div>
      </div>
      <div class="dock-bar" role="navigation" aria-label="Dock">
        <button class="dock-btn" onClick={actions.createGitTab} aria-label="Open Git panel">Git</button>
        <button class="dock-btn" onClick={actions.createExtensionsTab} aria-label="Open Extensions panel">Extensions</button>
        <button class="dock-btn" onClick={actions.createSettingsTab} aria-label="Open Settings">Settings</button>
        <button class="dock-btn" onClick={actions.createAiTab} aria-label="Open AI Agent">Models</button>
        <button class="dock-btn" onClick={actions.createManualTab} aria-label="Open Manual">Manual</button>
        <div class="dock-spacer" />
        <LayoutPicker
          current={store.layoutMode}
          onChange={(m) => setStore("layoutMode", m)}
        />
      </div>
      <CommandPalette
        visible={store.paletteVisible}
        workspaceRoot={store.workspaceRoot}
        onClose={() => { setStore("paletteVisible", false); setStore("paletteInitialQuery", ""); }}
        onFileSelect={actions.handleFileSelect}
        onGoToLine={handleGoToLine}
        onNewTerminal={actions.createTerminalTab}
        onOpenManual={() => actions.createManualTab()}
        onNewAiChat={actions.createAiTab}
        onGitGraph={actions.createGitTab}
        initialQuery={store.paletteInitialQuery}
        activeFilePath={store.activeFilePath}
        recentFiles={store.recentFiles}
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
    </div>
  );
};

export default App;
