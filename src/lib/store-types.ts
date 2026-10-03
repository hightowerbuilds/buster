/**
 * Central store type for the Buster IDE.
 * Used with SolidJS createStore + createContext.
 */

import type { Tab } from "./tab-types";
import type { SplitView } from "./split-view";
import type { SearchMatch, DiffHunk, AppSettings } from "./ipc";
import type { ThemePalette } from "./theme";

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
  splitView: SplitView | null;
  fileTexts: Record<string, string>;
  scrollPositions: Record<string, number>;
  fileTabCounter: number;

  // ── Cursor ──────────────────────────────────────────────
  cursorLine: number;
  cursorCol: number;

  // ── UI toggles ─────────────────────────────────────────
  findVisible: boolean;
  paletteVisible: boolean;
  paletteInitialQuery: string;
  branchPickerVisible: boolean;
  syncing: boolean;
  fileLoading: boolean;

  // ── Layout ──────────────────────────────────────────────
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
  currentSearchIdx: number;
  diagnosticsMap: Record<string, Diagnostic[]>;

  // ── Settings / theme ───────────────────────────────────
  settings: AppSettings;
  palette: ThemePalette;
  // ── Workspace ──────────────────────────────────────────
  workspaceRoot: string | null;
  notesRoot: string | null;
  notesDesktopLink: string | null;
  notesStorageWarning: string | null;
  activeFilePath: string | null;

  // ── Navigation history ──────────────────────────────────
  navHistory: NavHistoryEntry[];
  navHistoryIdx: number;

  // ── Misc ───────────────────────────────────────────────
  recentFiles: RecentFile[];
  tabTrapping: boolean;
  lspState: LspState;
  lspLanguages: string[];
}

export interface NavHistoryEntry {
  path: string;
  line: number;
  col: number;
}
