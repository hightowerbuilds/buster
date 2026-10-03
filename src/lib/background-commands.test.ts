import { describe, expect, it, vi } from "vitest";
import { isAssistantTool } from "./assistant-tools";
import { registerBackgroundCommands, WGSL_CONTRACT } from "./background-commands";
import { createBackgrounds, type BackgroundIpc, type BackgroundLibrary } from "./backgrounds";
import { FeatureCommands } from "./feature-commands";

const SHADER = "@fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f { return u.paper; }";

async function fixture() {
  let library: BackgroundLibrary = { version: 1, selected: null, strength: 0.35, animate: true, items: [] };
  let next = 0;
  const ipc: BackgroundIpc = {
    load: async () => structuredClone(library),
    compile: vi.fn(async (wgsl: string) => { if (!wgsl.includes("fs_main")) throw new Error("error: Define the entry point `fs_main`\n  wgsl:1:1"); return "glsl"; }),
    save: async request => {
      const item = { id: request.id ?? `bg-${++next}`, name: request.name, prompt: request.prompt, createdAt: 1, updatedAt: 2, wgsl: request.wgsl };
      library = { ...library, items: [...library.items.filter(i => i.id !== item.id), item] };
      return item;
    },
    remove: async () => {},
    configure: async request => { if ("selected" in request) library = { ...library, selected: request.selected ?? null }; return structuredClone(library); },
  };
  const backgrounds = createBackgrounds(ipc);
  await backgrounds.load();
  const commands = new FeatureCommands();
  registerBackgroundCommands(commands, backgrounds);
  const run = (command: string, args: Record<string, unknown> = {}) => commands.dispatch({ command, args, requestId: crypto.randomUUID() }, "ai");
  return { commands, backgrounds, ipc, run, library: () => library };
}

describe("background commands", () => {
  it("creates and applies a background, or only saves it", async () => {
    const f = await fixture();
    const created = await f.run("background create", { name: " Aurora ", prompt: "slow violet aurora", wgsl: SHADER });
    expect(created).toMatchObject({ ok: true, data: { id: "bg-1", name: "Aurora", applied: true } });
    expect(f.library().selected).toBe("bg-1");
    const saved = await f.run("background create", { name: "Rain", prompt: "rain", wgsl: SHADER, apply: false });
    expect(saved).toMatchObject({ ok: true, data: { applied: false } });
    expect(f.library().selected).toBe("bg-1");
    const listed = await f.run("backgrounds list");
    expect(listed).toMatchObject({ ok: true, data: { selected: "bg-1", backgrounds: [{ id: "bg-1", name: "Aurora", prompt: "slow violet aurora" }, { id: "bg-2", name: "Rain" }] } });
  });

  it("dry-runs the shader so compile errors return to Claude before approval", async () => {
    const f = await fixture();
    const check = await f.commands.check("background create", { name: "Broken", prompt: "", wgsl: "fn nope() {}" });
    expect(check).toMatchObject({ ok: false, error: { code: "SHADER_ERROR" } });
    expect(!check.ok && check.error.message).toContain("wgsl:1:1");
    expect(await f.commands.check("background create", { name: "", prompt: "", wgsl: SHADER })).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(await f.commands.check("background create", { name: "Fine", prompt: "", wgsl: SHADER })).toEqual({ ok: true });
    expect(f.library().items).toEqual([]);
  });

  it("reads, updates, applies and clears saved backgrounds", async () => {
    const f = await fixture();
    await f.run("background create", { name: "Aurora", prompt: "p", wgsl: SHADER, apply: false });
    expect(await f.run("background read", { id: "bg-1" })).toMatchObject({ ok: true, data: { name: "Aurora", wgsl: SHADER } });
    const revised = SHADER.replace("u.paper", "u.accent");
    expect(await f.run("background update", { id: "bg-1", wgsl: revised, name: "Aurora II" })).toMatchObject({ ok: true, data: { name: "Aurora II" } });
    expect(f.backgrounds.byId("bg-1")).toMatchObject({ wgsl: revised, prompt: "p" });
    expect(await f.run("background update", { id: "missing", wgsl: SHADER })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await f.run("background apply", { id: "bg-1" })).toMatchObject({ ok: true });
    expect(f.library().selected).toBe("bg-1");
    expect(await f.run("background clear")).toMatchObject({ ok: true, data: { selected: null } });
    expect(f.library().selected).toBeNull();
  });

  it("asks for approval on every change and exposes the tools to Claude", async () => {
    const f = await fixture();
    const described = f.commands.describe();
    for (const name of ["background create", "background update", "background apply", "background clear"]) {
      expect(described.find(c => c.name === name)?.confirm, name).toBe(true);
    }
    expect(described.find(c => c.name === "backgrounds list")?.confirm).toBe(false);
    for (const name of described.map(c => c.name)) expect(isAssistantTool(name), name).toBe(true);
    expect(described.find(c => c.name === "background create")?.description).toContain(WGSL_CONTRACT);
  });
});
