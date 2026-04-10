import { test, expect, describe, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publish, type PublishConfig } from "../src/publish.ts";

let tempDir: string;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("publish", () => {
  test("rejects missing registryUrl", async () => {
    await expect(
      publish("/tmp/fake.buster-ext", { registryUrl: "", token: "abc" }),
    ).rejects.toThrow("registryUrl is required");
  });

  test("rejects missing token", async () => {
    await expect(
      publish("/tmp/fake.buster-ext", { registryUrl: "https://example.com", token: "" }),
    ).rejects.toThrow("token is required");
  });

  test("rejects non-existent package file", async () => {
    await expect(
      publish("/tmp/nonexistent.buster-ext", {
        registryUrl: "https://example.com",
        token: "abc",
      }),
    ).rejects.toThrow("Package not found");
  });

  test("rejects wrong file extension", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "buster-pub-test-"));
    const badPath = join(tempDir, "package.tar.gz");
    await writeFile(badPath, "fake content");

    await expect(
      publish(badPath, { registryUrl: "https://example.com", token: "abc" }),
    ).rejects.toThrow(".buster-ext extension");
  });

  test("rejects when registry returns an error", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "buster-pub-test-"));
    const pkgPath = join(tempDir, "test-ext-0.1.0.buster-ext");
    await writeFile(pkgPath, "fake package content");

    // Start a mock server that returns 403
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    try {
      const config: PublishConfig = {
        registryUrl: `http://localhost:${server.port}`,
        token: "bad-token",
      };

      await expect(publish(pkgPath, config)).rejects.toThrow("Publish failed (403)");
    } finally {
      server.stop();
    }
  });

  test("succeeds when registry returns valid response", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "buster-pub-test-"));
    const pkgPath = join(tempDir, "test-ext-0.1.0.buster-ext");
    await writeFile(pkgPath, "fake package content");

    // Start a mock server that returns success
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ id: "test-ext", version: "0.1.0" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    try {
      const config: PublishConfig = {
        registryUrl: `http://localhost:${server.port}`,
        token: "good-token",
      };

      const result = await publish(pkgPath, config);
      expect(result.id).toBe("test-ext");
      expect(result.version).toBe("0.1.0");
    } finally {
      server.stop();
    }
  });
});
