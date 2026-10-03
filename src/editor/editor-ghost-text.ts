/**
 * Ghost text — AI inline code completion via streaming.
 *
 * Supports local models (Ollama) and cloud providers (Anthropic, OpenAI).
 * Debounces requests, streams tokens as they arrive, renders as semi-transparent
 * PhantomText on the canvas. Tab accepts, Escape or any keystroke dismisses.
 */

import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PhantomText } from "./canvas-renderer";
import type { AppSettings } from "../lib/ipc";
import { inferLanguageId } from "./language-registry";

export interface GhostTextDeps {
  filePath: () => string | null;
  cursorLine: () => number;
  cursorCol: () => number;
  content: () => { lines: string[]; total_lines?: number; file_path?: string | null; edit_seq?: number } | null;
  settings: () => AppSettings;
}

interface CompletionToken {
  request_id: number;
  token: string;
  done: boolean;
}

interface CompletionError {
  request_id: number;
  message: string;
}

interface CompletionContext {
  prefix: string;
  suffix: string;
}

export function buildAiCompletionContext(lines: string[], line: number, col: number): CompletionContext {
  const prefixStart = Math.max(0, line - 50);
  const prefixLines = lines.slice(prefixStart, line);
  const currentLinePrefix = (lines[line] ?? "").slice(0, col);
  const prefix = [...prefixLines, currentLinePrefix].join("\n");

  const currentLineSuffix = (lines[line] ?? "").slice(col);
  const suffixEnd = Math.min(lines.length, line + 11);
  const suffixLines = lines.slice(line + 1, suffixEnd);
  const suffix = [currentLineSuffix, ...suffixLines].join("\n");

  return { prefix, suffix };
}

export function shouldRequestAiCompletion(
  settings: AppSettings,
  filePath: string | null,
  languageId: string | null,
  prefix: string,
): boolean {
  if (!settings.ai_completion_enabled) return false;
  if (!filePath) return false;
  if (languageId && settings.ai_disabled_languages?.includes(languageId)) return false;
  const minChars = Math.max(0, settings.ai_min_prefix_chars ?? 3);
  return prefix.trim().length >= minChars;
}

export function makeAiCompletionCacheKey(args: {
  provider: string;
  model: string;
  filePath: string;
  languageId: string;
  line: number;
  col: number;
  prefix: string;
  suffix: string;
}): string {
  return [
    args.provider,
    args.model,
    args.filePath,
    args.languageId,
    args.line,
    args.col,
    args.prefix,
    args.suffix,
  ].join("\u001f");
}

export function createGhostText(deps: GhostTextDeps) {
  const [ghostText, setGhostText] = createSignal("");
  const [ghostLine, setGhostLine] = createSignal<number | null>(null);
  const [ghostCol, setGhostCol] = createSignal<number | null>(null);
  const [loading, setLoading] = createSignal(false);

  let requestCounter = 0;
  let activeRequestId = 0;
  let debounceTimer: number | null = null;
  let accumulator = "";
  let anchorLine = 0;
  let anchorCol = 0;
  const cache = new Map<string, string>();

  // Set up Tauri event listeners
  listen<CompletionToken>("ai-completion-token", (event) => {
    const { request_id, token, done } = event.payload;
    // Ignore stale responses
    if (request_id !== activeRequestId) return;

    accumulator += token;

    setGhostText(accumulator);
    setGhostLine(anchorLine);
    setGhostCol(anchorCol);
    setLoading(false);

    if (done) {
      activeRequestId = 0;
      if (accumulator && deps.settings().ai_cache_enabled) {
        const key = currentCacheKey();
        if (key) writeCache(key, accumulator, deps.settings().ai_cache_size ?? 24);
      }
    }
  });

  listen<CompletionError>("ai-completion-error", (event) => {
    if (event.payload.request_id === activeRequestId) {
      dismiss();
      activeRequestId = 0;
    }
  });

  function dismiss() {
    setGhostText("");
    setGhostLine(null);
    setGhostCol(null);
    setLoading(false);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (activeRequestId > 0) {
      invoke("ai_completion_cancel").catch(() => {});
      activeRequestId = 0;
      accumulator = "";
    }
  }

  function scheduleRequest() {
    // Always dismiss current ghost text when user types
    dismiss();

    const settings = deps.settings();
    const content = deps.content();
    const filePath = deps.filePath();
    const languageId = inferLanguageId(filePath);
    const context = content ? buildAiCompletionContext(content.lines, deps.cursorLine(), deps.cursorCol()) : null;
    if (!context || !shouldRequestAiCompletion(settings, filePath, languageId, context.prefix)) return;

    // Debounce: longer for local models (slow), shorter for cloud (fast)
    const delay = settings.ai_provider === "ollama"
      ? settings.ai_debounce_local_ms ?? 1500
      : settings.ai_debounce_cloud_ms ?? 500;

    debounceTimer = setTimeout(() => {
      fireRequest();
    }, delay) as unknown as number;
  }

  function trigger() {
    dismiss();
    fireRequest();
  }

  async function fireRequest() {
    const content = deps.content();
    if (!content) return;

    const line = deps.cursorLine();
    const col = deps.cursorCol();
    const lines = content.lines;
    const fp = deps.filePath() ?? "";
    const languageId = inferLanguageId(fp) ?? "";
    const { prefix, suffix } = buildAiCompletionContext(lines, line, col);
    const settings = deps.settings();

    if (!shouldRequestAiCompletion(settings, fp, languageId, prefix)) return;

    const key = currentCacheKey({ line, col, prefix, suffix, filePath: fp, languageId });
    const cached = key ? cache.get(key) : null;
    if (cached) {
      accumulator = cached;
      anchorLine = line;
      anchorCol = col;
      setGhostText(cached);
      setGhostLine(line);
      setGhostCol(col);
      return;
    }

    const requestId = ++requestCounter;
    activeRequestId = requestId;
    accumulator = "";
    anchorLine = line;
    anchorCol = col;
    setGhostLine(line);
    setGhostCol(col);
    setLoading(true);

    try {
      await invoke("ai_completion_request", {
        request: {
          request_id: requestId,
          file_path: fp,
          language: languageId || fp.split(".").pop() || "",
          prefix,
          suffix,
          cursor_line: line,
          cursor_col: col,
        },
      });
    } catch {
      // Connection error — silently ignore
      activeRequestId = 0;
      setLoading(false);
    }
  }

  function currentCacheKey(snapshot?: {
    line: number;
    col: number;
    prefix: string;
    suffix: string;
    filePath: string;
    languageId: string;
  }): string | null {
    const settings = deps.settings();
    const filePath = snapshot?.filePath ?? deps.filePath();
    if (!filePath) return null;
    const languageId = snapshot?.languageId ?? inferLanguageId(filePath) ?? "";
    const line = snapshot?.line ?? anchorLine;
    const col = snapshot?.col ?? anchorCol;
    const content = deps.content();
    const context = snapshot ?? (content ? {
      line,
      col,
      filePath,
      languageId,
      ...buildAiCompletionContext(content.lines, line, col),
    } : null);
    if (!context) return null;
    const model = settings.ai_provider === "ollama" ? settings.ai_local_model : settings.ai_model;
    return makeAiCompletionCacheKey({
      provider: settings.ai_provider,
      model,
      filePath,
      languageId,
      line: context.line,
      col: context.col,
      prefix: context.prefix,
      suffix: context.suffix,
    });
  }

  function writeCache(key: string, value: string, maxSize: number) {
    cache.delete(key);
    cache.set(key, value);
    const limit = Math.max(0, maxSize);
    while (cache.size > limit) {
      const first = cache.keys().next().value;
      if (!first) break;
      cache.delete(first);
    }
  }

  function accept(): string | null {
    const text = ghostText();
    if (!text) return null;
    dismiss();
    return text;
  }

  function getPhantomTexts(): PhantomText[] {
    const text = ghostText();
    const line = ghostLine();
    const col = ghostCol();
    if ((!text && !loading()) || line === null || col === null) return [];
    if (!text && loading()) {
      return [{ line, col, text: ".", style: "ghost" as const }];
    }

    // Split multiline ghost text into per-line phantoms
    const parts = text.split("\n");
    return parts.map((part, i) => ({
      line: line + i,
      col: i === 0 ? col : 0,
      text: part,
      style: "ghost" as const,
    }));
  }

  return {
    ghostText,
    ghostLine,
    ghostCol,
    loading,
    dismiss,
    scheduleRequest,
    trigger,
    accept,
    getPhantomTexts,
  };
}
