/**
 * terminal-binary.ts — Binary IPC decoder for terminal screen deltas.
 *
 * Replaces JSON-serialized TermScreenDelta with a compact binary protocol.
 * Each cell is 12 bytes (u32 codepoint + 3 fg + 3 bg + 1 flags + 1 width)
 * instead of ~140 bytes of JSON. ~9× reduction in IPC payload size.
 *
 * Binary layout (little-endian):
 *   Header (16 + title_len bytes):
 *     u16 rows, u16 cols, u16 cursor_row, u16 cursor_col,
 *     u8  meta_flags, u8 mouse_mode, u8 mouse_encoding, u8 cursor_style,
 *     u16 num_changed_rows, u16 title_len, [title bytes]
 *   Per changed row: u16 row_index, then cols × 12 bytes
 *   Per cell: u32 codepoint, u8×3 fg, u8×3 bg, u8 attr_flags, u8 width
 */

// ── Shared types (moved from CanvasTerminal.tsx) ──────────────

export interface TermCell {
  ch: string;
  fg: [number, number, number];
  bg: [number, number, number];
  bold: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strikethrough: boolean;
  faint: boolean;
  /** 0 = wide-char continuation (skip), 1 = normal, 2 = double-width */
  width: number;
}

export interface ChangedRow {
  index: number;
  cells: TermCell[];
}

export interface TermScreenDelta {
  rows: number;
  cols: number;
  cursor_row: number;
  cursor_col: number;
  changed_rows: ChangedRow[];
  full: boolean;
  mouse_mode?: string;
  mouse_encoding?: string;
  bracketed_paste?: boolean;
  title?: string;
  bell?: boolean;
  alt_screen?: boolean;
  cursor_style?: TerminalCursorStyle;
}

export type TerminalCursorStyle = "block" | "underline" | "bar";

// ── Lookup tables ─────────────────────────────────────────────

const MOUSE_MODES = ["none", "press", "press_release", "button_motion", "any_motion"] as const;
const MOUSE_ENCODINGS = ["default", "utf8", "sgr"] as const;
const CURSOR_STYLES = ["block", "underline", "bar"] as const;

// ── Decoder ───────────────────────────────────────────────────

/** Decode a base64-encoded binary delta into a TermScreenDelta. */
export function decodeBinaryDelta(base64: string): TermScreenDelta {
  // Decode base64 → Uint8Array
  const raw = atob(base64);
  const len = raw.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = raw.charCodeAt(i);

  const view = new DataView(bytes.buffer);
  let off = 0;

  // Header
  const rows = view.getUint16(off, true); off += 2;
  const cols = view.getUint16(off, true); off += 2;
  const cursor_row = view.getUint16(off, true); off += 2;
  const cursor_col = view.getUint16(off, true); off += 2;

  const meta = bytes[off++];
  const full = !!(meta & 1);
  const bell = !!(meta & 2);
  const alt_screen = !!(meta & 4);
  const bracketed_paste = !!(meta & 8);

  const mouse_mode = MOUSE_MODES[bytes[off++]] ?? "none";
  const mouse_encoding = MOUSE_ENCODINGS[bytes[off++]] ?? "default";
  const cursor_style = CURSOR_STYLES[bytes[off++]] ?? "block";

  const numRows = view.getUint16(off, true); off += 2;
  const titleLen = view.getUint16(off, true); off += 2;

  let title: string | undefined;
  if (titleLen > 0) {
    title = new TextDecoder().decode(bytes.subarray(off, off + titleLen));
    off += titleLen;
  }

  // Changed rows
  const changed_rows: ChangedRow[] = new Array(numRows);

  for (let r = 0; r < numRows; r++) {
    const index = view.getUint16(off, true); off += 2;
    const cells: TermCell[] = new Array(cols);

    for (let c = 0; c < cols; c++) {
      const cp = view.getUint32(off, true); off += 4;
      const fg0 = bytes[off++];
      const fg1 = bytes[off++];
      const fg2 = bytes[off++];
      const bg0 = bytes[off++];
      const bg1 = bytes[off++];
      const bg2 = bytes[off++];
      const flags = bytes[off++];
      const width = bytes[off++];

      cells[c] = {
        ch: String.fromCodePoint(cp),
        fg: [fg0, fg1, fg2],
        bg: [bg0, bg1, bg2],
        bold: !!(flags & 1),
        italic: !!(flags & 2),
        underline: !!(flags & 4),
        inverse: !!(flags & 8),
        strikethrough: !!(flags & 16),
        faint: !!(flags & 32),
        width,
      };
    }

    changed_rows[r] = { index, cells };
  }

  return {
    rows, cols, cursor_row, cursor_col,
    changed_rows, full,
    mouse_mode, mouse_encoding, bracketed_paste,
    title, bell, alt_screen, cursor_style,
  };
}
