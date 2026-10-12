/**
 * Panel definitions — registers all non-file panel types.
 *
 * Import this module once (in App.tsx or PanelRenderer) to register
 * all panel types with the panel registry. Each registration is a
 * clean one-liner mapping type → component + props.
 */

import { registerPanel } from "./panel-registry";

// Lazy imports — components are only loaded when first rendered
import SettingsPanel from "../ui/SettingsPanel";
import KeybindingsPanel from "../ui/KeybindingsPanel";
import ImageViewer from "../ui/ImageViewer";
import AiSettingsPanel from "../ui/AiSettingsPanel";
import WritingReviewPanel from "../ui/WritingReviewPanel";
import SearchPortal from "../ui/SearchPortal";

registerPanel("search-portal", { render: tab => <SearchPortal portalId={tab.path} /> });

registerPanel("writing-review", {
  render: tab => <WritingReviewPanel reviewId={tab.path} />,
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

// ── Image Viewer ─────────────────────────────────────────────────────

registerPanel("image", {
  render: (tab) => (
    <ImageViewer
      filePath={tab.path}
      fileName={tab.name}
    />
  ),
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
