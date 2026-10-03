// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createComponent } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import SettingsPanel from "./SettingsPanel";
import { CATPPUCCIN } from "../lib/theme";
import type { AppSettings } from "../lib/ipc";

vi.mock("../lib/buster-context", () => ({ useBuster: () => ({ store: { palette: CATPPUCCIN }, backgrounds: {
  state: { loaded: true, error: "", items: [], selected: null, strength: 0.35, animate: true },
  compile: vi.fn(), select: vi.fn(async () => {}), configure: vi.fn(async () => {}), remove: vi.fn(async () => {}),
} }) }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
function mount() {
  const [settings, setSettings] = createStore({ font_size: 14, ui_zoom: 100, theme_mode: "dark",
    terminal_scrollback_rows: 10000, language_settings: { rust: { tab_size: 8 } },
    syntax_colors: { keyword: "#abcdef" }, auto_save_delay_ms: 9000, keybindings: {},
  } as unknown as AppSettings);
  const root = document.createElement("div"); document.body.append(root);
  dispose = render(() => createComponent(SettingsPanel, { get settings() { return settings; }, onChange: next => setSettings(next) }), root);
  return { root, settings };
}
describe("writing settings", () => {
  it("groups useful settings and hides IDE controls and shortcuts", () => {
    const { root } = mount();
    expect([...root.querySelectorAll('[role="tab"]')].map(el => el.textContent?.trim())).toEqual(["Appearances", "Hotkeys"]);
    expect([...root.querySelectorAll("h2")].map(el => el.textContent)).toEqual(["Appearance", "Writing", "Backgrounds"]);
    let text = root.textContent!;
    for (const tab of root.querySelectorAll<HTMLButtonElement>('[role="tab"]')) { tab.click(); text += root.textContent; }
    for (const label of ["Writing Style", "Text Size", "Backgrounds", "New Note", "Save As"]) expect(text).toContain(label);
    for (const label of ["Shell Font", "Shell Program", "Shell History", "New Shell", "Shell Bell", "Minimap", "Line Numbers", "Tab Size", "Insert Spaces", "Format On Save", "Auto Save Delay", "Autocomplete", "Syntax Token Colors", "Language Overrides", "Cursor Glow", "Film Grain", "Vignette", "Blog Mode Theme", "go To Symbol", "next Problem"]) expect(text).not.toContain(label);
  });
  it("switches categories with arrow keys and shows only the selected content", () => {
    const { root } = mount();
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector('[role="tabpanel"]')?.textContent).toContain("Keyboard Shortcuts");
    expect(root.querySelector('[role="tabpanel"]')?.textContent).not.toContain("Writing Style");
    tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(tabs[0]);
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(tabs[1]);
    tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(tabs[0]);
    expect(root.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe(tabs[0].id);
  });
  it("changes writing preferences without deleting legacy configuration", () => {
    const { root, settings } = mount();
    [...root.querySelectorAll("button")].find(button => button.textContent === "Newspaper")!.click();
    expect(settings.blog_theme).toBe("newspaper");
    expect(settings.language_settings).toEqual({ rust: { tab_size: 8 } });
    expect(settings.syntax_colors).toEqual({ keyword: "#abcdef" });
    expect(settings.auto_save_delay_ms).toBe(9000);
  });
});
