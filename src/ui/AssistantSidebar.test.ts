// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import AssistantSidebar from "./AssistantSidebar";
import { createAssistantWorkspace, type AssistantWorkspace } from "../lib/assistant-workspace";
import { FeatureCommands } from "../lib/feature-commands";
const context = vi.hoisted(() => ({ current: null as any }));
vi.mock("../lib/buster-context", () => ({ useBuster: () => context.current }));
let dispose: (() => void) | undefined, assistant: AssistantWorkspace | undefined;
afterEach(async () => { dispose?.(); await assistant?.dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); });
it("creates and switches saved chats, keeps drafts, searches history and confirms deletion", async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  assistant = createAssistantWorkspace({ commands: new FeatureCommands(), history: { load: async () => null, save: async () => {} },
    transport: () => ({ status: async () => ({ installed: true, loggedIn: true, authMethod: "claude.ai", version: "1", subscription: "max", detail: null }),
      send: async () => {}, reset: async () => {}, interrupt: async () => {}, toolResult: async () => {}, subscribe: async () => () => {} }) });
  await assistant.ready;
  context.current = { assistant, store: { tabs: [] }, backgrounds: { byId: () => undefined } };
  const root = document.createElement("div"); document.body.append(root);
  dispose = render(() => createComponent(AssistantSidebar, { onClose: vi.fn() }), root);
  const first = assistant.state.activeId;
  assistant.renameChat(first, "Garden plans");
  const input = root.querySelector<HTMLTextAreaElement>("textarea")!;
  input.value = "Draft for the garden"; input.dispatchEvent(new Event("input", { bubbles: true }));
  root.querySelector<HTMLButtonElement>('[aria-label="New chat"]')!.click();
  await vi.waitFor(() => expect(assistant!.state.activeId).not.toBe(first));
  expect(input.value).toBe("");
  root.querySelector<HTMLButtonElement>('[aria-label="Chat history"]')!.click();
  const pick = [...root.querySelectorAll<HTMLButtonElement>(".as-chat-pick")].find(el => el.textContent?.includes("Garden plans"))!;
  pick.click();
  await vi.waitFor(() => expect(input.value).toBe("Draft for the garden"));
  root.querySelector<HTMLButtonElement>('[aria-label="Chat history"]')!.click();
  const search = root.querySelector<HTMLInputElement>('[aria-label="Search chats"]')!;
  search.value = "Garden"; search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(root.querySelectorAll(".as-chat-row")).toHaveLength(1);
  root.querySelector<HTMLButtonElement>('[aria-label="Rename chat Garden plans"]')!.click();
  const title = root.querySelector<HTMLInputElement>('[aria-label="Chat title"]')!;
  title.value = "Garden journal"; title.dispatchEvent(new Event("input", { bubbles: true }));
  root.querySelector(".as-chat-rename")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(assistant.state.chats.find(chat => chat.id === first)?.title).toBe("Garden journal");
  root.querySelector<HTMLButtonElement>('[aria-label="Delete chat Garden journal"]')!.click();
  expect(assistant.state.chats).toHaveLength(2);
  const confirm = [...root.querySelectorAll<HTMLButtonElement>(".as-chat-confirm button")].find(el => el.textContent === "Delete chat")!;
  confirm.click();
  await vi.waitFor(() => expect(assistant!.state.chats).toHaveLength(1));
});
