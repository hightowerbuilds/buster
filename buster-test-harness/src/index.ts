export { createWorkspace, type Workspace, type FileTree } from "./fixtures.ts";
export { run, runExpectSuccess, type RunOptions, type RunResult } from "./runner.ts";
export {
  assertFileContains,
  assertFileEquals,
  assertFileExists,
  assertFileNotExists,
  assertGitStatus,
  assertCompletesWithin,
} from "./assertions.ts";
export {
  TauriRunner,
  type TauriRunnerOptions,
  type CommandResult,
  type AppState,
} from "./tauri-runner.ts";
export {
  LspTestClient,
  type Diagnostic,
  type CompletionItem,
  type HoverResult,
  type LocationResult,
} from "./lsp-tests.ts";
export {
  ExtensionTestHarness,
  type ExtensionState,
  type ExtensionInfo,
  type ExtensionManifest,
  type HostContext,
} from "./extension-tests.ts";
export {
  generateGitHubActions,
  type Platform,
  type CIOptions,
} from "./ci-config.ts";
export {
  SecurityTestSuite,
  type SecurityTestResult,
  type SecurityTestOptions,
} from "./security-tests.ts";
