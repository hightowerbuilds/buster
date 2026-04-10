import { test, expect, describe, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateFormatter } from "../src/templates/formatter.ts";
import { generateLinter } from "../src/templates/linter.ts";
import { generateLanguage } from "../src/templates/language.ts";

let tempDir: string;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("formatter template", () => {
  test("generates valid manifest with formatter capability", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "buster-tpl-test-"));
    const dir = join(tempDir, "my-formatter");
    await generateFormatter(dir, "my-formatter");

    // Verify files exist
    await stat(join(dir, "extension.toml"));
    await stat(join(dir, "Cargo.toml"));
    await stat(join(dir, "src/lib.rs"));
    await stat(join(dir, ".gitignore"));

    // Verify manifest content
    const manifest = await readFile(join(dir, "extension.toml"), "utf-8");
    expect(manifest).toContain('id = "my-formatter"');
    expect(manifest).toContain('version = "0.1.0"');
    expect(manifest).toContain('type = "formatter"');

    // Verify lib.rs has formatter entry points
    const lib = await readFile(join(dir, "src/lib.rs"), "utf-8");
    expect(lib).toContain("fn format_document()");
    expect(lib).toContain("fn format_range()");
    expect(lib).toContain("#[no_mangle]");
  });

  test("Cargo.toml uses correct crate name", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "buster-tpl-test-"));
    const dir = join(tempDir, "code-fmt");
    await generateFormatter(dir, "code-fmt");

    const cargo = await readFile(join(dir, "Cargo.toml"), "utf-8");
    expect(cargo).toContain('name = "code_fmt"');
    expect(cargo).toContain('crate-type = ["cdylib"]');
  });
});

describe("linter template", () => {
  test("generates valid manifest with diagnostics capability", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "buster-tpl-test-"));
    const dir = join(tempDir, "my-linter");
    await generateLinter(dir, "my-linter");

    const manifest = await readFile(join(dir, "extension.toml"), "utf-8");
    expect(manifest).toContain('id = "my-linter"');
    expect(manifest).toContain('type = "diagnostics"');

    const lib = await readFile(join(dir, "src/lib.rs"), "utf-8");
    expect(lib).toContain("fn lint_document()");
    expect(lib).toContain("#[no_mangle]");
    expect(lib).toContain("diagnostics");
  });
});

describe("language template", () => {
  test("generates valid manifest with language capability", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "buster-tpl-test-"));
    const dir = join(tempDir, "my-lang");
    await generateLanguage(dir, "my-lang");

    const manifest = await readFile(join(dir, "extension.toml"), "utf-8");
    expect(manifest).toContain('id = "my-lang"');
    expect(manifest).toContain('type = "language"');
    expect(manifest).toContain('language_id = "my-lang"');

    const lib = await readFile(join(dir, "src/lib.rs"), "utf-8");
    expect(lib).toContain("fn completion()");
    expect(lib).toContain("fn hover()");
    expect(lib).toContain("fn definition()");
    expect(lib).toContain("#[no_mangle]");
  });
});

describe("init --template integration", () => {
  test("init with --template formatter creates formatter scaffold", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "buster-tpl-test-"));
    const origCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const { init } = await import("../src/commands/init.ts");
      await init(["fmt-ext", "--template", "formatter"]);

      const manifest = await readFile(
        join(tempDir, "fmt-ext", "extension.toml"),
        "utf-8",
      );
      expect(manifest).toContain('type = "formatter"');
    } finally {
      process.chdir(origCwd);
    }
  });

  test("init with unknown template throws", async () => {
    const { init } = await import("../src/commands/init.ts");
    await expect(init(["bad-ext", "--template", "unknown"])).rejects.toThrow(
      "Unknown template",
    );
  });
});
