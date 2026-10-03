import { invoke } from "@tauri-apps/api/core";
import { EFFORTS, type AssistantEntry, type AssistantSnapshot } from "./assistant";
import { restoreLocalHistory } from "./local-model-transport";

export interface SavedChat extends AssistantSnapshot {
  id: string;
  title: string;
  titleEdited: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface ChatArchive { version: 1; activeId: string; chats: SavedChat[] }
export interface ChatHistoryStorage { load(): Promise<unknown>; save(archive: ChatArchive): Promise<void> }
export const nativeChatHistory: ChatHistoryStorage = {
  load: () => invoke("chat_history_load"),
  save: history => invoke("chat_history_save", { history }),
};

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const id = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(value);
const invalid = (): never => { throw new Error("Saved chat history is invalid. The original file has been preserved."); };

/** Validate the entire archive before publishing it or enabling saves. Pending actions are never replayed. */
export function readChatArchive(value: unknown): ChatArchive | null {
  if (value === null) return null;
  if (!object(value) || value.version !== 1 || !Array.isArray(value.chats) || typeof value.activeId !== "string") return invalid();
  const archive: ChatArchive = JSON.parse(JSON.stringify(value));
  const seen = new Set<string>();
  for (const chat of archive.chats) {
    if (!object(chat) || !id(chat.id) || seen.has(chat.id) || typeof chat.title !== "string" || !chat.title.trim()
      || typeof chat.titleEdited !== "boolean" || !finite(chat.createdAt) || !finite(chat.updatedAt)
      || typeof chat.model !== "string" || !EFFORTS.includes(chat.effort) || typeof chat.draft !== "string"
      || typeof chat.inFlight !== "boolean"
      || !object(chat.usage) || ![chat.usage.input, chat.usage.output, chat.usage.cacheRead].every(finite)
      || (chat.lastTurnMs !== null && !finite(chat.lastTurnMs)) || (chat.sessionId !== null && !id(chat.sessionId))
      || ![null, "claude", "local"].includes(chat.lastProvider) || !Array.isArray(chat.entries)) return invalid();
    seen.add(chat.id);
    let interrupted = chat.inFlight;
    chat.inFlight = false;
    const entries = new Set<string>();
    for (const entry of chat.entries) {
      if (!object(entry) || !id(entry.id) || entries.has(entry.id)) return invalid();
      entries.add(entry.id);
      switch (entry.kind) {
        case "user": if (typeof entry.text !== "string") return invalid(); break;
        case "assistant":
          if (typeof entry.text !== "string" || typeof entry.thinking !== "string" || typeof entry.streaming !== "boolean") return invalid();
          interrupted ||= entry.streaming; entry.streaming = false; break;
        case "notice":
          if (typeof entry.text !== "string" || !["error", "info"].includes(entry.tone)) return invalid(); break;
        case "tool":
          if (typeof entry.toolUseId !== "string" || typeof entry.command !== "string" || !["read", "write"].includes(entry.effect)
            || typeof entry.result !== "string" || !["running", "awaiting", "done", "failed", "denied", "cancelled"].includes(entry.status)) return invalid();
          if (entry.status === "running" || entry.status === "awaiting") {
            interrupted = true; entry.status = "cancelled"; entry.result = "Interrupted when the app closed. This action will not be replayed.";
          }
          break;
        default: return invalid();
      }
    }
    chat.localHistory = restoreLocalHistory(chat.localHistory);
    if (interrupted) chat.entries.push({ id: crypto.randomUUID(), kind: "notice", tone: "info", text: "The previous response was interrupted. Send a message to continue; pending actions were cancelled." });
  }
  if (archive.chats.length && !seen.has(archive.activeId)) return invalid();
  return archive;
}

export function chatPreview(entries: AssistantEntry[]): string {
  const entry = [...entries].reverse().find(e => e.kind === "user" || (e.kind === "assistant" && e.text));
  return entry && "text" in entry ? entry.text.replace(/\s+/g, " ").slice(0, 120) : "No messages yet";
}
