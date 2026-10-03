import { batch, createEffect, createRoot, untrack } from "solid-js";
import { createStore } from "solid-js/store";
import { createAssistant, type AssistantDeps, type AssistantService, type AssistantState } from "./assistant";
import { readChatArchive, chatPreview, type ChatHistoryStorage, type SavedChat, type ChatArchive } from "./chat-history";

interface WorkspaceDeps extends Omit<AssistantDeps, "transport" | "initial" | "id"> {
  transport(id: string): AssistantDeps["transport"];
  history: ChatHistoryStorage;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Conversation library. Each chat owns its transcript, model process, approvals and local context. */
export function createAssistantWorkspace(deps: WorkspaceDeps) {
  const seed = (model = "", effort: SavedChat["effort"] = "high"): SavedChat => ({
    id: crypto.randomUUID(), title: "New chat", titleEdited: false, createdAt: Date.now(), updatedAt: Date.now(),
    model, effort, draft: "", entries: [], usage: { input: 0, output: 0, cacheRead: 0 },
    sessionId: null, lastProvider: null, lastTurnMs: null, localHistory: [], inFlight: false,
  });
  const initial = seed();
  try {
    initial.model = deps.storage?.get("bustermark.assistant.model") ?? "";
    const effort = deps.storage?.get("bustermark.assistant.effort");
    if (effort && ["low", "medium", "high", "xhigh", "max"].includes(effort)) initial.effort = effort as SavedChat["effort"];
  } catch { /* Preferences are optional; the archive is authoritative. */ }
  const [records, setRecords] = createStore<SavedChat[]>([initial]);
  const [meta, setMeta] = createStore({ activeId: initial.id, ready: false, loadError: "", saveError: "", switching: false, dirty: false });
  const controllers = new Map<string, { core: AssistantService; disposeRoot(): void }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writes = Promise.resolve();
  let revision = 0;
  let disposed = false;

  function changed() {
    if (!meta.ready || disposed) return;
    revision++; setMeta("dirty", true);
    if (meta.switching) return;
    // A throttle, not a debounce: long streamed replies still get checkpointed.
    timer ??= setTimeout(() => { timer = undefined; if (!meta.switching) void flush().catch(() => {}); }, 300);
  }

  function coreFor(id: string): AssistantService {
    const existing = controllers.get(id); if (existing) return existing.core;
    const record = records.find(chat => chat.id === id)!;
    let disposeRoot!: () => void;
    const core = createRoot(dispose => {
      disposeRoot = dispose;
      const core = createAssistant({ commands: deps.commands, transport: deps.transport(id), storage: deps.storage, id,
        initial: JSON.parse(JSON.stringify(record)) });
      let previous = JSON.stringify(core.snapshot());
      createEffect(() => {
        const snapshot = core.snapshot();
        const next = JSON.stringify(snapshot);
        if (next === previous) return;
        previous = next;
        untrack(() => {
          const index = records.findIndex(chat => chat.id === id); if (index < 0) return;
          const first = snapshot.entries.find(entry => entry.kind === "user");
          setRecords(index, "updatedAt", Date.now());
          if (!records[index].titleEdited && first?.kind === "user") setRecords(index, "title", first.text.replace(/\s+/g, " ").slice(0, 70));
          changed();
        });
      });
      return core;
    });
    controllers.set(id, { core, disposeRoot });
    return core;
  }
  const active = () => coreFor(meta.activeId);
  const summaries = () => records.map(chat => ({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt,
    model: controllers.get(chat.id)?.core.state.model ?? chat.model,
    preview: chatPreview(controllers.get(chat.id)?.core.state.entries ?? chat.entries),
    running: controllers.get(chat.id)?.core.state.running ?? false,
  })).sort((a, b) => b.updatedAt - a.updatedAt);
  const matches = (id: string, query: string) => {
    const record = records.find(chat => chat.id === id);
    if (!record) return false;
    const text = query.trim().toLowerCase();
    return record.title.toLowerCase().includes(text) || (controllers.get(id)?.core.state.entries ?? record.entries)
      .some(entry => (entry.kind === "user" || entry.kind === "assistant") && entry.text.toLowerCase().includes(text));
  };
  // A stable object lets existing sidebar readers react to the selected controller.
  const state = new Proxy({} as AssistantState & typeof meta & { chats: ReturnType<typeof summaries> }, {
    get: (_target, key) => key === "chats" ? summaries() : key in meta ? meta[key as keyof typeof meta] : active().state[key as keyof AssistantState],
  });

  async function load() {
    if (meta.ready) return;
    setMeta("loadError", "");
    try {
      const archive = readChatArchive(await deps.history.load());
      if (disposed) return;
      if (archive?.chats.length) batch(() => { setRecords(archive.chats); setMeta("activeId", archive.activeId); });
      setMeta("ready", true);
      active();
    } catch (error) { setMeta("loadError", message(error)); }
  }
  const ready = load();

  function capture(): ChatArchive {
    return JSON.parse(JSON.stringify({ version: 1, activeId: meta.activeId,
      chats: records.map(chat => ({ ...chat, ...(controllers.get(chat.id)?.core.snapshot() ?? {}) })) }));
  }
  async function flush() {
    clearTimeout(timer); timer = undefined;
    if (!meta.ready) throw new Error(meta.loadError || "Chat history is still loading.");
    const archive = capture(), savedRevision = revision;
    const pending = writes.catch(() => {}).then(() => deps.history.save(archive));
    writes = pending;
    try {
      await pending;
      if (revision === savedRevision) setMeta({ dirty: false, saveError: "" });
    } catch (error) { setMeta("saveError", message(error)); throw error; }
  }

  async function switchChat(id: string) {
    if (!meta.ready || meta.switching || id === meta.activeId || !records.some(chat => chat.id === id)) return;
    setMeta("switching", true);
    try {
      const previous = active();
      await previous.suspend();
      await flush();
      const open = previous.state.open, width = previous.state.width;
      setMeta("activeId", id);
      active().setOpen(open); active().setWidth(width);
      changed();
      void active().refreshStatus();
    } catch (error) { setMeta("saveError", message(error)); }
    finally { setMeta("switching", false); changed(); }
  }
  async function newChat() {
    if (!meta.ready || meta.switching) return;
    const current = active();
    const chat = seed(current.state.model, current.state.effort);
    setRecords(records.length, chat);
    await switchChat(chat.id);
  }
  function renameChat(id: string, title: string) {
    const trimmed = title.trim();
    if (!meta.ready || !trimmed || trimmed.length > 120) return;
    const index = records.findIndex(chat => chat.id === id); if (index < 0) return;
    setRecords(index, { title: trimmed, titleEdited: true }); changed();
  }
  async function deleteChat(id: string) {
    if (!meta.ready || meta.switching || !records.some(chat => chat.id === id)) return;
    setMeta("switching", true);
    try {
      const controller = controllers.get(id);
      if (controller) await controller.core.suspend();
      clearTimeout(timer); timer = undefined;
      // Keep the current in-memory snapshot until deletion is durably saved.
      const before = capture();
      const remaining = before.chats.filter(chat => chat.id !== id);
      if (!remaining.length) remaining.push(seed());
      const activeId = meta.activeId === id ? remaining[0].id : meta.activeId;
      const archive: ChatArchive = { version: 1, activeId, chats: remaining };
      const pending = writes.catch(() => {}).then(() => deps.history.save(archive)); writes = pending;
      await pending;
      batch(() => { setRecords(remaining); setMeta({ activeId, saveError: "" }); });
      if (controller) { await controller.core.dispose(); controller.disposeRoot(); controllers.delete(id); }
      active(); changed();
    } catch (error) { setMeta("saveError", message(error)); }
    finally { setMeta("switching", false); changed(); }
  }
  async function prepareClose() {
    await ready;
    if (!meta.ready) return; // No edits are permitted after a failed load; retain the original archive.
    for (const { core } of controllers.values()) await core.suspend();
    await flush();
  }
  async function dispose() {
    disposed = true; clearTimeout(timer);
    for (const controller of controllers.values()) { await controller.core.dispose(); controller.disposeRoot(); }
    controllers.clear();
  }
  return {
    state, ready, load, flush, prepareClose, dispose, newChat, switchChat, renameChat, deleteChat, matches,
    reset: newChat,
    async send(text: string) { await ready; if (meta.ready && !meta.switching) { await active().send(text); changed(); } },
    stop: () => active().stop(), approve: (id: string, allowed: boolean) => active().approve(id, allowed),
    setDraft: (text: string) => { if (meta.ready) active().setDraft(text); },
    setModel: (model: string) => { if (meta.ready) active().setModel(model); },
    setEffort: (effort: SavedChat["effort"]) => { if (meta.ready) active().setEffort(effort); },
    setOpen: (open: boolean) => active().setOpen(open), setWidth: (width: number) => active().setWidth(width),
    refreshStatus: () => active().refreshStatus(), sessionId: () => active().sessionId(),
  };
}
export type AssistantWorkspace = ReturnType<typeof createAssistantWorkspace>;
