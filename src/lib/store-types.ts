/**
 * Central store type for the Buster IDE.
 * Used with SolidJS createStore + createContext.
 */

import type { Tab } from "./tab-types";
import type { SearchMatch, DiffHunk, AppSettings, DebugStackFrame, DebugVariable } from "./ipc";
import type { DebugSessionState } from "./debug-events";
import type { ThemePalette } from "./theme";
import type { PanelCount } from "./panel-count";

export type LspState = "inactive" | "starting" | "active" | "error" | "crashed";

export interface RecentFile {
  path: string;
  name: string;
}

export interface Diagnostic {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  severity: number;
  message: string;
}

export interface BusterStoreState {
  // ── Tabs ────────────────────────────────────────────────
  tabs: Tab[];
  activeTabId: string | null;
  fileTexts: Record<string, string>;
  scrollPositions: Record<string, number>;
  termPtyIds: Record<string, string>;
  terminalCounter: number;
  fileTabCounter: number;

  // ── Cursor ──────────────────────────────────────────────
  cursorLine: number;
  cursorCol: number;

  // ── UI toggles ─────────────────────────────────────────
  findVisible: boolean;
  paletteVisible: boolean;
  paletteInitialQuery: string;
  tourActive: boolean;
  branchPickerVisible: boolean;
  syncing: boolean;
  fileLoading: boolean;

  // ── Layout ──────────────────────────────────────────────
  panelCount: PanelCount;
  sidebarWidth: number;
  sidebarVisible: boolean;

  // ── Git ─────────────────────────────────────────────────
  gitBranchName: string | null;
  diffHunksMap: Record<string, DiffHunk[]>;

  // ── Dialogs ─────────────────────────────────────────────
  dirtyCloseTabId: string | null;
  dirtyCloseFileName: string;
  extChangeTabId: string | null;
  extChangeFileName: string;

  // ── Editor data ────────────────────────────────────────
  searchMatches: SearchMatch[];
  diagnosticsMap: Record<string, Diagnostic[]>;

  // ── Settings / theme ───────────────────────────────────
  settings: AppSettings;
  palette: ThemePalette;
  // ── Workspace ──────────────────────────────────────────
  workspaceRoot: string | null;
  activeFilePath: string | null;

  // ── Debug ──────────────────────────────────────────────
  debugModeVisible: boolean;
  debugSessionState: DebugSessionState;
  debugStackFrames: DebugStackFrame[];
  debugVariables: DebugVariable[];
  debugOutput: string[];
  debugSelectedFrameId: number | null;

  // ── Misc ───────────────────────────────────────────────
  recentFiles: RecentFile[];
  tabTrapping: boolean;
  lspState: LspState;
  lspLanguages: string[];
  vimMode: string | null;
}
