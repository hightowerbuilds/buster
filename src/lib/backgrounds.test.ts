import { describe, expect, it, vi } from "vitest";
import { packUniforms, parseColor } from "./background-renderer";
import { createBackgrounds, type BackgroundIpc, type BackgroundLibrary } from "./backgrounds";

describe("background renderer helpers", () => {
  it("parses theme colours to 0–1 RGBA", () => {
    expect(parseColor("#ff8000")).toEqual([1, 128 / 255, 0, 1]);
    expect(parseColor(" #fff ")).toEqual([1, 1, 1, 1]);
    expect(parseColor("#00000080")).toEqual([0, 0, 0, 128 / 255]);
    expect(parseColor("rgb(255, 0, 51)")).toEqual([1, 0, 0.2, 1]);
    expect(parseColor("rgba(0 0 0 / 0.5)")).toEqual([0, 0, 0, 0.5]);
    expect(parseColor("not a colour", [0.1, 0.2, 0.3, 1])).toEqual([0.1, 0.2, 0.3, 1]);
  });

  it("packs uniforms in the std140 order the shader contract declares", () => {
    const packed = packUniforms({ width: 800, height: 600, time: 1.5, strength: 0.4, accent: [1, 0, 0, 1], paper: [0, 1, 0, 1], ink: [0, 0, 1, 1] });
    expect(packed.length).toBe(16);
    expect(Array.from(packed.slice(0, 4))).toEqual([800, 600, 1.5, Math.fround(0.4)]);
    expect(Array.from(packed.slice(4))).toEqual([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]);
  });
});

function fakeIpc(initial: Partial<BackgroundLibrary> = {}) {
  let library: BackgroundLibrary = { version: 1, selected: null, strength: 0.35, animate: true, items: [], ...initial };
  const ipc: BackgroundIpc = {
    load: vi.fn(async () => structuredClone(library)),
    compile: vi.fn(async (wgsl: string) => { if (wgsl.includes("bad")) throw new Error("error: wgsl:1:1 bad"); return `glsl:${wgsl}`; }),
    save: vi.fn(async request => {
      const item = { id: request.id ?? `bg-${library.items.length + 1}`, name: request.name, prompt: request.prompt, createdAt: 1, updatedAt: 1, wgsl: request.wgsl };
      library = { ...library, items: [...library.items.filter(i => i.id !== item.id), item] };
      return item;
    }),
    remove: vi.fn(async id => { library = { ...library, items: library.items.filter(i => i.id !== id), selected: library.selected === id ? null : library.selected }; }),
    configure: vi.fn(async request => {
      library = { ...library, ...("selected" in request ? { selected: request.selected ?? null } : {}),
        ...(request.strength !== undefined ? { strength: request.strength } : {}), ...(request.animate !== undefined ? { animate: request.animate } : {}) };
      return structuredClone(library);
    }),
  };
  return { ipc, library: () => library };
}

describe("background library", () => {
  it("renames without changing shader, prompt or selection, and reports refresh failures", async () => {
    const fake = fakeIpc();
    const backgrounds = createBackgrounds(fake.ipc);
    const item = await backgrounds.save({ name: "Aurora", prompt: "violet", wgsl: "fn a" });
    await backgrounds.select(item.id);
    await backgrounds.rename(item.id, "  Evening  ");
    expect(backgrounds.selected()).toMatchObject({ id: item.id, name: "Evening", wgsl: "fn a", prompt: "violet" });
    await expect(backgrounds.rename(item.id, "   ")).rejects.toThrow("name");
    await expect(backgrounds.rename("missing", "Name")).rejects.toThrow("no longer exists");
    vi.mocked(fake.ipc.load).mockRejectedValueOnce(new Error("read failed"));
    await expect(backgrounds.rename(item.id, "Retry")).rejects.toThrow("read failed");
  });
  it("loads, saves, selects, configures and removes backgrounds", async () => {
    const fake = fakeIpc();
    const backgrounds = createBackgrounds(fake.ipc);
    await backgrounds.load();
    expect(backgrounds.state).toMatchObject({ loaded: true, items: [], selected: null });
    const item = await backgrounds.save({ name: "Aurora", prompt: "slow aurora", wgsl: "fn a" });
    expect(backgrounds.state.items.map(i => i.name)).toEqual(["Aurora"]);
    await backgrounds.select(item.id);
    expect(backgrounds.selected()?.name).toBe("Aurora");
    await backgrounds.configure({ strength: 0.6, animate: false });
    expect(backgrounds.state).toMatchObject({ strength: 0.6, animate: false });
    await backgrounds.remove(item.id);
    expect(backgrounds.state.items).toEqual([]);
    expect(backgrounds.selected()).toBeUndefined();
  });

  it("caches translations by source and forgets failed ones", async () => {
    const fake = fakeIpc();
    const backgrounds = createBackgrounds(fake.ipc);
    expect(await backgrounds.compile("fn a")).toBe("glsl:fn a");
    await backgrounds.compile("fn a");
    expect(fake.ipc.compile).toHaveBeenCalledTimes(1);
    await expect(backgrounds.compile("bad")).rejects.toThrow("wgsl:1:1");
    await expect(backgrounds.compile("bad")).rejects.toThrow();
    expect(fake.ipc.compile).toHaveBeenCalledTimes(3);
  });

  it("reports a load failure without throwing", async () => {
    const fake = fakeIpc();
    fake.ipc.load = vi.fn(async () => { throw new Error("disk unavailable"); });
    const backgrounds = createBackgrounds(fake.ipc);
    await backgrounds.load();
    expect(backgrounds.state).toMatchObject({ loaded: true, error: "disk unavailable" });
  });
});
