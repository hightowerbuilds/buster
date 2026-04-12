/**
 * BusterContext — central state context for the Buster IDE.
 * Provides the store, engine map, and all action functions.
 */

import { createContext, useContext } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import type { BusterStoreState } from "./store-types";
import type { EditorEngine } from "../editor/engine";
import type { Tab } from "./tab-types";
import type { AppSettings } from "./ipc";
import type { DirtyCloseResult } from "../ui/DirtyCloseDialog";
import type { ExternalChangeResult } from "../ui/ExternalChangeDialog";

// ── Engine map (non-reactive, opaque refs) ──────────────────

export interface EngineMap {
  get(tabId: string): EditorEngine | undefined;
  set(tabId: string, engine: EditorEngine): void;
  delete(tabId: string): void;
  readonly map: Map<string, EditorEngine>;
}

// ── Actions ─────────────────────────────────────────────────

export interface BusterActions {
  // File operations
  handleFileSelect(path: string): Promise<void>;
  handleSave(): Promise<void>;
  handleSync(): Promise<void>;
  loadFileContent(path: string): Promise<{ content: string; fileName: string; filePath: string }>;

  // Tab management
  switchToTab(tabId: string): void;
  handleTabClose(tabId: string): void;
  createTerminalTab(): void;
  createGitTab(): void;
  createSettingsTab(): void;
  createExtensionsTab(): void;
  createManualTab(): void;
  createDebugTab(): void;
  createProblemsTab(): void;
  popOutSidebar(): void;
  handleTermIdReady(tabId: string, ptyId: string): void;

  // Workspace management
  openWorkspace(path: string): void;
  changeDirectory(): Promise<void>;
  closeDirectory(): void;
  refreshGitBranch(root: string): Promise<void>;

  // Dialog results
  handleDirtyCloseResult(result: DirtyCloseResult): Promise<void>;
  handleExternalChangeResult(result: ExternalChangeResult): void;

  // Derived accessors
  activeTab(): Tab | undefined;
  activeEngine(): EditorEngine | null;
  getFileTextForTab(tabId: string): string | null;

  // Settings
  updateSettings(s: AppSettings): void;
  addRecentFile(path: string, name: string): void;

  // Diagnostics
  jumpToDiagnostic(direction: 1 | -1): Promise<void>;
  diagnosticCounts(): { errors: number; warnings: number };

  // Git
  fetchDiffHunks(tabId: string, filePath: string): Promise<void>;

  // Session
  buildSnapshot(): unknown;
  saveSessionNow(): Promise<void>;
}

// ── Context value ───────────────────────────────────────────

export interface BusterContextValue {
  store: BusterStoreState;
  setStore: SetStoreFunction<BusterStoreState>;
  engines: EngineMap;
  actions: BusterActions;
}

// ── Context + hook ──────────────────────────────────────────

const BusterContext = createContext<BusterContextValue>();

export function useBuster(): BusterContextValue {
  const ctx = useContext(BusterContext);
  if (!ctx) throw new Error("useBuster() must be used within <BusterProvider>");
  return ctx;
}

export { BusterContext };
