/**
 * file:// URI encoding and decoding.
 *
 * LSP servers communicate exclusively via file:// URIs. Incorrect encoding
 * causes silent failures for paths containing spaces, %, #, or non-ASCII chars.
 */

import { normalizePath } from "./normalize.ts";

/** Characters that must be percent-encoded in a file URI path segment */
const ENCODE_RE = /[%# ?&=+[\]{}|^`<>"]/g;

/** Encode special characters in a single path segment */
function encodeSegment(segment: string): string {
  return segment.replace(ENCODE_RE, (ch) => {
    const code = ch.charCodeAt(0);
    return "%" + code.toString(16).toUpperCase().padStart(2, "0");
  });
}

/**
 * Convert an absolute file path to a properly encoded file:// URI.
 *
 * Examples:
 *   /home/user/my project/file.ts  → file:///home/user/my%20project/file.ts
 *   C:\Users\me\docs\file.ts       → file:///C:/Users/me/docs/file.ts
 *   \\server\share\file.ts         → file://server/share/file.ts
 */
export function pathToUri(filePath: string): string {
  const normalized = normalizePath(filePath);

  // UNC paths: file://server/share/path
  if (normalized.startsWith("//")) {
    const segments = normalized.slice(2).split("/").map(encodeSegment);
    return "file://" + segments.join("/");
  }

  // Windows drive paths: file:///C:/path
  if (/^[A-Z]:\//.test(normalized)) {
    const segments = normalized.split("/").map(encodeSegment);
    return "file:///" + segments.join("/");
  }

  // Unix absolute paths: file:///path
  if (normalized.startsWith("/")) {
    const segments = normalized.slice(1).split("/").map(encodeSegment);
    return "file:///" + segments.join("/");
  }

  throw new Error(`Cannot convert relative path to URI: ${filePath}`);
}

/**
 * Convert a file:// URI back to a native file path.
 *
 * Examples:
 *   file:///home/user/my%20project/file.ts  → /home/user/my project/file.ts
 *   file:///C:/Users/me/docs/file.ts        → C:/Users/me/docs/file.ts
 *   file://server/share/file.ts             → //server/share/file.ts
 */
export function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) {
    throw new Error(`Not a file URI: ${uri}`);
  }

  let path = uri.slice("file://".length);

  // Decode percent-encoded characters
  path = decodeURIComponent(path);

  // file:///C:/... → C:/...
  if (/^\/[a-zA-Z]:\//.test(path)) {
    path = path.slice(1);
    path = path[0]!.toUpperCase() + path.slice(1);
    return normalizePath(path);
  }

  // file://server/share/... → //server/share/...  (UNC)
  if (!path.startsWith("/")) {
    return normalizePath("//" + path);
  }

  // file:///unix/path → /unix/path
  return normalizePath(path);
}
