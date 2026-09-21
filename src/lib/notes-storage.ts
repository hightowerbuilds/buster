/** Match path segments, not similarly named sibling folders. */
export function isNotesPath(path: string, root: string | null | undefined): boolean {
  if (!root) return false;
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/$/, "");
  const base = normalize(root);
  const target = normalize(path);
  return target.startsWith(`${base}/`) && !target.slice(base.length + 1).split("/").some(part => part === ".." || part === ".");
}

/** Preserve the relative suffix when a file or containing folder moves. */
export function movedFilePath(path: string, oldPath: string, newPath: string | null): string | null | undefined {
  if (path !== oldPath && !path.startsWith(`${oldPath}/`)) return undefined;
  return newPath === null ? null : newPath + path.slice(oldPath.length);
}
