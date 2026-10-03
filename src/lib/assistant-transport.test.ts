import { expect, it, vi } from "vitest";
import { createClaudeCodeTransport } from "./assistant-transport";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(async (_command: string, _args?: any) => {}), handlers: new Map<string, Array<(event: any) => void>>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (name: string, callback: (event: any) => void) => {
  const handlers = mocks.handlers.get(name) ?? []; handlers.push(callback); mocks.handlers.set(name, handlers);
  return () => { mocks.handlers.set(name, handlers.filter(handler => handler !== callback)); };
} }));
it("routes events only to their chat and ignores a previous connection after reset", async () => {
  const a = createClaudeCodeTransport("chat-a"), b = createClaudeCodeTransport("chat-b");
  const aEvent = vi.fn(), bEvent = vi.fn(), aTool = vi.fn(), bTool = vi.fn();
  const stopA = await a.subscribe(aEvent, aTool), stopB = await b.subscribe(bEvent, bTool);
  await a.send({ text: "Hello", system: "", tools: [] });
  const request = mocks.invoke.mock.calls.find(call => call[0] === "assistant_send")![1].request;
  const emit = (name: string, payload: unknown) => mocks.handlers.get(name)!.forEach(callback => callback({ payload }));
  emit("assistant-event", { conversationId: "chat-a", channelId: request.channelId, kind: "text", text: "A only" });
  emit("assistant-tool-call", { conversationId: "chat-a", channelId: request.channelId, callId: "tool-a" });
  expect(aEvent).toHaveBeenCalledOnce(); expect(aTool).toHaveBeenCalledOnce();
  expect(bEvent).not.toHaveBeenCalled(); expect(bTool).not.toHaveBeenCalled();
  await a.reset();
  emit("assistant-event", { conversationId: "chat-a", channelId: request.channelId, kind: "text", text: "late" });
  emit("assistant-tool-call", { conversationId: "chat-a", channelId: request.channelId, callId: "late" });
  expect(aEvent).toHaveBeenCalledOnce(); expect(aTool).toHaveBeenCalledOnce();
  stopA(); stopB();
});
