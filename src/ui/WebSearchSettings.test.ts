// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { invoke } from "@tauri-apps/api/core";
import { WebSearchSettings } from "./WebSearchSettings";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

it("saves keys only through native credential storage and reports failures", async () => {
  const ipc = vi.mocked(invoke);
  ipc.mockResolvedValueOnce(false).mockRejectedValueOnce("Unlock the desktop keyring").mockResolvedValueOnce(undefined);
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(() => createComponent(WebSearchSettings, {}), root);
  try {
    await vi.waitFor(() => expect(root.textContent).toContain("No search key saved"));
    const input = root.querySelector("input")!;
    expect(input.type).toBe("password");
    input.value = "test-key"; input.dispatchEvent(new Event("input", { bubbles: true }));
    const submit = () => root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    submit();
    await vi.waitFor(() => expect(root.textContent).toContain("Unlock the desktop keyring"));
    expect(input.value).toBe("test-key");
    submit();
    await vi.waitFor(() => expect(input.value).toBe(""));
    expect(ipc).toHaveBeenLastCalledWith("web_search_save_key", { apiKey: "test-key" });
    expect(root.textContent).toContain("Search key saved");
  } finally { dispose(); root.remove(); }
});
