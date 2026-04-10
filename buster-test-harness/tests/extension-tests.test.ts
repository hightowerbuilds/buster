import { test, expect, describe, afterEach, beforeEach } from "bun:test";
import { ExtensionTestHarness } from "../src/extension-tests.ts";
import { createWorkspace, type Workspace } from "../src/fixtures.ts";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

let ws: Workspace;
let harness: ExtensionTestHarness;

beforeEach(async () => {
  ws = await createWorkspace();
  harness = new ExtensionTestHarness(join(ws.root, "extensions"));
  await mkdir(join(ws.root, "extensions"), { recursive: true });
});

afterEach(async () => {
  if (harness) await harness.cleanup();
  if (ws) await ws.cleanup();
});

/**
 * Create a minimal extension in the workspace for testing.
 */
async function createMockExtension(
  name: string,
  options: {
    version?: string;
    main?: string;
    code?: string;
  } = {},
): Promise<string> {
  const extDir = join(ws.root, "ext-source", name);
  await mkdir(extDir, { recursive: true });

  const manifest = {
    name,
    version: options.version ?? "1.0.0",
    main: options.main ?? "index.js",
  };

  await writeFile(join(extDir, "package.json"), JSON.stringify(manifest));

  const code =
    options.code ??
    `
    export function activate(ctx) {
      ctx.log("activated");
      ctx.registerCommand("greet", (name) => "Hello, " + name + "!");
    }
    export function deactivate() {}
    export function add(a, b) { return a + b; }
  `;

  await writeFile(join(extDir, manifest.main), code);

  return extDir;
}

describe("ExtensionTestHarness", () => {
  test("install reads manifest and copies files", async () => {
    const extPath = await createMockExtension("test-ext");
    const id = await harness.install(extPath);

    expect(id).toBe("test-ext");

    const installed = harness.getInstalledExtensions();
    expect(installed).toHaveLength(1);
    expect(installed[0]!.id).toBe("test-ext");
    expect(installed[0]!.state).toBe("installed");
    expect(installed[0]!.manifest.version).toBe("1.0.0");
  });

  test("install throws on missing manifest", async () => {
    const extDir = join(ws.root, "no-manifest");
    await mkdir(extDir, { recursive: true });
    await writeFile(join(extDir, "index.js"), "module.exports = {};");

    await expect(harness.install(extDir)).rejects.toThrow("Failed to read extension manifest");
  });

  test("install throws on incomplete manifest", async () => {
    const extDir = join(ws.root, "bad-manifest");
    await mkdir(extDir, { recursive: true });
    await writeFile(join(extDir, "package.json"), JSON.stringify({ name: "test" }));

    await expect(harness.install(extDir)).rejects.toThrow(
      'must include "name" and "version"',
    );
  });

  test("install throws on duplicate install", async () => {
    const extPath = await createMockExtension("dupe-ext");
    await harness.install(extPath);

    await expect(harness.install(extPath)).rejects.toThrow("already installed");
  });

  test("load activates the extension", async () => {
    const extPath = await createMockExtension("loadable-ext");
    await harness.install(extPath);
    await harness.load("loadable-ext");

    const ext = harness.getExtension("loadable-ext");
    expect(ext!.state).toBe("loaded");

    // Check that activate logged a message
    const logs = harness.getLogs();
    expect(logs.some((l) => l.includes("activated"))).toBe(true);
  });

  test("load throws on non-installed extension", async () => {
    await expect(harness.load("nonexistent")).rejects.toThrow("not installed");
  });

  test("load throws on already loaded extension", async () => {
    const extPath = await createMockExtension("double-load");
    await harness.install(extPath);
    await harness.load("double-load");

    await expect(harness.load("double-load")).rejects.toThrow("already loaded");
  });

  test("load throws on missing entry point", async () => {
    const extDir = join(ws.root, "ext-source", "missing-main");
    await mkdir(extDir, { recursive: true });
    await writeFile(
      join(extDir, "package.json"),
      JSON.stringify({ name: "missing-main", version: "1.0.0", main: "nonexistent.js" }),
    );

    await harness.install(extDir);
    await expect(harness.load("missing-main")).rejects.toThrow(
      "entry point not found",
    );
  });

  test("call invokes a registered command", async () => {
    const extPath = await createMockExtension("callable-ext");
    await harness.install(extPath);
    await harness.load("callable-ext");

    const result = await harness.call("callable-ext", "greet", "World");
    expect(result).toBe("Hello, World!");
  });

  test("call falls back to module exports", async () => {
    const extPath = await createMockExtension("export-ext");
    await harness.install(extPath);
    await harness.load("export-ext");

    const result = await harness.call("export-ext", "add", 2, 3);
    expect(result).toBe(5);
  });

  test("call throws on uninstalled extension", async () => {
    await expect(harness.call("ghost", "method")).rejects.toThrow(
      "not installed",
    );
  });

  test("call throws on not-loaded extension", async () => {
    const extPath = await createMockExtension("not-loaded");
    await harness.install(extPath);

    await expect(harness.call("not-loaded", "method")).rejects.toThrow(
      "not loaded",
    );
  });

  test("call throws on unknown method", async () => {
    const extPath = await createMockExtension("no-method", {
      code: `
        export function activate(ctx) {}
        export function deactivate() {}
      `,
    });
    await harness.install(extPath);
    await harness.load("no-method");

    await expect(harness.call("no-method", "nonexistent")).rejects.toThrow(
      'no command or export named "nonexistent"',
    );
  });

  test("unload deactivates the extension", async () => {
    const extPath = await createMockExtension("unloadable-ext");
    await harness.install(extPath);
    await harness.load("unloadable-ext");

    await harness.unload("unloadable-ext");

    const ext = harness.getExtension("unloadable-ext");
    expect(ext!.state).toBe("unloaded");

    // Commands should be cleared
    expect(harness.getRegisteredCommands()).toEqual([]);
  });

  test("unload throws on not-loaded extension", async () => {
    const extPath = await createMockExtension("not-loaded-unload");
    await harness.install(extPath);

    await expect(harness.unload("not-loaded-unload")).rejects.toThrow(
      "not loaded",
    );
  });

  test("uninstall removes extension files", async () => {
    const extPath = await createMockExtension("removable-ext");
    await harness.install(extPath);

    await harness.uninstall("removable-ext");

    const installed = harness.getInstalledExtensions();
    expect(installed).toHaveLength(0);
    expect(harness.getExtension("removable-ext")).toBeUndefined();
  });

  test("uninstall throws if extension is still loaded", async () => {
    const extPath = await createMockExtension("still-loaded");
    await harness.install(extPath);
    await harness.load("still-loaded");

    await expect(harness.uninstall("still-loaded")).rejects.toThrow(
      "must be unloaded before uninstalling",
    );

    // Cleanup
    await harness.unload("still-loaded");
  });

  test("full lifecycle: install -> load -> call -> unload -> uninstall", async () => {
    const extPath = await createMockExtension("lifecycle-ext");

    // Install
    const id = await harness.install(extPath);
    expect(harness.getInstalledExtensions()).toHaveLength(1);

    // Load
    await harness.load(id);
    expect(harness.getExtension(id)!.state).toBe("loaded");

    // Call
    const result = await harness.call(id, "greet", "Buster");
    expect(result).toBe("Hello, Buster!");

    // Unload
    await harness.unload(id);
    expect(harness.getExtension(id)!.state).toBe("unloaded");

    // Uninstall
    await harness.uninstall(id);
    expect(harness.getInstalledExtensions()).toHaveLength(0);
  });

  test("getRegisteredCommands returns all commands", async () => {
    const extPath = await createMockExtension("cmd-ext");
    await harness.install(extPath);
    await harness.load("cmd-ext");

    const commands = harness.getRegisteredCommands();
    expect(commands).toContain("cmd-ext.greet");
  });

  test("cleanup removes everything", async () => {
    const extPath = await createMockExtension("cleanup-ext");
    await harness.install(extPath);
    await harness.load("cleanup-ext");

    await harness.cleanup();

    expect(harness.getInstalledExtensions()).toHaveLength(0);
    expect(harness.getLogs()).toHaveLength(0);
    expect(harness.getRegisteredCommands()).toHaveLength(0);
  });
});
