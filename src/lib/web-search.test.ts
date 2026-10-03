import { expect, it, vi } from "vitest";
import { FeatureCommands } from "./feature-commands";
import { buildAssistantTools } from "./assistant-tools";
import { registerWebSearchCommands } from "./web-search";

it("exposes web search to both model transports and returns sources without approval", async () => {
  const commands = new FeatureCommands();
  const result = { query: "Markdown", provider: "test", results: [{ title: "Spec", url: "https://example.com/", snippet: "A specification" }] };
  const search = vi.fn().mockResolvedValue(result);
  registerWebSearchCommands(commands, search);
  expect(buildAssistantTools(commands).targets.get("web_search")).toEqual({ command: "web search", effect: "read", confirm: false });
  expect(await commands.dispatch({ requestId: "1", command: "web search", args: { query: " Markdown " } }, "ai")).toMatchObject({ ok: true, data: result });
  expect(search).toHaveBeenCalledWith("Markdown", 5);
});

it("rejects invalid queries and limits before contacting the provider", async () => {
  const commands = new FeatureCommands(), search = vi.fn();
  registerWebSearchCommands(commands, search);
  for (const args of [{ query: " " }, { query: "a\nb" }, { query: "a".repeat(501) }, { query: "a", count: 0 }, { query: "a", count: 11 }, { query: "a", count: 1.5 }]) {
    expect(await commands.dispatch({ requestId: crypto.randomUUID(), command: "web search", args }, "ai")).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
  }
  expect(search).not.toHaveBeenCalled();
});

it("reports provider failures instead of fabricated or empty sources", async () => {
  const commands = new FeatureCommands();
  registerWebSearchCommands(commands, async () => { throw new Error("Search is unavailable."); });
  expect(await commands.dispatch({ requestId: "1", command: "web search", args: { query: "a" } }, "ai")).toMatchObject({ ok: false, error: { code: "WEB_SEARCH_FAILED", message: "Search is unavailable." } });
});
