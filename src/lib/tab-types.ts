
export type TabType =
  | "file"
  | "terminal"
  | "settings"
  | "keybindings"
  | "git"
  | "search-results"
  | "ai"
  | "search-portal"
  | "writing-review";

export interface Tab {
  id: string;
  name: string;
  path: string;
  dirty: boolean;
  type: TabType;
  /** Cursor used until a restored document's editor mounts. */
  restoredSelection?: { anchor: { line: number; col: number }; head: { line: number; col: number } } | null;
  restoredCursor?: { line: number; col: number };
}
