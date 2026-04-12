/**
 * Path comparison utilities.
 *
 * macOS and Windows use case-insensitive filesystems by default.
 * Linux uses case-sensitive. Raw string === comparison breaks on case
 * mismatch for macOS/Windows, causing silent file lookup failures.
 */

import { normalizePath } from "./normalize.ts";

export type Platform = "linux" | "darwin" | "win32";

/** Detect the current platform, defaulting to the Node/Bun process value */
function detectPlatform(): Platform {
  if (typeof process !== "undefined" && process.platform) {
    return process.platform as Platform;
  }
  return "linux"; // safe default: case-sensitive is the stricter behavior
}

/**
 * Compare two paths for equality, respecting platform case sensitivity.
 *
 * - Linux: case-sensitive
 * - macOS/Windows: case-insensitive
 */
export function pathsEqual(
  a: string,
  b: string,
  platform?: Platform,
): boolean {
  const p = platform ?? detectPlatform();
  const normA = normalizePath(a);
  const normB = normalizePath(b);

  if (p === "linux") {
    return normA === normB;
  }
  return normA.toLowerCase() === normB.toLowerCase();
}

/**
 * Check if `child` is inside `parent` directory.
 * Handles trailing slashes and platform case rules.
 */
export function isDescendant(
  parent: string,
  child: string,
  platform?: Platform,
): boolean {
  const p = platform ?? detectPlatform();
  let normParent = normalizePath(parent);
  let normChild = normalizePath(child);

  if (p !== "linux") {
    normParent = normParent.toLowerCase();
    normChild = normChild.toLowerCase();
  }

  if (!normParent.endsWith("/")) {
    normParent += "/";
  }

  return normChild.startsWith(normParent);
}
