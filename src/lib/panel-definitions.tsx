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
import SearchResultsPanel from "../ui/SearchResultsPanel";
import AiSettingsPanel from "../ui/AiSettingsPanel";
import AgentConnections from "../ui/AgentConnections";
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

// ── AI Settings ─────────────────────────────────────────────────────

registerPanel("ai", {
  render: (_tab, _isActive, deps) => (
    <>
      <AgentConnections />
      <AiSettingsPanel
        settings={deps.settings()}
        onChange={deps.updateSettings}
      />
    </>
  ),
});
