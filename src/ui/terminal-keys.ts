/**
 * Terminal keyboard input mapping.
 *
 * Pure functions that map KeyboardEvent properties to escape sequences.
 * No component state, no Tauri IPC — just key → bytes translation.
 */

/**
 * Map a special key to its terminal escape sequence.
 * Returns null if the key is not a special key (printable char, Cmd combo, etc.)
 */
export function mapSpecialKey(key: string, tabTrapping: boolean): string | null {
  switch (key) {
    case "Enter": return "\r";
    case "Backspace": return "\x7f";
    case "Tab": return tabTrapping ? "\t" : null;
    case "Escape": return "\x1b";
    case "ArrowUp": return "\x1b[A";
    case "ArrowDown": return "\x1b[B";
    case "ArrowRight": return "\x1b[C";
    case "ArrowLeft": return "\x1b[D";
    case "Home": return "\x1b[H";
    case "End": return "\x1b[F";
    case "Delete": return "\x1b[3~";
    case "PageUp": return "\x1b[5~";
    case "PageDown": return "\x1b[6~";
    default: return null;
  }
}

/**
 * Map a Ctrl+key combination to its control code.
 * Uses e.code (physical key) so Ctrl+Shift+C !== Ctrl+C.
 * Returns null if not a Ctrl+letter combination.
 */
export function mapCtrlKey(code: string, ctrlKey: boolean, altKey: boolean, metaKey: boolean): string | null {
  if (!ctrlKey || altKey || metaKey || !code.startsWith("Key")) return null;
  const letter = code.charCodeAt(3); // "KeyA" → 65
  const controlCode = letter - 64;   // A=1, B=2, ... Z=26
  if (controlCode > 0 && controlCode < 27) {
    return String.fromCharCode(controlCode);
  }
  return null;
}

/**
 * Map an Alt+key combination to its ESC-prefixed form.
 * Returns null if not an Alt+single-char combination.
 */
export function mapAltKey(key: string, altKey: boolean, ctrlKey: boolean, metaKey: boolean): string | null {
  if (!altKey || ctrlKey || metaKey || key.length !== 1) return null;
  return "\x1b" + key;
}

/**
 * Encode a mouse event in SGR format for terminal mouse tracking.
 * Coordinates are 0-based (converted to 1-based in the sequence).
 */
export function encodeSgrMouse(button: number, row: number, col: number, release: boolean): string {
  const suffix = release ? "m" : "M";
  return `\x1b[<${button};${col + 1};${row + 1}${suffix}`;
}

/**
 * Encode a mouse event in default (X10) format.
 * Returns null for release events (X10 doesn't encode releases).
 */
export function encodeDefaultMouse(button: number, row: number, col: number, release: boolean): string | null {
  if (release) return null;
  return `\x1b[M${String.fromCharCode(button + 32)}${String.fromCharCode(col + 33)}${String.fromCharCode(row + 33)}`;
}
