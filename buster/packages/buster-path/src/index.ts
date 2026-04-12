export {
  normalizePath,
  isAbsolute,
  dirname,
  basename,
  extname,
  join,
} from "./normalize.ts";

export { pathToUri, uriToPath } from "./uri.ts";

export { pathsEqual, isDescendant, type Platform } from "./compare.ts";

export { relativeTo } from "./workspace.ts";

export { breadcrumbs, type BreadcrumbSegment } from "./breadcrumb.ts";

export { toGitPath, fromGitPath } from "./git.ts";
