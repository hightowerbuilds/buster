/**
 * Panel registry — declarative panel type → component mapping.
 *
 * Instead of a 13-branch if/else chain in PanelRenderer, each panel type
 * registers a render function here. PanelRenderer looks up the type and
 * calls the render function with the tab, active signal, and shared deps.
 */

import type { Tab } from "./tab-types";
import type { Accessor, JSX } from "solid-js";
import type { AppSettings } from "./ipc";
import type { SearchMatch, DiffHunk } from "./ipc";
import type { EditorEngine } from "../editor/engine";

/** Shared dependencies available to all panel renderers. */
export interface PanelDeps {
  workspaceRoot: () => string | null;
  settings: () => AppSettings;
  updateSettings: (s: AppSettings) => void;
  activeTabId: () => string | null;
  handleFileSelect: (path: string) => Promise<void>;
  handleTermIdReady: (tabId: string, termId: string) => void;
  handleTermTitleChange: (tabId: string, title: string) => void;
  handleTabClose: (id: string) => void;
  openWorkspace: (path: string) => void;
  changeDirectory: () => void;
  closeDirectory: () => void;
  cursorLine: () => number;
  cursorCol: () => number;
  setCursorLine: (line: number) => void;
  setCursorCol: (col: number) => void;
  diagnosticsMap: () => Map<string, { line: number; col: number; endLine: number; endCol: number; severity: number; message: string }[]>;
}

/** Additional deps needed only by the file editor tab. */
export interface FileTabDeps {
  tabs: () => Tab[];
  setTabs: (fn: (prev: Tab[]) => Tab[]) => void;
  searchMatches: () => SearchMatch[];
  currentSearchIdx: () => number;
  diffHunksMap: () => Record<string, DiffHunk[]>;
  engineMap: Map<string, EditorEngine>;
  getFileTextForTab: (tabId: string) => string | null;
  switchToTab: (id: string) => void;
}

/** A panel type registration. */
export interface PanelDefinition {
  render: (tab: Tab, isActive: Accessor<boolean>, deps: PanelDeps) => JSX.Element;
}

// ── Registry ─────────────────────────────────────────────────────────

const panels = new Map<string, PanelDefinition>();

export function registerPanel(type: string, def: PanelDefinition): void {
  panels.set(type, def);
}

export function getPanel(type: string): PanelDefinition | undefined {
  return panels.get(type);
}
