import { invoke } from "@tauri-apps/api/core";

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

export const writeFile = (path: string, content: string) =>
  invoke<void>("write_file", { path, content });

export const listDirectory = (path: string) =>
  invoke<DirEntry[]>("list_directory", { path });

export const watchFile = (path: string) =>
  invoke<void>("watch_file", { path });

export const unwatchFile = (path: string) =>
  invoke<void>("unwatch_file", { path });

export const moveEntry = (source: string, destDir: string) =>
  invoke<string>("move_entry", { source, destDir });

export const createFile = (path: string) =>
  invoke<void>("create_file", { path });

export const createDirectory = (path: string) =>
  invoke<void>("create_directory", { path });

export const renameEntry = (oldPath: string, newName: string) =>
  invoke<string>("rename_entry", { oldPath, newName });

export const deleteEntry = (path: string) =>
  invoke<void>("delete_entry", { path });

export interface BinaryFileContent {
  path: string;
  data_url: string;
  file_name: string;
  size: number;
}

export const readBinaryFile = (path: string) =>
  invoke<BinaryFileContent>("read_binary_file", { path });

export const setWorkspaceRootIpc = (path: string | null) =>
  invoke<void>("set_workspace_root", { path });

// Terminal
export const terminalKill = (termId: string) =>
  invoke<void>("terminal_kill", { termId });

export const setTerminalTheme = (themeName: string) =>
  invoke<void>("set_terminal_theme", { themeName });

// Settings
export interface AppSettings {
  word_wrap: boolean;
  font_size: number;
  tab_size: number;
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
  agent_max_tool_calls: number;
  agent_max_writes: number;
  agent_max_commands: number;
  agent_timeout_secs: number;
  keybindings?: Record<string, string>;
  terminal_theme?: string;
}

export const loadSettings = () =>
  invoke<AppSettings>("load_settings");

export const saveSettings = (settings: AppSettings) =>
  invoke<void>("save_settings", { settings });

export const addRecentFolder = (folder: string) =>
  invoke<AppSettings>("add_recent_folder", { folder });

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

// Git
export interface GitFileStatus {
  path: string;
  status: string;
  staged: boolean;
  conflicted: boolean;
}

export interface ConflictRegion {
  ours: string;
  theirs: string;
  start_line: number;
  end_line: number;
}

export interface GitStatusResult {
  branch: string;
  files: GitFileStatus[];
}

export const gitStatus = (workspaceRoot: string) =>
  invoke<GitStatusResult>("git_status", { workspaceRoot });

export const gitBranch = (workspaceRoot: string) =>
  invoke<string>("git_branch", { workspaceRoot });

export const gitStage = (workspaceRoot: string, path: string) =>
  invoke<void>("git_stage", { workspaceRoot, path });

export const gitUnstage = (workspaceRoot: string, path: string) =>
  invoke<void>("git_unstage", { workspaceRoot, path });

export const gitCommit = (workspaceRoot: string, message: string) =>
  invoke<string>("git_commit", { workspaceRoot, message });

export const gitDiffFile = (workspaceRoot: string, path: string) =>
  invoke<string>("git_diff_file", { workspaceRoot, path });

export const gitDiffStaged = (workspaceRoot: string, path: string) =>
  invoke<string>("git_diff_staged", { workspaceRoot, path });

export const gitShowFile = (workspaceRoot: string, path: string) =>
  invoke<string>("git_show_file", { workspaceRoot, path });

export interface GitCommitNode {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  date: string;
  refs: string[];
  parents: string[];
  is_merge: boolean;
}

export const gitLogGraph = (workspaceRoot: string, count?: number) =>
  invoke<GitCommitNode[]>("git_log_graph", { workspaceRoot, count });

export const gitIsRepo = (workspaceRoot: string) =>
  invoke<boolean>("git_is_repo", { workspaceRoot });

// Push / Pull / Fetch
export const gitPush = (workspaceRoot: string, remote?: string, branch?: string, force?: boolean) =>
  invoke<string>("git_push", { workspaceRoot, remote, branch, force });

export const gitPull = (workspaceRoot: string, remote?: string, branch?: string, rebase?: boolean) =>
  invoke<string>("git_pull", { workspaceRoot, remote, branch, rebase });

export const gitFetch = (workspaceRoot: string, remote?: string, prune?: boolean) =>
  invoke<string>("git_fetch", { workspaceRoot, remote, prune });

export const gitAheadBehind = (workspaceRoot: string) =>
  invoke<[number, number]>("git_ahead_behind", { workspaceRoot });

// Branch operations
export interface GitBranchInfo {
  name: string;
  is_current: boolean;
  is_remote: boolean;
  tracking: string | null;
}

export const gitBranchList = (workspaceRoot: string) =>
  invoke<GitBranchInfo[]>("git_branch_list", { workspaceRoot });

export const gitBranchCreate = (workspaceRoot: string, name: string, startPoint?: string) =>
  invoke<void>("git_branch_create", { workspaceRoot, name, startPoint });

export const gitBranchSwitch = (workspaceRoot: string, name: string) =>
  invoke<void>("git_branch_switch", { workspaceRoot, name });

export const gitBranchDelete = (workspaceRoot: string, name: string, force?: boolean) =>
  invoke<void>("git_branch_delete", { workspaceRoot, name, force });

// Stash operations
export interface GitStashEntry {
  index: number;
  message: string;
  date: string;
}

export const gitStashSave = (workspaceRoot: string, message?: string, includeUntracked?: boolean) =>
  invoke<string>("git_stash_save", { workspaceRoot, message, includeUntracked });

export const gitStashPop = (workspaceRoot: string, index?: number) =>
  invoke<string>("git_stash_pop", { workspaceRoot, index });

export const gitStashList = (workspaceRoot: string) =>
  invoke<GitStashEntry[]>("git_stash_list", { workspaceRoot });

export const gitStashDrop = (workspaceRoot: string, index: number) =>
  invoke<void>("git_stash_drop", { workspaceRoot, index });

// Commit amend
export const gitCommitAmend = (workspaceRoot: string, message?: string) =>
  invoke<string>("git_commit_amend", { workspaceRoot, message });
export const gitConflictMarkers = (workspaceRoot: string, filePath: string) =>
  invoke<ConflictRegion[]>("git_conflict_markers", { workspaceRoot, filePath });

export const gitResolveConflict = (workspaceRoot: string, filePath: string, resolvedContent: string) =>
  invoke<void>("git_resolve_conflict", { workspaceRoot, filePath, resolvedContent });
// Remote management
export interface GitRemote {
  name: string;
  url: string;
}

export const gitRemoteList = (workspaceRoot: string) =>
  invoke<GitRemote[]>("git_remote_list", { workspaceRoot });

export const gitRemoteAdd = (workspaceRoot: string, name: string, url: string) =>
  invoke<void>("git_remote_add", { workspaceRoot, name, url });

export const gitRemoteRemove = (workspaceRoot: string, name: string) =>
  invoke<void>("git_remote_remove", { workspaceRoot, name });

export const gitRemoteRename = (workspaceRoot: string, oldName: string, newName: string) =>
  invoke<void>("git_remote_rename", { workspaceRoot, oldName, newName });

export const gitRemoteSetUrl = (workspaceRoot: string, name: string, url: string) =>
  invoke<void>("git_remote_set_url", { workspaceRoot, name, url });

export interface DiffHunk {
  start_line: number;
  line_count: number;
  kind: "add" | "modify" | "delete";
}

export const gitDiffHunks = (workspaceRoot: string, path: string) =>
  invoke<DiffHunk[]>("git_diff_hunks", { workspaceRoot, path });
export interface GitBlameLine {
  hash: string;
  author: string;
  timestamp: number;
  line: number;
}

export const gitBlame = (workspaceRoot: string, path: string) =>
  invoke<GitBlameLine[]>("git_blame", { workspaceRoot, path });

// GitHub (gh CLI)
export interface GhAuthStatus { logged_in: boolean; username: string; }
export interface GhRepoInfo { name: string; owner: { login: string }; description: string | null; url: string; defaultBranchRef: { name: string } | null; }
export interface GhPullRequest { number: number; title: string; state: string; author: { login: string }; createdAt: string; url: string; headRefName: string; }
export interface GhPrFile { path: string; additions: number; deletions: number; }
export interface GhPullRequestDetail { number: number; title: string; body: string; state: string; author: { login: string }; createdAt: string; url: string; headRefName: string; additions: number; deletions: number; files: GhPrFile[]; }
export interface GhIssue { number: number; title: string; state: string; author: { login: string }; createdAt: string; url: string; labels: { name: string }[]; }
export interface GhComment { author: { login: string }; body: string; createdAt: string; }
export interface GhIssueDetail { number: number; title: string; body: string; state: string; author: { login: string }; createdAt: string; url: string; labels: { name: string }[]; comments: GhComment[]; }

export const ghAuthStatus = (workspaceRoot: string) =>
  invoke<GhAuthStatus>("gh_auth_status", { workspaceRoot });
export const ghRepoInfo = (workspaceRoot: string) =>
  invoke<GhRepoInfo>("gh_repo_info", { workspaceRoot });
export const ghPrList = (workspaceRoot: string, state?: string, limit?: number) =>
  invoke<GhPullRequest[]>("gh_pr_list", { workspaceRoot, state, limit });
export const ghPrView = (workspaceRoot: string, number: number) =>
  invoke<GhPullRequestDetail>("gh_pr_view", { workspaceRoot, number });
export const ghIssueList = (workspaceRoot: string, state?: string, limit?: number) =>
  invoke<GhIssue[]>("gh_issue_list", { workspaceRoot, state, limit });
export const ghIssueView = (workspaceRoot: string, number: number) =>
  invoke<GhIssueDetail>("gh_issue_view", { workspaceRoot, number });

// LSP
export interface LspCompletionItem {
  label: string;
  detail: string | null;
  kind: string | null;
}

export interface LspHoverResult {
  contents: string;
}

export interface LspLocation {
  file_path: string;
  line: number;
  col: number;
}

export const lspStart = (filePath: string, workspaceRoot: string) =>
  invoke<boolean>("lsp_start", { filePath, workspaceRoot });

export interface EditDelta {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  newText: string;
}

export const lspDidChange = (filePath: string, text: string, version: number) =>
  invoke<void>("lsp_did_change", { filePath, text, version });

export const lspDidChangeIncremental = (filePath: string, edits: EditDelta[], version: number) =>
  invoke<void>("lsp_did_change_incremental", { filePath, edits, version });

export const lspDidSave = (filePath: string) =>
  invoke<void>("lsp_did_save", { filePath });

export const lspCompletion = (filePath: string, line: number, col: number) =>
  invoke<LspCompletionItem[]>("lsp_completion", { filePath, line, col });

export const lspHover = (filePath: string, line: number, col: number) =>
  invoke<LspHoverResult>("lsp_hover", { filePath, line, col });

export const lspDefinition = (filePath: string, line: number, col: number) =>
  invoke<LspLocation[]>("lsp_definition", { filePath, line, col });

export interface LspSignatureParam {
  label: string;
}

export interface LspSignatureHelp {
  label: string;
  active_parameter: number;
  parameters: LspSignatureParam[];
  documentation: string;
}

export const lspSignatureHelp = (filePath: string, line: number, col: number) =>
  invoke<LspSignatureHelp | null>("lsp_signature_help", { filePath, line, col });

export interface LspTextEdit {
  file_path: string;
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
  new_text: string;
}

export interface LspCodeAction {
  title: string;
  kind: string;
  index: number;
  edits: LspTextEdit[];
}

export const lspCodeAction = (filePath: string, startLine: number, startCol: number, endLine: number, endCol: number) =>
  invoke<LspCodeAction[]>("lsp_code_action", { filePath, startLine, startCol, endLine, endCol });

export interface LspInlayHint {
  line: number;
  col: number;
  label: string;
  kind: string;
}

export const lspInlayHints = (filePath: string, startLine: number, endLine: number) =>
  invoke<LspInlayHint[]>("lsp_inlay_hints", { filePath, startLine, endLine });

export interface LspDocumentSymbol {
  name: string;
  kind: string;
  line: number;
  col: number;
}

export const lspDocumentSymbol = (filePath: string, workspaceRoot: string) =>
  invoke<LspDocumentSymbol[]>("lsp_document_symbol", { filePath, workspaceRoot });

export interface LspTextEditResult {
  file_path: string;
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
  new_text: string;
}

export interface LspLocationResult {
  file_path: string;
  line: number;
  col: number;
}

export const lspRename = (filePath: string, line: number, col: number, newName: string) =>
  invoke<LspTextEditResult[]>("lsp_rename", { filePath, line, col, newName });

export const lspReferences = (filePath: string, line: number, col: number) =>
  invoke<LspLocationResult[]>("lsp_references", { filePath, line, col });

export const lspStop = (language: string) =>
  invoke<void>("lsp_stop", { language });

export const lspStatus = () =>
  invoke<string[]>("lsp_status");

// Autocomplete
export interface CompletionItem {
  label: string;
  detail: string;
}

// AI Agent
export interface AiChatRequest {
  prompt: string;
  api_key: string;
  model?: string;
  provider?: string;
  base_url?: string;
  workspace_root?: string;
}

export interface AgentEvent {
  kind: "text" | "tool_call" | "tool_result" | "tool_approval" | "done" | "error";
  content: string;
  tool_name: string | null;
}

export const aiChat = (request: AiChatRequest) =>
  invoke<void>("ai_chat", { request });

export const storeApiKey = (key: string) =>
  invoke<void>("store_api_key", { key });

export const loadApiKey = () =>
  invoke<string | null>("load_api_key");

export const deleteApiKey = () =>
  invoke<void>("delete_api_key");
export const aiApproveTool = (requestId: string, approved: boolean) =>
  invoke<void>("ai_approve_tool", { requestId, approved });

export const aiCancel = () =>
  invoke<void>("ai_cancel");

// Extensions
export interface ExtensionCommand {
  id: string;
  label: string;
}

export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  commands: ExtensionCommand[];
  active: boolean;
}

export interface GatewayEvent {
  connection_id: number;
  extension_id: string;
  kind: "connected" | "text" | "tool_call" | "tool_result" | "done" | "error" | "disconnected";
  content: string;
  tool_name: string | null;
}

export interface GatewayConfig {
  protocol: "websocket" | "http-sse";
  url: string;
  auth_token?: string;
  auth_header?: string;
  headers?: Record<string, string>;
}

export const extList = () =>
  invoke<ExtensionInfo[]>("ext_list");

export const extLoad = (extensionId: string) =>
  invoke<ExtensionInfo>("ext_load", { extensionId });

export const extUnload = (extensionId: string) =>
  invoke<void>("ext_unload", { extensionId });

export const extRestore = () =>
  invoke<string[]>("ext_restore");

export const extGatewayConnect = (extensionId: string, config: GatewayConfig) =>
  invoke<number>("ext_gateway_connect", { extensionId, config });

export const extGatewaySend = (connectionId: number, message: string) =>
  invoke<void>("ext_gateway_send", { connectionId, message });

export const extGatewayDisconnect = (connectionId: number) =>
  invoke<void>("ext_gateway_disconnect", { connectionId });

export const extCall = (extensionId: string, method: string, params?: string) =>
  invoke<string>("ext_call", { extensionId, method, params });

export const extInstall = (sourcePath: string) =>
  invoke<ExtensionInfo>("ext_install", { sourcePath });

export const extUninstall = (extensionId: string) =>
  invoke<void>("ext_uninstall", { extensionId });

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
}

export interface SessionState {
  version: number;
  workspace_root: string | null;
  active_tab_id: string | null;
  layout_mode: string;
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

export const clearSession = () =>
  invoke<void>("clear_session");

export const confirmAppClose = () =>
  invoke<void>("confirm_app_close");

export const setRunningFlag = () =>
  invoke<boolean>("set_running_flag");

export const clearRunningFlag = () =>
  invoke<void>("clear_running_flag");

// Large file buffer
export const fileIsLarge = (path: string) =>
  invoke<boolean>("file_is_large", { path });

export const largeFileOpen = (path: string) =>
  invoke<number>("large_file_open", { path });

export const largeFileReadLines = (path: string, start: number, count: number) =>
  invoke<string[]>("large_file_read_lines", { path, start, count });

export const largeFileLineCount = (path: string) =>
  invoke<number>("large_file_line_count", { path });

export const largeFileClose = (path: string) =>
  invoke<void>("large_file_close", { path });

// ── Debugger ────────────────────────────────────────────────

export interface DebugBreakpoint {
  line: number;
  condition: string | null;
}

export interface DebugStackFrame {
  id: number;
  name: string;
  file_path: string | null;
  line: number;
  col: number;
}

export interface DebugVariable {
  name: string;
  value: string;
  var_type: string | null;
  variables_reference: number;
}

export const debugToggleBreakpoint = (filePath: string, line: number) =>
  invoke<boolean>("debug_toggle_breakpoint", { filePath, line });

export const debugGetBreakpoints = (filePath: string) =>
  invoke<DebugBreakpoint[]>("debug_get_breakpoints", { filePath });

export const debugState = () =>
  invoke<string>("debug_state");

export const debugLaunch = (adapterCmd: string, adapterArgs: string[], program: string, workspaceRoot: string) =>
  invoke<void>("debug_launch", { adapterCmd, adapterArgs, program, workspaceRoot });

export const debugContinue = () => invoke<void>("debug_continue");
export const debugStepOver = () => invoke<void>("debug_step_over");
export const debugStepInto = () => invoke<void>("debug_step_into");
export const debugStepOut = () => invoke<void>("debug_step_out");
export const debugPause = () => invoke<void>("debug_pause");
export const debugStop = () => invoke<void>("debug_stop");

export const debugStackTrace = () =>
  invoke<DebugStackFrame[]>("debug_stack_trace");

export const debugVariables = (variablesReference: number) =>
  invoke<DebugVariable[]>("debug_variables", { variablesReference });

// ── Remote SSH ──────────────────────────────────────────────

export interface RemoteConnectionInfo {
  host: string;
  user: string;
  remote_root: string;
  connected: boolean;
}

export interface RemoteFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export interface RemoteFileContent {
  path: string;
  content: string;
  file_name: string;
}

export const remoteConnect = (host: string, user: string, remoteRoot: string, port?: number, password?: string) =>
  invoke<void>("remote_connect", { host, port, user, remoteRoot, password });

export const remoteDisconnect = () =>
  invoke<void>("remote_disconnect");

export const remoteStatus = () =>
  invoke<RemoteConnectionInfo | null>("remote_status");

export const remoteListDirectory = (path: string) =>
  invoke<RemoteFileEntry[]>("remote_list_directory", { path });

export const remoteReadFile = (path: string) =>
  invoke<RemoteFileContent>("remote_read_file", { path });

export const remoteWriteFile = (path: string, content: string) =>
  invoke<void>("remote_write_file", { path, content });

export const remoteExec = (command: string) =>
  invoke<string>("remote_exec", { command });

// ── Collaborative Editing ───────────────────────────────────

export interface CollabPeer {
  id: string;
  name: string;
  cursor_line: number;
  cursor_col: number;
  color: string;
}

export interface CollabOperation {
  client_id: string;
  doc_path: string;
  op: { Insert?: { pos: number; text: string }; Delete?: { pos: number; len: number } };
  timestamp: number;
}

export const collabStartSession = (docPath: string, initialText: string) =>
  invoke<string>("collab_start_session", { docPath, initialText });

export const collabEndSession = (docPath: string) =>
  invoke<void>("collab_end_session", { docPath });

export const collabInsert = (docPath: string, pos: number, text: string) =>
  invoke<CollabOperation>("collab_insert", { docPath, pos, text });

export const collabDelete = (docPath: string, pos: number, len: number) =>
  invoke<CollabOperation>("collab_delete", { docPath, pos, len });

export const collabApplyRemote = (operation: CollabOperation) =>
  invoke<void>("collab_apply_remote", { operation });

export const collabGetText = (docPath: string) =>
  invoke<string>("collab_get_text", { docPath });

export const collabGetPeers = (docPath: string) =>
  invoke<CollabPeer[]>("collab_get_peers", { docPath });

export const collabUpdateCursor = (clientId: string, docPath: string, line: number, col: number) =>
  invoke<void>("collab_update_cursor", { update: { client_id: clientId, doc_path: docPath, line, col } });

export const collabActiveSessions = () =>
  invoke<string[]>("collab_active_sessions");
