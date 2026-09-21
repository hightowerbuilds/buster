/**
 * Panel definitions — registers all non-file panel types.
 *
 * Import this module once (in App.tsx or PanelRenderer) to register
 * all panel types with the panel registry. Each registration is a
 * clean one-liner mapping type → component + props.
 */

import { registerPanel } from "./panel-registry";

// Lazy imports — components are only loaded when first rendered
import CanvasTerminal from "../ui/CanvasTerminal";
import SettingsPanel from "../ui/SettingsPanel";
import KeybindingsPanel from "../ui/KeybindingsPanel";
import GitPage from "../ui/GitPage";
import ExtensionsPage from "../ui/ExtensionsPage";
import ProblemsPanel from "../ui/ProblemsPanel";
import SearchResultsPanel from "../ui/SearchResultsPanel";
import ImageViewer from "../ui/ImageViewer";
import DisplayListSurface from "../ui/DisplayListSurface";
import CanvasBrowserPanel from "../ui/CanvasBrowserPanel";
import ConsolePanel from "../ui/ConsolePanel";
import AiSettingsPanel from "../ui/AiSettingsPanel";
import WritingReviewPanel from "../ui/WritingReviewPanel";
import SearchPortal from "../ui/SearchPortal";

registerPanel("search-portal", { render: tab => <SearchPortal portalId={tab.path} /> });

registerPanel("writing-review", {
  render: tab => <WritingReviewPanel reviewId={tab.path} />,
});

// ── Terminal ─────────────────────────────────────────────────────────

registerPanel("terminal", {
  render: (tab, isActive, deps) => (
    <CanvasTerminal
      termTabId={tab.id}
      active={isActive()}
      cwd={tab.path || deps.workspaceRoot() || undefined}
      onTermIdReady={deps.handleTermIdReady}
      autoFocus={tab.id === deps.activeTabId()}
    />
  ),
});

// ── Settings ─────────────────────────────────────────────────────────

registerPanel("settings", {
  render: (_tab, _isActive, deps) => (
    <SettingsPanel
      settings={deps.settings()}
      onChange={deps.updateSettings}
    />
  ),
});

// ── Keyboard Shortcuts ─────────────────────────────────────────────

registerPanel("keybindings", {
  render: (_tab, _isActive, deps) => (
    <KeybindingsPanel settings={deps.settings()} />
  ),
});

// ── Git ──────────────────────────────────────────────────────────────

registerPanel("git", {
  render: (_tab, isActive, deps) => (
    <GitPage
      active={isActive()}
      workspaceRoot={deps.workspaceRoot() ?? undefined}
      onFileSelect={deps.handleFileSelect}
    />
  ),
});

// ── Extensions ───────────────────────────────────────────────────────

registerPanel("extensions", {
  render: () => <ExtensionsPage />,
});

// ── Search Results ───────────────────────────────────────────────────

registerPanel("search-results", {
  render: (_tab, _isActive, deps) => (
    <SearchResultsPanel
      workspaceRoot={deps.workspaceRoot()}
      onFileSelect={async (path, line, col) => {
        await deps.handleFileSelect(path);
        deps.setCursorLine(line);
        deps.setCursorCol(col);
      }}
    />
  ),
});

// ── Problems ─────────────────────────────────────────────────────────

registerPanel("problems", {
  render: (_tab, _isActive, deps) => (
    <ProblemsPanel
      diagnosticsMap={deps.diagnosticsMap()}
      onJumpTo={async (filePath, line, col) => {
        await deps.handleFileSelect(filePath);
        deps.setCursorLine(line);
        deps.setCursorCol(col);
      }}
    />
  ),
});

// ── Image Viewer ─────────────────────────────────────────────────────

registerPanel("image", {
  render: (tab) => (
    <ImageViewer
      filePath={tab.path}
      fileName={tab.name}
    />
  ),
});

// ── Extension Surface ────────────────────────────────────────────────

registerPanel("surface", {
  render: (tab, isActive) => {
    const meta = JSON.parse(tab.path || "{}");
    return (
      <DisplayListSurface
        surfaceId={meta.surface_id ?? 0}
        extensionId={meta.extension_id ?? ""}
        initialWidth={meta.width ?? 800}
        initialHeight={meta.height ?? 600}
        label={tab.name}
        isActive={isActive()}
      />
    );
  },
});

// ── Built-in Browser ────────────────────────────────────────────────

registerPanel("browser", {
  render: (tab, isActive) => (
    <CanvasBrowserPanel
      tabId={tab.id}
      active={isActive()}
      initialUrl={tab.path || undefined}
    />
  ),
});

// ── Buster Console ──────────────────────────────────────────────────

registerPanel("console", {
  render: (_tab, isActive) => <ConsolePanel active={isActive()} />,
});

// ── AI Settings ─────────────────────────────────────────────────────

registerPanel("ai", {
  render: (_tab, _isActive, deps) => (
    <AiSettingsPanel
      settings={deps.settings()}
      onChange={deps.updateSettings}
    />
  ),
});
