/// Centralized error/info/success reporting.
///
/// Every user-visible notification flows through here so we get
/// consistent toast display + console logging in one place.
/// Also maintains an in-memory log buffer for the Buster Console panel.

import { createSignal } from "solid-js";
import { showToast } from "../ui/CanvasToasts";

// ── Log buffer ──────────────────────────────────────────────

export type LogLevel = "error" | "warn" | "info" | "success";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  title: string;
  detail?: string;
}

const MAX_LOG_ENTRIES = 500;

const [logEntries, setLogEntries] = createSignal<LogEntry[]>([]);
/** Reactive signal — read this to render the Buster Console. */
export { logEntries };

/** Revision counter — bumps on every log so canvas panels can react. */
const [logRevision, setLogRevision] = createSignal(0);
export { logRevision };

function pushEntry(level: LogLevel, title: string, detail?: unknown) {
  const entry: LogEntry = {
    timestamp: Date.now(),
    level,
    title,
    detail: detail !== undefined ? String(detail) : undefined,
  };
  setLogEntries((prev) => {
    const next = [...prev, entry];
    if (next.length > MAX_LOG_ENTRIES) next.splice(0, next.length - MAX_LOG_ENTRIES);
    return next;
  });
  setLogRevision((r) => r + 1);
}

/** Clear all log entries. */
export function clearLog() {
  setLogEntries([]);
  setLogRevision((r) => r + 1);
}

// ── Public API ──────────────────────────────────────────────

/** Show an error toast and log to console + buffer. */
export function showError(title: string, detail?: unknown) {
  showToast(title, "error");
  pushEntry("error", title, detail);
  if (detail !== undefined) {
    console.error(`[buster] ${title}`, detail);
  } else {
    console.error(`[buster] ${title}`);
  }
}

/** Show an info toast and log to console + buffer. */
export function showInfo(title: string, detail?: unknown) {
  showToast(title, "info");
  pushEntry("info", title, detail);
  if (detail !== undefined) {
    console.info(`[buster] ${title}`, detail);
  } else {
    console.info(`[buster] ${title}`);
  }
}

/** Show a success toast and log to console + buffer. */
export function showSuccess(title: string, detail?: unknown) {
  showToast(title, "success");
  pushEntry("success", title, detail);
  if (detail !== undefined) {
    console.info(`[buster] ${title}`, detail);
  } else {
    console.info(`[buster] ${title}`);
  }
}

/** Log a warning to console + buffer only (no toast). */
export function logWarn(title: string, detail?: unknown) {
  pushEntry("warn", title, detail);
  if (detail !== undefined) {
    console.warn(`[buster] ${title}`, detail);
  } else {
    console.warn(`[buster] ${title}`);
  }
}
