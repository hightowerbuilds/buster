export type TabType =
  | "file"
  | "image"
  | "terminal"
  | "ai"
  | "settings"
  | "git"
  | "extensions"
  | "manual"
  | "github"
  | "explorer"
  | "problems"
  | "search-results";

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif", "tiff", "tif",
]);

export function isImageFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

export interface Tab {
  id: string;
  name: string;
  path: string;
  dirty: boolean;
  type: TabType;
}
