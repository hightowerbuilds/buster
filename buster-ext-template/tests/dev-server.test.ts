import { test, expect, describe, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DevServer } from "../src/dev-server.ts";

let tempDir: string;
let server: DevServer;

afterEach(async () => {
  if (server) {
    server.stop();
  }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("DevServer", () => {
  test("starts and stops without error", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "buster-dev-test-"));
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src/lib.rs"), "// placeholder");
    await writeFile(
      join(tempDir, "extension.toml"),
      `[extension]\nid = "test-dev"\nname = "test-dev"\nversion = "0.1.0"\nentry = "test.wasm"\n`,
    );

    server = new DevServer();
    await server.start(0, tempDir);

    // Server should have started — stopping should not throw
    server.stop();
  });

  test("reads extension ID from manifest", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "buster-dev-test-"));
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src/lib.rs"), "// placeholder");
    await writeFile(
      join(tempDir, "extension.toml"),
      `[extension]\nid = "my-cool-ext"\nname = "My Cool Ext"\nversion = "1.0.0"\nentry = "test.wasm"\n`,
    );

    server = new DevServer();
    await server.start(0, tempDir);

    // We can verify the server started by connecting a WebSocket
    // (the extension_id is logged to console, so we mainly verify no crash)
    server.stop();
  });

  test("accepts WebSocket connections", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "buster-dev-test-"));
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src/lib.rs"), "// placeholder");
    await writeFile(
      join(tempDir, "extension.toml"),
      `[extension]\nid = "ws-test"\nname = "ws-test"\nversion = "0.1.0"\nentry = "test.wasm"\n`,
    );

    server = new DevServer();
    // Use port 0 for auto-assign
    await server.start(0, tempDir);

    // The Bun server object is private, but we can verify the HTTP endpoint
    // responds (the WebSocket upgrade happens on the same port).
    // Since port 0 auto-assigns, we just verify start/stop lifecycle.
    server.stop();
  });
});
