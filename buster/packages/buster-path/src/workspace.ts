/**
 * Workspace-relative path computation.
 *
 * The IDE needs to display paths relative to the project root in tabs,
 * sidebar, git panel, and breadcrumbs. This module provides that conversion
 * without manual string slicing.
 */

import { normalizePath } from "./normalize.ts";
import { type Platform, pathsEqual } from "./compare.ts";

/**
 * Compute a path relative to a workspace root.
 *
 * Examples:
 *   relativeTo("/home/user/project", "/home/user/project/src/main.ts")
 *   → "src/main.ts"
 *
 *   relativeTo("/home/user/project", "/home/user/other/file.ts")
 *   → "../other/file.ts"
 */
export function relativeTo(
  workspaceRoot: string,
  filePath: string,
  platform?: Platform,
): string {
  const root = normalizePath(workspaceRoot);
  const file = normalizePath(filePath);

  if (pathsEqual(root, file, platform)) return ".";

  const rootParts = root.split("/").filter(Boolean);
  const fileParts = file.split("/").filter(Boolean);

  // Find common prefix length
  let common = 0;
  const compareInsensitive = platform
    ? platform !== "linux"
    : typeof process !== "undefined" && process.platform !== "linux";

  while (common < rootParts.length && common < fileParts.length) {
    const a = rootParts[common]!;
    const b = fileParts[common]!;
    if (compareInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b) {
      common++;
    } else {
      break;
    }
  }

  const ups = rootParts.length - common;
  const downs = fileParts.slice(common);

  const parts: string[] = [];
  for (let i = 0; i < ups; i++) parts.push("..");
  parts.push(...downs);

  return parts.join("/") || ".";
}
