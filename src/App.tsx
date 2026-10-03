import { Component, Show, createMemo, createSignal, onCleanup } from "solid-js";
import Sidebar from "./ui/Sidebar";
import CanvasTabBar from "./ui/CanvasTabBar";
import CanvasStatusBar from "./ui/CanvasStatusBar";
import FindReplace from "./ui/FindReplace";
import CommandPalette from "./ui/CommandPalette";
import CommandLineSwitchboard from "./ui/CommandLineSwitchboard";
import PanelLayout from "./ui/PanelLayout";
import SpeechDock from "./ui/SpeechDock";
import FooterNav from "./ui/FooterNav";
import CanvasToasts from "./ui/CanvasToasts";
import DirtyCloseDialog from "./ui/DirtyCloseDialog";
import ExternalChangeDialog from "./ui/ExternalChangeDialog";
import PrintDialog from "./ui/PrintDialog";
import BranchPicker from "./ui/BranchPicker";
import { createAppCommands, registerAppCommands, unregisterAppCommands, buildHotkeyDefinitions, resolveHotkey, type CommandDeps } from "./lib/app-commands";
import { createHotkeys } from "@tanstack/solid-hotkeys";
import { normalizeHotkey } from "./lib/keybinding-conflicts";
import { useBuster } from "./lib/buster-context";
import { createPanelRenderer } from "./ui/PanelRenderer";
import AssistantSidebar from "./ui/AssistantSidebar";
import { MAX_COUNTED_CHARS, countWords, wordCountLabel } from "./lib/word-count";

import { focusTabPanel, focusSidebarPrimary, restorePrimaryWorkspaceFocus, sidebarHasFocus } from "./lib/focus-service";
import "./styles/ide.css";

const App: Component = () => {
  const { store, setStore, engines, actions, assistant, printing } = useBuster();
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


  function toggleCommandLine() {
    if (commandLineVisible()) closeCommandLine();
    else setCommandLineVisible(true);
  }

  function closeCommandLine() {
    setCommandLineVisible(false);
    restorePrimaryWorkspaceFocus(store.activeTabId, ideRootRef);
  }

  function handleCommandLineExtensions() {
    actions.createExtensionsTab();
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

  function handleCommandLineAi() {
    actions.createAiTab();
    closeCommandLine();
  }

  // Opening focuses the composer; toggling from elsewhere moves focus in, toggling from inside closes.
  const assistantInput = () => document.querySelector<HTMLElement>(".assistant-sidebar [data-assistant-input]");
  function openAssistant() {
    assistant.setOpen(true);
    requestAnimationFrame(() => assistantInput()?.focus({ preventScroll: true }));
  }

  function toggleAssistant() {
    if (!assistant.state.open) openAssistant();
    else if (!document.querySelector(".assistant-sidebar")?.contains(document.activeElement)) assistantInput()?.focus({ preventScroll: true });
    else closeAssistant();
  }

  function closeAssistant() {
    assistant.setOpen(false);
    restorePrimaryWorkspaceFocus(store.activeTabId, ideRootRef);
  }

  // ── Command registry + keyboard handler ─────────────────

  const commandDeps: CommandDeps = {
    handleSave: actions.handleSave,
    createNewFile: actions.createNewFile,
    handleSaveAs: actions.handleSaveAs,
    handlePrint: () => printing.open(store.activeTabId),
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
    createSettingsTab: actions.createSettingsTab,
    createKeybindingsTab: actions.createKeybindingsTab,
    createGitTab: actions.createGitTab,
    createBrowserTab: actions.createBrowserTab,
    toggleAssistant,
    setSidebarVisible: (v: boolean | ((prev: boolean) => boolean)) =>
      updateSidebarVisible(v),
    jumpToDiagnostic: actions.jumpToDiagnostic,
    findVisible: () => store.findVisible,
    paletteVisible: () => store.paletteVisible,
    settings: () => store.settings,
    updateSettings: actions.updateSettings,
    tabTrapping: () => store.tabTrapping,
    setTabTrapping: (v: boolean) => setStore("tabTrapping", v),
    closeActiveTab: () => {
      const id = store.activeTabId;
      if (id) actions.handleTabClose(id);
    },
    navigateBack: () => actions.navigateBack(),
    navigateForward: () => actions.navigateForward(),
  };

  const appCommands = createAppCommands(commandDeps);
  registerAppCommands(appCommands);
  onCleanup(() => unregisterAppCommands(appCommands));

  // TanStack Hotkeys — user overrides from settings.keybindings
  createHotkeys(
    () => printing.state.document ? [] : buildHotkeyDefinitions(commandDeps, store.settings.keybindings),
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
    activateTab: id => actions.switchToTab(id, { focus: false }),
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

  // Word count for the active document, plus the selection's count when text is selected.
  const wordCount = createMemo(() => {
    // The engine map is not reactive; its revision changes when a restored note's editor registers.
    engines.revision();
    const engine = actions.activeEngine();
    if (!engine) return null;
    const text = engine.getText();
    if (text.length > MAX_COUNTED_CHARS) return null;
    const range = engine.sel();
    const selected = range ? engine.getTextRange(range.anchor, range.head) : "";
    return wordCountLabel(countWords(text), selected ? countWords(selected) : null);
  });

  // ── Helpers ─────────────────────────────────────────────

  function handleGoToLine(line: number, col: number) {
    const engine = actions.activeEngine();
    if (engine) engine.setCursor({ line, col });
  }



  // ── JSX ─────────────────────────────────────────────────

  return (
    <div ref={(el) => { ideRootRef = el; }} class="ide-container" tabindex={-1}>
      <a class="skip-link" href="#" onClick={(e) => {
        e.preventDefault();
        const el = document.querySelector<HTMLElement>(".tab-content.is-active .block-prose, .tab-content.is-active .canvas-editor textarea");
        if (el) el.focus({ preventScroll: true });
      }}>Skip to Editor</a>
      <Show when={store.sidebarVisible}>
        <a class="skip-link" href="#" onClick={(e) => {
          e.preventDefault();
          const el = document.querySelector<HTMLElement>(".sidebar button");
          if (el) el.focus({ preventScroll: true });
        }}>Skip to Sidebar</a>
      </Show>
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
              onSelect={actions.switchToTab}
              onActivate={activateTab}
              onClose={actions.handleTabClose}
              onRename={(tabId, name) => {
                const idx = store.tabs.findIndex(t => t.id === tabId);
                if (idx >= 0) setStore("tabs", idx, "name", name);
                // Re-focus the editor after rename so the user can type immediately
                requestAnimationFrame(() => focusTabPanel(tabId));
              }}
              onReorder={actions.reorderTabs}
              onOpenAlongside={actions.openTabAlongside}
            />
            <button class="split-view-toggle print-action" aria-label="Print current document"
              title="Print current document (Cmd/Ctrl+P)" aria-keyshortcuts="Meta+P Control+P"
              disabled={actions.activeTab()?.type !== "file" || !!printing.state.document}
              onClick={() => printing.open(store.activeTabId)}>Print</button>
            <button class="split-view-toggle" disabled={store.tabs.length < 2}
              aria-label={store.splitView ? "Return to single view" : "Split view"}
              aria-pressed={!!store.splitView}
              title={store.splitView ? "Return to single view" : "Show two tabs side by side"}
              onClick={() => store.splitView ? actions.closeSplitView() : actions.openTabAlongside()}>
              <span aria-hidden="true">{store.splitView ? "▣" : "◫"}</span>
              {store.splitView ? "Single View" : "Split View"}
            </button>
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
              gitBranch={store.gitBranchName}
              onBranchClick={() => { if (store.workspaceRoot) setStore("branchPickerVisible", true); }}
              errorCount={actions.diagnosticCounts().errors}
              warningCount={actions.diagnosticCounts().warnings}
              onDiagnosticsClick={() => actions.jumpToDiagnostic(1)}
              fileLoading={store.fileLoading}
              lineEnding={actions.activeEngine()?.lineEnding() ?? null}
              wordCount={wordCount()}
            />
        </div>
        <button
          class="assistant-bumper"
          title={`${assistant.state.open ? "Hide" : "Show"} Language Model (${navigator.platform.startsWith("Mac") ? "Cmd" : "Ctrl"}+Shift+A)`}
          aria-label={`${assistant.state.open ? "Hide" : "Show"} Language Model`}
          aria-expanded={assistant.state.open}
          aria-keyshortcuts="Control+Shift+A"
          onClick={() => assistant.state.open ? closeAssistant() : openAssistant()}
        ><span aria-hidden="true">{assistant.state.open ? "›" : "‹"}</span></button>
        <Show when={assistant.state.open}>
          <AssistantSidebar onClose={closeAssistant} />
        </Show>
      </div>
      <FooterNav />
      <CommandLineSwitchboard
        visible={commandLineVisible()}
        onClose={closeCommandLine}
        onOpenExtensions={handleCommandLineExtensions}
        onOpenGit={handleCommandLineGit}
        onOpenBrowser={handleCommandLineBrowser}
        onOpenConsole={handleCommandLineConsole}
        onOpenSettings={handleCommandLineSettings}
        onOpenAi={handleCommandLineAi}
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
      <PrintDialog printing={printing} />
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
