import { invoke } from "@tauri-apps/api/core";

export interface NotesWorkspace { root: string; first_run: boolean; desktop_link: string | null; warning: string | null; }
export const initializeNotesWorkspace = () => invoke<NotesWorkspace>("initialize_notes_workspace");

export interface FileContent {
  path: string;
  content: string;
  file_name: string;
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

// File commands
export const readFile = (path: string) =>
  invoke<FileContent>("read_file", { path });

export const writeFile = (path: string, content: string, mustExist = false) =>
  invoke<void>("write_file", { path, content, mustExist });

export const listDirectory = (path: string) =>
  invoke<DirEntry[]>("list_directory", { path });

export const watchFile = (path: string) =>
  invoke<void>("watch_file", { path });

export const unwatchFile = (path: string) =>
  invoke<void>("unwatch_file", { path });

function entryChanged(oldPath: string, newPath: string | null) {
  window.dispatchEvent(new CustomEvent("buster-entry-changed", { detail: { oldPath, newPath } }));
}
export const moveEntry = async (source: string, destDir: string) => {
  const path = await invoke<string>("move_entry", { source, destDir });
  entryChanged(source, path);
  return path;
};

export const createFile = (path: string) =>
  invoke<void>("create_file", { path });

export const createDirectory = (path: string) =>
  invoke<void>("create_directory", { path });

export const renameEntry = async (oldPath: string, newName: string) => {
  const path = await invoke<string>("rename_entry", { oldPath, newName });
  entryChanged(oldPath, path);
  return path;
};

export const deleteEntry = async (path: string) => {
  await invoke<void>("delete_entry", { path });
  entryChanged(path, null);
};

export const setWorkspaceRootIpc = (path: string | null) =>
  invoke<void>("set_workspace_root", { path });

// Terminal
export const terminalKill = (termId: string) =>
  invoke<void>("terminal_kill", { termId });

export const setTerminalTheme = (colors: Record<string, string>) =>
  invoke<void>("set_terminal_theme", { colors });

// Settings
export interface AppSettings {
  word_wrap: boolean;
  font_size: number;
  font_family: string;
  tab_size: number;
  use_spaces: boolean;
  minimap: boolean;
  line_numbers: boolean;
  cursor_blink: boolean;
  autocomplete: boolean;
  ui_zoom: number;
  recent_folders: string[];
  theme_mode: string;
  theme_hue: number;
  effect_cursor_glow: number;
  effect_vignette: number;
  effect_grain: number;
  keybindings?: Record<string, string>;
  auto_save: boolean;
  auto_save_delay_ms: number;
  blog_theme: string;
  show_indent_guides: boolean;
  show_whitespace: boolean;
  terminal_font_family: string;
  terminal_shell: string;
  terminal_bell_mode: string;
  terminal_scrollback_rows: number;
  ai_completion_enabled: boolean;
  ai_provider: string;
  ai_api_key: string;
  ai_model: string;
  ai_local_model: string;
  ai_ollama_url: string;
  ai_stop_on_newline: boolean;
  ai_debounce_local_ms: number;
  ai_debounce_cloud_ms: number;
  ai_min_prefix_chars: number;
  ai_cache_enabled: boolean;
  ai_cache_size: number;
  ai_disabled_languages: string[];
  ai_token_budget_monthly: number;
}

export const loadSettings = () =>
  invoke<AppSettings>("load_settings");

export const saveSettings = (settings: AppSettings) =>
  invoke<void>("save_settings", { settings });

export const addRecentFolder = (folder: string) =>
  invoke<AppSettings>("add_recent_folder", { folder });

export interface AiProviderValidationRequest {
  provider: string;
  api_key: string;
  model: string;
  ollama_url: string;
}

export interface AiProviderValidation {
  ok: boolean;
  message: string;
}

export interface AiCompletionUsage {
  estimated_tokens: number;
  monthly_budget: number;
}

export const aiCompletionOllamaModels = (ollamaUrl: string) =>
  invoke<string[]>("ai_completion_ollama_models", { ollamaUrl });

export const aiCompletionValidateProvider = (request: AiProviderValidationRequest) =>
  invoke<AiProviderValidation>("ai_completion_validate_provider", { request });

export const aiCompletionUsage = () =>
  invoke<AiCompletionUsage>("ai_completion_usage");

// Search
export interface SearchMatch {
  line: number;
  start_col: number;
  end_col: number;
}

// Workspace files
export interface WorkspaceFile {
  path: string;
  relative_path: string;
  name: string;
}

export const listWorkspaceFiles = (root: string) =>
  invoke<WorkspaceFile[]>("list_workspace_files", { root });

// Workspace content search
export interface WorkspaceSearchResult {
  path: string;
  relative_path: string;
  line_number: number;
  line_content: string;
  col: number;
}

export const workspaceSearch = (workspaceRoot: string, query: string) =>
  invoke<WorkspaceSearchResult[]>("workspace_search", { workspaceRoot, query });

// Multi-cursor editing
export interface CursorPos {
  line: number;
  col: number;
}

// Autocomplete
export interface CompletionItem {
  label: string;
  detail: string;
  documentation?: string;
}

// ── Session ─────────────────────────────────────────────────────────

export interface SessionTab {
  id: string;
  type: string;
  name: string;
  path: string;
  dirty: boolean;
  cursor_line: number;
  cursor_col: number;
  scroll_top: number;
  backup_key: string | null;
  selection?: import("../editor/engine").Selection | null;
}

export interface SessionState {
  version: number;
  workspace_root: string | null;
  active_tab_id: string | null;
  layout_mode: string;
  pane_workspace?: import("./writing-panes").PaneWorkspace | null;
  sidebar_visible: boolean;
  sidebar_width: number;
  tabs: SessionTab[];
  timestamp: string;
}

export const saveSession = (session: SessionState) =>
  invoke<void>("save_session", { session });

export const loadSession = () =>
  invoke<SessionState | null>("load_session");

export const saveBackupBuffer = (filePath: string, content: string) =>
  invoke<string>("save_backup_buffer", { filePath, content });

export const loadBackupBuffer = (backupKey: string) =>
  invoke<string | null>("load_backup_buffer", { backupKey });

export const deleteBackupBuffer = (backupKey: string) =>
  invoke<void>("delete_backup_buffer", { backupKey });

export const confirmAppClose = () =>
  invoke<void>("confirm_app_close");

export const setRunningFlag = () =>
  invoke<boolean>("set_running_flag");

// Large file buffer
export const largeFileOpen = (path: string) =>
  invoke<number>("large_file_open", { path });

export const largeFileReadLines = (path: string, start: number, count: number) =>
  invoke<string[]>("large_file_read_lines", { path, start, count });

export const largeFileClose = (path: string) =>
  invoke<void>("large_file_close", { path });
