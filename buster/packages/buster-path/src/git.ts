/**
 * Git path format conversion.
 *
 * Git always uses forward slashes and workspace-relative paths in its output.
 * This module converts between OS-native paths and git's format so that
 * git status output can be matched to files in the sidebar tree.
 */

import { normalizePath } from "./normalize.ts";
import { relativeTo } from "./workspace.ts";
import type { Platform } from "./compare.ts";

/**
 * Convert an absolute file path to the format git would use for that file.
 * Git paths are always forward-slash, relative to the repo root.
 *
 * Example:
 *   toGitPath("C:\\Users\\me\\repo\\src\\main.ts", "C:\\Users\\me\\repo")
 *   → "src/main.ts"
 */
export function toGitPath(
  filePath: string,
  repoRoot: string,
  platform?: Platform,
): string {
  return relativeTo(repoRoot, filePath, platform);
}

/**
 * Convert a git-relative path back to an absolute path within a repo.
 *
 * Example:
 *   fromGitPath("src/main.ts", "/home/user/repo")
 *   → "/home/user/repo/src/main.ts"
 */
export function fromGitPath(gitPath: string, repoRoot: string): string {
  const root = normalizePath(repoRoot);
  const cleaned = normalizePath(gitPath);
  return root + "/" + cleaned;
}
