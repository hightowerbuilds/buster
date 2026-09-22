/**
 * Central store type for the Buster IDE.
 * Used with SolidJS createStore + createContext.
 */

import type { Tab } from "./tab-types";
import type { SearchMatch, AppSettings } from "./ipc";
import type { ThemePalette } from "./theme";
import type { PanelCount } from "./panel-count";
import type { PaneWorkspace } from "./writing-panes";


export interface RecentFile {
  path: string;
  name: string;
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
  fileLoading: boolean;

  // ── Layout ──────────────────────────────────────────────
  panelCount: PanelCount;
  splitDirection: "row" | "column";
  paneWorkspace: PaneWorkspace;
  sidebarWidth: number;
  sidebarVisible: boolean;


  // ── Dialogs ─────────────────────────────────────────────
  dirtyCloseTabId: string | null;
  dirtyCloseFileName: string;
  extChangeTabId: string | null;
  extChangeFileName: string;

  // ── Editor data ────────────────────────────────────────
  searchMatches: SearchMatch[];
  currentSearchIdx: number;

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
}

export interface NavHistoryEntry {
  path: string;
  line: number;
  col: number;
}
