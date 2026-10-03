// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import BackgroundGallery from "./BackgroundGallery";
const mock = vi.hoisted(() => ({ rename: vi.fn() }));
vi.mock("../lib/background-thumbnails", () => ({ backgroundThumbnail: async () => "" }));
vi.mock("../lib/buster-context", () => ({ useBuster: () => ({ backgrounds: {
  state: { items: [{ id: "a", name: "Aurora", wgsl: "source", prompt: "violet" }], selected: "a", strength: 0.5, animate: true },
  rename: mock.rename, compile: vi.fn(),
} }) }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.clearAllMocks(); });
it("keeps a failed rename editable, supports retry and restores keyboard focus", async () => {
  const root = document.createElement("div"); document.body.append(root);
  dispose = render(() => createComponent(BackgroundGallery, {}), root);
  const button = root.querySelector<HTMLButtonElement>('[aria-label="Rename Aurora"]')!;
  button.click();
  await Promise.resolve();
  const input = root.querySelector<HTMLInputElement>('[aria-label="Background name"]')!;
  expect(document.activeElement).toBe(input);
  input.value = "Evening"; input.dispatchEvent(new Event("input", { bubbles: true }));
  mock.rename.mockRejectedValueOnce(new Error("Disk full"));
  root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toBe("Disk full"));
  expect(input.value).toBe("Evening");
  mock.rename.mockResolvedValueOnce({});
  root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(root.querySelector("form")).toBeNull());
  expect(mock.rename).toHaveBeenLastCalledWith("a", "Evening");
  expect(document.activeElement).toBe(button);
});
