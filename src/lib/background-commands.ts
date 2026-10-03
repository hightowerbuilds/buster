import type { BackgroundService } from "./backgrounds";
import { CommandFailure, objectResult, type CommandSchema, type FeatureCommands } from "./feature-commands";

/** The shader contract, shown to Claude in the create and update tool descriptions. */
export const WGSL_CONTRACT = `Write a WGSL fragment shader. Define exactly this entry point:
@fragment fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f
The app provides (do not declare them yourself):
struct Uniforms { resolution: vec2f, time: f32, strength: f32, accent: vec4f, paper: vec4f, ink: vec4f }
@group(0) @binding(0) var<uniform> u: Uniforms;
pos.xy is in pixels from the top-left; divide by u.resolution for 0–1 coordinates. u.time is seconds.
u.paper, u.accent and u.ink are the theme's background, accent and text colours (0–1 RGBA); build the
palette from them so the background suits the theme. Return an opaque colour (alpha 1).
It sits behind text, so keep it calm and low-contrast: no bright flashes, no fine high-contrast detail
where text sits, and slow motion (multiply u.time by about 0.05–0.3). Keep it cheap: small loops (at
most about 8 iterations), no ray marching, no textures or other bindings. Helper functions are fine.`;

const str: CommandSchema = { type: "string" };
const id: CommandSchema = { type: "string", minLength: 1 };
const obj = (properties: Record<string, CommandSchema>, required = Object.keys(properties)): CommandSchema =>
  ({ type: "object", properties, required, additionalProperties: false });

export function registerBackgroundCommands(commands: FeatureCommands, backgrounds: BackgroundService) {
  const add = (name: string, description: string, inputSchema: CommandSchema, effect: "read" | "write",
    run: (args: any) => unknown, check?: (args: any) => Promise<void> | void, example?: string) =>
    commands.register({ name, description, version: 1, effect, inputSchema, outputSchema: objectResult,
      examples: [example ?? name], check, run });

  const existing = (backgroundId: string) => {
    const item = backgrounds.byId(backgroundId);
    if (!item) throw new CommandFailure("NOT_FOUND", "No saved background has that ID. Use backgrounds list.");
    return item;
  };
  const compiles = async (wgsl: string) => {
    try { await backgrounds.compile(wgsl); }
    catch (e) { throw new CommandFailure("SHADER_ERROR", `The shader does not compile. Fix it and try again.\n${e instanceof Error ? e.message : String(e)}`); }
  };
  const name = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 80) throw new CommandFailure("INVALID_ARGUMENTS", "Give the background a name of up to 80 characters.");
    return trimmed;
  };

  add("backgrounds list", "List the writer's saved note backgrounds (WGSL shaders), which one is shown behind notes, and the strength and animation settings.",
    obj({}), "read", async () => {
      if (!backgrounds.state.loaded) await backgrounds.load();
      const s = backgrounds.state;
      return { selected: s.selected, strength: s.strength, animate: s.animate,
        backgrounds: s.items.map(item => ({ id: item.id, name: item.name, prompt: item.prompt })) };
    });

  add("background read", "Read a saved background's name, prompt and WGSL source, for example to revise it.",
    obj({ id }), "read", args => {
      const item = existing(args.id);
      return { id: item.id, name: item.name, prompt: item.prompt, wgsl: item.wgsl };
    }, undefined, 'background read {"id":"bg-1790000000000"}');

  add("background create", `Create a note background from the writer's description and save it to their Appearances gallery. The writer sees a live preview before approving. By default it is also shown behind notes; pass "apply": false to only save it. Put the writer's request in "prompt".\n${WGSL_CONTRACT}`,
    obj({ name: str, prompt: str, wgsl: str, apply: { type: "boolean" } }, ["name", "prompt", "wgsl"]), "write", async args => {
      const item = await backgrounds.save({ name: name(args.name), prompt: String(args.prompt), wgsl: String(args.wgsl) });
      if (args.apply !== false) await backgrounds.select(item.id);
      return { id: item.id, name: item.name, applied: args.apply !== false };
    }, async args => { name(args.name); await compiles(String(args.wgsl)); });

  add("background update", `Replace a saved background's shader (and optionally its name or prompt). The writer sees a live preview before approving.\n${WGSL_CONTRACT}`,
    obj({ id, wgsl: str, name: str, prompt: str }, ["id", "wgsl"]), "write", async args => {
      const item = existing(args.id);
      const saved = await backgrounds.save({ id: item.id, name: args.name !== undefined ? name(args.name) : item.name,
        prompt: args.prompt ?? item.prompt, wgsl: String(args.wgsl) });
      return { id: saved.id, name: saved.name };
    }, async args => { existing(args.id); if (args.name !== undefined) name(args.name); await compiles(String(args.wgsl)); });

  add("background apply", "Show a saved background behind notes.", obj({ id }), "write", async args => {
    existing(args.id);
    await backgrounds.select(args.id);
    return { selected: args.id };
  }, args => { existing(args.id); });

  add("background clear", "Stop showing a background behind notes. Saved backgrounds are kept.", obj({}), "write", async () => {
    await backgrounds.select(null);
    return { selected: null };
  });
}
