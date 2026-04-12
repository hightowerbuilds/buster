/**
 * Path normalization — converts any path into a consistent forward-slash format,
 * resolves `.` and `..` segments, and handles Windows drive letters and UNC paths.
 */

/** Normalize a path to forward slashes, collapse separators, resolve . and .. */
export function normalizePath(p: string): string {
  if (!p) return ".";

  const isUNC = p.startsWith("\\\\") || p.startsWith("//");
  const isAbsolute = isUNC || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("/");

  // Normalize separators to forward slash
  let normalized = p.replace(/\\/g, "/");

  // Extract drive letter if present (e.g., "C:")
  let prefix = "";
  if (/^[a-zA-Z]:/.test(normalized)) {
    prefix = normalized[0]!.toUpperCase() + ":";
    normalized = normalized.slice(2);
  } else if (isUNC) {
    // UNC: preserve the leading // and the server/share segments
    normalized = normalized.replace(/^\/+/, "/");
    const withoutLeading = normalized.slice(1);
    const firstSlash = withoutLeading.indexOf("/");
    if (firstSlash === -1) {
      return "//" + withoutLeading;
    }
    const secondSlash = withoutLeading.indexOf("/", firstSlash + 1);
    if (secondSlash === -1) {
      prefix = "//" + withoutLeading;
      normalized = "";
    } else {
      prefix = "//" + withoutLeading.slice(0, secondSlash);
      normalized = withoutLeading.slice(secondSlash);
    }
  }

  // Split, resolve . and ..
  const segments = normalized.split("/").filter((s) => s !== "" && s !== ".");
  const resolved: string[] = [];

  for (const seg of segments) {
    if (seg === "..") {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== "..") {
        resolved.pop();
      } else if (!isAbsolute) {
        resolved.push("..");
      }
    } else {
      resolved.push(seg);
    }
  }

  let result = resolved.join("/");

  if (prefix) {
    result = prefix + (result ? "/" + result : isUNC ? "" : "/");
  } else if (isAbsolute) {
    result = "/" + result;
  }

  return result || ".";
}

/** Check if a path is absolute (Unix /, Windows C:\, or UNC \\server) */
export function isAbsolute(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\\\");
}

/** Get the directory portion of a path */
export function dirname(p: string): string {
  const normalized = normalizePath(p);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) return ".";
  if (lastSlash === 0) return "/";
  return normalized.slice(0, lastSlash);
}

/** Get the file name (last segment) of a path */
export function basename(p: string, ext?: string): string {
  const normalized = normalizePath(p);
  const lastSlash = normalized.lastIndexOf("/");
  const name = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  if (ext && name.endsWith(ext)) {
    return name.slice(0, -ext.length);
  }
  return name;
}

/** Get the file extension including the dot */
export function extname(p: string): string {
  const name = basename(p);
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) return "";
  return name.slice(dotIndex);
}

/** Join path segments, normalizing the result */
export function join(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}
