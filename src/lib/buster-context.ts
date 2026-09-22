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
import type { FeatureCommands } from "./feature-commands";

// ── Engine map (non-reactive, opaque refs) ──────────────────

export interface EngineMap {
  revision(): number;
  get(tabId: string): EditorEngine | undefined;
  set(tabId: string, engine: EditorEngine): void;
  delete(tabId: string): void;
  readonly map: Map<string, EditorEngine>;
}

// ── Actions ─────────────────────────────────────────────────

export interface BusterActions {
  panes: import("./actions-panes").PaneActions;
  // File operations
  createNewFile(): string;
  handleFileSelect(path: string): Promise<void>;
  handleSave(): Promise<void>;
  handleSaveAs(): Promise<void>;
  saveTab(tabId: string, options?: { silent?: boolean; requirePath?: boolean }): Promise<void>;
  loadFileContent(path: string): Promise<{ content: string; fileName: string; filePath: string }>;

  // Tab management
  switchToTab(tabId: string): void;
  handleTabClose(tabId: string): void;
  createTerminalTab(): string;
  createSettingsTab(): void;
  createKeybindingsTab(): void;
  createAiTab(): void;
  handleTermIdReady(tabId: string, ptyId: string): void;
  handleTermTitleChange(tabId: string, title: string): void;

  // Workspace management
  openWorkspace(path: string): void;
  changeDirectory(): Promise<void>;
  closeDirectory(): void;

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



  // Git

  // Navigation history
  pushNavHistory(path: string, line: number, col: number): void;
  navigateBack(): void;
  navigateForward(): void;

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
  commands: FeatureCommands;
  appearance: import("./writing-appearance").WritingAppearance;
  agent: import("./agent-connection").AgentConnection;
  formatting: import("./writing-format").WritingFormatting;
  search: import("./search-portal").SearchPortalService;
  writing: import("./writing-review").WritingReviewService;
  speech: ReturnType<typeof import("./speech").createSpeech>;
}

// ── Context + hook ──────────────────────────────────────────

const BusterContext = createContext<BusterContextValue>();

export function useBuster(): BusterContextValue {
  const ctx = useContext(BusterContext);
  if (!ctx) throw new Error("useBuster() must be used within <BusterProvider>");
  return ctx;
}

export { BusterContext };
