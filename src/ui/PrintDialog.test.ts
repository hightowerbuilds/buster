// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import PrintDialog from "./PrintDialog";
import { createPrinting, type Printer, type PrintRequest } from "../lib/printing";

vi.mock("../lib/notify", () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
let dispose: () => void;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function fixture(printers = [{ id: "office", name: "Office", isDefault: true }], discover?: () => Promise<Printer[]>) {
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  const submit = vi.fn(async (_request: PrintRequest) => ({ status: "saved" as const, title: "Draft.md", path: "/tmp/draft.pdf" }));
  const printing = createPrinting({ tabs: () => [{ id: "note", name: "Draft.md", path: "", type: "file", dirty: true }],
    text: () => "# Draft", printers: discover ?? (async () => printers), submit, choosePdfPath: async () => "/tmp/draft.pdf" });
  const root = document.createElement("div"); document.body.append(root);
  dispose = render(() => createComponent(PrintDialog, { printing }), root);
  return { printing, submit };
}
it("asks the basic print questions in a BusterMark modal and sends nothing on Escape", async () => {
  const f = fixture(); const result = f.printing.request("note", "ai");
  await vi.waitFor(() => expect(f.printing.state.loading).toBe(false));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.classList.contains("dirty-close-dialog")).toBe(true);
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.textContent).toContain("Requested by the Language Model");
  for (const label of ["Print destination", "Copies", "Pages", "Paper size", "Orientation", "Print sides"])
    expect(dialog.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(await result).toMatchObject({ status: "cancelled" }); expect(f.submit).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("focuses Cancel while printer discovery disables the form fields and restores the previous control", async () => {
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body);
  const previous = document.createElement("textarea"); document.body.append(previous); previous.focus();
  const f = fixture([], () => new Promise(() => {}));
  const result = f.printing.request("note");
  await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  document.activeElement!.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(true); expect(document.activeElement?.textContent).toBe("Cancel");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(await result).toMatchObject({ status: "cancelled" }); expect(document.activeElement).toBe(previous);
  expect(f.submit).not.toHaveBeenCalled();
});
it("keeps invalid page ranges in the styled dialog until corrected and explicitly confirmed", async () => {
  const f = fixture([]); const result = f.printing.request("note");
  await vi.waitFor(() => expect(f.printing.state.loading).toBe(false));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("No printers are installed");
  const pages = document.querySelector<HTMLSelectElement>('[aria-label="Pages"]')!;
  pages.value = "range"; pages.dispatchEvent(new Event("change", { bubbles: true }));
  const first = document.querySelector<HTMLInputElement>('[aria-label="First page"]')!;
  first.value = "3"; first.dispatchEvent(new Event("input", { bubbles: true }));
  const form = document.querySelector<HTMLFormElement>('[role="dialog"]')!;
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("page range"); expect(f.submit).not.toHaveBeenCalled();
  const last = document.querySelector<HTMLInputElement>('[aria-label="Last page"]')!;
  last.value = "4"; last.dispatchEvent(new Event("input", { bubbles: true }));
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(await result).toMatchObject({ status: "saved" }); expect(f.submit).toHaveBeenCalledOnce();
  expect(f.submit.mock.calls[0][0]).toMatchObject({ options: { firstPage: 3, lastPage: 4, destination: "pdf" } });
});
