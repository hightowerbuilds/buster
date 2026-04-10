import { test, expect, describe, afterEach, beforeEach } from "bun:test";
import { TauriRunner } from "../src/tauri-runner.ts";
import { createWorkspace, type Workspace } from "../src/fixtures.ts";
import { join } from "node:path";
import { writeFile, chmod, mkdir } from "node:fs/promises";

let ws: Workspace;

afterEach(async () => {
  if (ws) await ws.cleanup();
});

describe("TauriRunner", () => {
  test("constructor sets options correctly", () => {
    const runner = new TauriRunner({
      appPath: "/usr/local/bin/buster",
      workspaceDir: "/tmp/workspace",
      timeout: 5000,
    });

    // isRunning should be false before start
    expect(runner.isRunning()).toBe(false);
  });

  test("constructor uses default timeout when not specified", () => {
    const runner = new TauriRunner({
      appPath: "/usr/local/bin/buster",
      workspaceDir: "/tmp/workspace",
    });

    expect(runner.isRunning()).toBe(false);
  });

  test("start throws if binary does not exist", async () => {
    const runner = new TauriRunner({
      appPath: "/nonexistent/binary/path",
      workspaceDir: "/tmp",
    });

    await expect(runner.start()).rejects.toThrow("Tauri app binary not found");
  });

  test("start throws if already started", async () => {
    ws = await createWorkspace();

    // Create a simple script that stays running
    const scriptPath = join(ws.root, "app.sh");
    await writeFile(scriptPath, "#!/bin/bash\necho BUSTER_READY\nsleep 60\n");
    await chmod(scriptPath, 0o755);

    const runner = new TauriRunner({
      appPath: scriptPath,
      workspaceDir: ws.root,
    });

    await runner.start();

    try {
      await expect(runner.start()).rejects.toThrow("already started");
    } finally {
      await runner.stop();
    }
  });

  test("start and stop lifecycle with a real process", async () => {
    ws = await createWorkspace();

    // Create a script that prints BUSTER_READY and waits
    const scriptPath = join(ws.root, "app.sh");
    await writeFile(
      scriptPath,
      '#!/bin/bash\necho "BUSTER_READY"\nwhile true; do sleep 1; done\n',
    );
    await chmod(scriptPath, 0o755);

    const runner = new TauriRunner({
      appPath: scriptPath,
      workspaceDir: ws.root,
    });

    await runner.start();
    expect(runner.isRunning()).toBe(true);

    await runner.stop();
    expect(runner.isRunning()).toBe(false);
  });

  test("stop is idempotent when not started", async () => {
    const runner = new TauriRunner({
      appPath: "/usr/local/bin/buster",
      workspaceDir: "/tmp",
    });

    // Should not throw
    await runner.stop();
  });

  test("waitForReady succeeds when app emits ready signal", async () => {
    ws = await createWorkspace();

    const scriptPath = join(ws.root, "app.sh");
    await writeFile(
      scriptPath,
      '#!/bin/bash\necho "BUSTER_READY"\nsleep 60\n',
    );
    await chmod(scriptPath, 0o755);

    const runner = new TauriRunner({
      appPath: scriptPath,
      workspaceDir: ws.root,
    });

    await runner.start();

    try {
      await runner.waitForReady(5000);
      // Should reach here without throwing
      expect(runner.getStdout()).toContain("BUSTER_READY");
    } finally {
      await runner.stop();
    }
  });

  test("waitForReady throws on timeout", async () => {
    ws = await createWorkspace();

    // Script that never emits ready
    const scriptPath = join(ws.root, "app.sh");
    await writeFile(
      scriptPath,
      "#!/bin/bash\necho 'starting...'\nsleep 60\n",
    );
    await chmod(scriptPath, 0o755);

    const runner = new TauriRunner({
      appPath: scriptPath,
      workspaceDir: ws.root,
    });

    await runner.start();

    try {
      await expect(runner.waitForReady(500)).rejects.toThrow(
        "did not become ready",
      );
    } finally {
      await runner.stop();
    }
  });

  test("waitForReady throws when not started", async () => {
    const runner = new TauriRunner({
      appPath: "/usr/local/bin/buster",
      workspaceDir: "/tmp",
    });

    await expect(runner.waitForReady()).rejects.toThrow("not started");
  });

  test("waitForReady throws when process exits early", async () => {
    ws = await createWorkspace();

    // Script that exits immediately without ready signal
    const scriptPath = join(ws.root, "app.sh");
    await writeFile(
      scriptPath,
      "#!/bin/bash\necho 'crash' >&2\nexit 1\n",
    );
    await chmod(scriptPath, 0o755);

    const runner = new TauriRunner({
      appPath: scriptPath,
      workspaceDir: ws.root,
    });

    await runner.start();

    try {
      await expect(runner.waitForReady(3000)).rejects.toThrow("exited before becoming ready");
    } finally {
      await runner.stop();
    }
  });

  test("getStdout and getStderr capture output", async () => {
    ws = await createWorkspace();

    const scriptPath = join(ws.root, "app.sh");
    await writeFile(
      scriptPath,
      '#!/bin/bash\necho "stdout line"\necho "stderr line" >&2\nsleep 0.2\nexit 0\n',
    );
    await chmod(scriptPath, 0o755);

    const runner = new TauriRunner({
      appPath: scriptPath,
      workspaceDir: ws.root,
    });

    await runner.start();
    // Give the process time to produce output and exit
    await Bun.sleep(500);

    const stdout = runner.getStdout();
    const stderr = runner.getStderr();

    expect(stdout).toContain("stdout line");
    expect(stderr).toContain("stderr line");

    await runner.stop();
  });

  test("sendCommand sends JSON on stdin and reads response", async () => {
    ws = await createWorkspace();

    // Create a script that reads commands from stdin and responds
    const scriptPath = join(ws.root, "app.sh");
    await writeFile(
      scriptPath,
      `#!/bin/bash
echo "BUSTER_READY"
while IFS= read -r line; do
  echo "BUSTER_RESPONSE:{\\"success\\":true,\\"data\\":{\\"received\\":true}}"
done
`,
    );
    await chmod(scriptPath, 0o755);

    const runner = new TauriRunner({
      appPath: scriptPath,
      workspaceDir: ws.root,
      timeout: 5000,
    });

    await runner.start();
    await runner.waitForReady(3000);

    const result = await runner.sendCommand("test_command", { key: "value" });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ received: true });

    await runner.stop();
  });
});
