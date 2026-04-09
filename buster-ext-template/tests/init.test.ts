import { test, expect, describe, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/commands/init.ts";

let tempDir: string;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("buster-ext init", () => {
  test("scaffolds extension project", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "buster-ext-test-"));
    const origCwd = process.cwd();
    process.chdir(tempDir);

    try {
      await init(["my-extension"]);

      const extDir = join(tempDir, "my-extension");

      // Verify files exist
      await stat(join(extDir, "extension.toml"));
      await stat(join(extDir, "Cargo.toml"));
      await stat(join(extDir, "src/lib.rs"));
      await stat(join(extDir, ".gitignore"));

      // Verify manifest content
      const manifest = await readFile(join(extDir, "extension.toml"), "utf-8");
      expect(manifest).toContain('id = "my-extension"');
      expect(manifest).toContain('version = "0.1.0"');

      // Verify Cargo.toml
      const cargo = await readFile(join(extDir, "Cargo.toml"), "utf-8");
      expect(cargo).toContain('name = "my_extension"');
      expect(cargo).toContain('crate-type = ["cdylib"]');
      expect(cargo).toContain("buster-ext-sdk");

      // Verify lib.rs
      const lib = await readFile(join(extDir, "src/lib.rs"), "utf-8");
      expect(lib).toContain("#[no_mangle]");
      expect(lib).toContain("pub extern");
    } finally {
      process.chdir(origCwd);
    }
  });

  test("rejects invalid extension name", async () => {
    await expect(init(["../Bad-Name"])).rejects.toThrow("Invalid extension name");
  });

  test("requires a name argument", async () => {
    await expect(init([])).rejects.toThrow("Usage");
  });
});
