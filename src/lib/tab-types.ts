import { extname } from "buster-path";

export type TabType =
  | "file"
  | "image"
  | "terminal"
  | "settings"
  | "keybindings"
  | "git"
  | "extensions"
  | "debug"
  | "explorer"
  | "problems"
  | "search-results"
  | "surface"
  | "browser"
  | "console"
  | "ai";

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif", "tiff", "tif",
]);

export function isImageFile(path: string): boolean {
  const ext = extname(path);
  if (!ext) return false;
  return IMAGE_EXTENSIONS.has(ext.slice(1).toLowerCase());
}

export interface Tab {
  id: string;
  name: string;
  path: string;
  dirty: boolean;
  type: TabType;
  /** True for panels created by split — hidden from the tab bar. */
  splitChild?: boolean;
}
