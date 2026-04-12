/**
 * Breadcrumb generation from file paths.
 *
 * Produces an array of { label, path } segments for the editor breadcrumb bar.
 * Handles drive letters, UNC roots, and workspace-relative display.
 */

import { normalizePath } from "./normalize.ts";
import { relativeTo } from "./workspace.ts";
import type { Platform } from "./compare.ts";

export interface BreadcrumbSegment {
  /** Display label for this segment */
  label: string;
  /** Full path up to and including this segment */
  path: string;
}

/**
 * Generate breadcrumb segments for a file path.
 *
 * If workspaceRoot is provided, the breadcrumbs start from the workspace root
 * and show relative segments. Otherwise, they show the full path.
 *
 * Example:
 *   breadcrumbs("/home/user/project/src/lib/utils.ts", "/home/user/project")
 *   → [
 *       { label: "src",      path: "src" },
 *       { label: "lib",      path: "src/lib" },
 *       { label: "utils.ts", path: "src/lib/utils.ts" },
 *     ]
 */
export function breadcrumbs(
  filePath: string,
  workspaceRoot?: string,
  platform?: Platform,
): BreadcrumbSegment[] {
  const displayPath = workspaceRoot
    ? relativeTo(workspaceRoot, filePath, platform)
    : normalizePath(filePath);

  const parts = displayPath.split("/").filter(Boolean);
  const result: BreadcrumbSegment[] = [];

  for (let i = 0; i < parts.length; i++) {
    result.push({
      label: parts[i]!,
      path: parts.slice(0, i + 1).join("/"),
    });
  }

  return result;
}
