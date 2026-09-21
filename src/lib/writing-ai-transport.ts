import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface WritingRequest {
  requestId: string;
  provider: "ollama" | "anthropic" | "openai";
  model: string;
  instruction: string;
  text: string;
}
interface WritingToken { requestId: string; token: string }
const abortError = () => new DOMException("Writing request cancelled", "AbortError");

/** Subscribe before sending; each request owns its cancellation and listener. */
export function generateWriting(
  request: WritingRequest,
  onToken: (text: string) => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    let unlisten: UnlistenFn | undefined;
    let settled = false;
    let sent = false;
    let received = "";
    const cancelNative = () => { void invoke("writing_ai_cancel", { requestId: request.requestId }).catch(() => {}); };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      unlisten?.();
      if (error !== undefined) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve();
    };
    const abort = () => {
      if (sent) cancelNative();
      finish(abortError());
    };
    const timeout = setTimeout(() => {
      if (sent) cancelNative();
      finish(new Error("Writing request timed out"));
    }, 125_000);
    signal.addEventListener("abort", abort, { once: true });
    void (async () => {
      try {
        const stop = await listen<WritingToken>("writing-ai-token", ({ payload }) => {
          if (settled || signal.aborted || payload.requestId !== request.requestId) return;
          try { received += payload.token; onToken(payload.token); }
          catch (error) { cancelNative(); finish(error); }
        });
        if (settled || signal.aborted) { stop(); if (!settled) abort(); return; }
        unlisten = stop;
        sent = true;
        const complete = await invoke<string>("writing_ai_generate", { request });
        if (settled || signal.aborted) return;
        // The command response is authoritative if the final event is still queued by the webview.
        if (typeof complete !== "string" || !complete.startsWith(received)) {
          throw new Error("Writing stream did not match its completed response");
        }
        const remaining = complete.slice(received.length);
        if (remaining) onToken(remaining);
        finish();
      } catch (error) { finish(error); }
    })();
  });
}
