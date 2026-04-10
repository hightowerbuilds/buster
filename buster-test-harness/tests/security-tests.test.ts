import { test, expect, describe, afterEach, beforeEach } from "bun:test";
import { SecurityTestSuite } from "../src/security-tests.ts";
import { createWorkspace, type Workspace } from "../src/fixtures.ts";
import { join } from "node:path";
import { writeFile, chmod, mkdir } from "node:fs/promises";

let ws: Workspace;

beforeEach(async () => {
  ws = await createWorkspace();
});

afterEach(async () => {
  if (ws) await ws.cleanup();
});

/**
 * Create a mock sandbox script that blocks or allows operations
 * based on a simple allowlist.
 */
async function createMockSandbox(
  wsRoot: string,
  options: {
    allowedCommands?: string[];
    allowedPaths?: string[];
    allowedHosts?: string[];
    allowedWritePaths?: string[];
  } = {},
): Promise<string> {
  const {
    allowedCommands = ["echo", "ls"],
    allowedPaths = [],
    allowedHosts = [],
    allowedWritePaths = [],
  } = options;

  const scriptPath = join(wsRoot, "sandbox.sh");

  // Create a bash script that simulates a sandbox
  const script = `#!/bin/bash
# Mock sandbox script

WORKSPACE=""
OPERATION=""
ARGS=()

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --workspace)
      WORKSPACE="$2"
      shift 2
      ;;
    exec|read|net|write)
      OPERATION="$1"
      shift
      ARGS=("$@")
      break
      ;;
    *)
      shift
      ;;
  esac
done

case "$OPERATION" in
  exec)
    CMD="\${ARGS[0]}"
    ALLOWED_CMDS=(${allowedCommands.map((c) => `"${c}"`).join(" ")})
    for allowed in "\${ALLOWED_CMDS[@]}"; do
      if [[ "$CMD" == "$allowed" ]]; then
        echo "Command allowed: $CMD"
        exit 0
      fi
    done
    echo "Command blocked: $CMD" >&2
    exit 1
    ;;
  read)
    READPATH="\${ARGS[0]}"
    # Check for path traversal (contains ..)
    if [[ "$READPATH" == *".."* ]]; then
      echo "Path traversal blocked: $READPATH" >&2
      exit 1
    fi
    ALLOWED_PATHS=(${allowedPaths.map((p) => `"${p}"`).join(" ")})
    for allowed in "\${ALLOWED_PATHS[@]}"; do
      if [[ "$READPATH" == "$allowed"* ]]; then
        echo "Read allowed: $READPATH"
        exit 0
      fi
    done
    # Allow reads within workspace
    if [[ "$READPATH" == "$WORKSPACE"* ]]; then
      echo "Read allowed (workspace): $READPATH"
      exit 0
    fi
    echo "Read blocked: $READPATH" >&2
    exit 1
    ;;
  net)
    HOST="\${ARGS[0]}"
    ALLOWED_HOSTS=(${allowedHosts.map((h) => `"${h}"`).join(" ")})
    for allowed in "\${ALLOWED_HOSTS[@]}"; do
      if [[ "$HOST" == "$allowed" ]]; then
        echo "Network allowed: $HOST"
        exit 0
      fi
    done
    echo "Network blocked: $HOST" >&2
    exit 1
    ;;
  write)
    WRITEPATH="\${ARGS[0]}"
    # Allow writes within workspace
    if [[ "$WRITEPATH" == "$WORKSPACE"* ]]; then
      echo "Write allowed (workspace): $WRITEPATH"
      exit 0
    fi
    ALLOWED_WRITE=(${allowedWritePaths.map((p) => `"${p}"`).join(" ")})
    for allowed in "\${ALLOWED_WRITE[@]}"; do
      if [[ "$WRITEPATH" == "$allowed"* ]]; then
        echo "Write allowed: $WRITEPATH"
        exit 0
      fi
    done
    echo "Write blocked: $WRITEPATH" >&2
    exit 1
    ;;
  *)
    echo "Unknown operation: $OPERATION" >&2
    exit 1
    ;;
esac
`;

  await writeFile(scriptPath, script);
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

describe("SecurityTestSuite", () => {
  test("assertCommandBlocked passes when command is denied", async () => {
    const sandboxPath = await createMockSandbox(ws.root, {
      allowedCommands: ["echo"],
    });

    const suite = new SecurityTestSuite({
      sandboxCommand: [sandboxPath],
      workspaceDir: ws.root,
    });

    const result = await suite.assertCommandBlocked("rm");
    expect(result.passed).toBe(true);
    expect(result.operation).toBe("exec: rm");
  });

  test("assertCommandBlocked throws when command is allowed", async () => {
    const sandboxPath = await createMockSandbox(ws.root, {
      allowedCommands: ["echo", "dangerous"],
    });

    const suite = new SecurityTestSuite({
      sandboxCommand: [sandboxPath],
      workspaceDir: ws.root,
    });

    await expect(suite.assertCommandBlocked("dangerous")).rejects.toThrow(
      'expected command "dangerous" to be blocked',
    );
  });

  test("assertCommandAllowed passes when command is permitted", async () => {
    const sandboxPath = await createMockSandbox(ws.root, {
      allowedCommands: ["echo", "ls"],
    });

    const suite = new SecurityTestSuite({
      sandboxCommand: [sandboxPath],
      workspaceDir: ws.root,
    });

    const result = await suite.assertCommandAllowed("echo");
    expect(result.passed).toBe(true);
    expect(result.operation).toBe("exec: echo");
  });

  test("assertCommandAllowed throws when command is blocked", async () => {
    const sandboxPath = await createMockSandbox(ws.root, {
      allowedCommands: [],
    });

    const suite = new SecurityTestSuite({
      sandboxCommand: [sandboxPath],
      workspaceDir: ws.root,
    });

    await expect(suite.assertCommandAllowed("echo")).rejects.toThrow(
      'expected command "echo" to be allowed',
    );
  });

  test("assertPathTraversalBlocked passes on path traversal attempt", async () => {
    const sandboxPath = await createMockSandbox(ws.root);

    const suite = new SecurityTestSuite({
      sandboxCommand: [sandboxPath],
      workspaceDir: ws.root,
    });

    const result = await suite.assertPathTraversalBlocked("../../etc/passwd");
    expect(result.passed).toBe(true);
    expect(result.operation).toContain("../../etc/passwd");
  });

  test("assertPathTraversalBlocked throws on non-traversal path inside workspace", async () => {
    const sandboxPath = await createMockSandbox(ws.root);

    const suite = new SecurityTestSuite({
      sandboxCommand: [sandboxPath],
      workspaceDir: ws.root,
    });

    // A path within the workspace (no ..) should be allowed
    const workspacePath = join(ws.root, "file.txt");
    await expect(
      suite.assertPathTraversalBlocked(workspacePath),
    ).rejects.toThrow("to be blocked");
  });

  test("assertNetworkBlocked passes when network is denied", async () => {
    const sandboxPath = await createMockSandbox(ws.root, {
      allowedHosts: [],
    });

    const suite = new SecurityTestSuite({
      sandboxCommand: [sandboxPath],
      workspaceDir: ws.root,
    });

    const result = await suite.assertNetworkBlocked("evil.com");
    expect(result.passed).toBe(true);
    expect(result.operation).toBe("network: evil.com");
  });

  test("assertNetworkBlocked throws when network is allowed", async () => {
    const sandboxPath = await createMockSandbox(ws.root, {
      allowedHosts: ["allowed.com"],
    });

    const suite = new SecurityTestSuite({
      sandboxCommand: [sandboxPath],
      workspaceDir: ws.root,
    });

    await expect(suite.assertNetworkBlocked("allowed.com")).rejects.toThrow(
      'expected network access to "allowed.com" to be blocked',
    );
  });

  test("assertFsWriteBlocked passes when write outside workspace is denied", async () => {
    const sandboxPath = await createMockSandbox(ws.root);

    const suite = new SecurityTestSuite({
      sandboxCommand: [sandboxPath],
      workspaceDir: ws.root,
    });

    const result = await suite.assertFsWriteBlocked("/tmp/evil-write.txt");
    expect(result.passed).toBe(true);
    expect(result.operation).toBe("fs write: /tmp/evil-write.txt");
  });

  test("assertFsWriteBlocked throws when write is allowed", async () => {
    const sandboxPath = await createMockSandbox(ws.root);

    const suite = new SecurityTestSuite({
      sandboxCommand: [sandboxPath],
      workspaceDir: ws.root,
    });

    // Writing inside workspace is allowed by the mock sandbox
    const insidePath = join(ws.root, "allowed-file.txt");
    await expect(suite.assertFsWriteBlocked(insidePath)).rejects.toThrow(
      "to be blocked",
    );
  });

  test("getResults collects all test results", async () => {
    const sandboxPath = await createMockSandbox(ws.root, {
      allowedCommands: ["echo"],
    });

    const suite = new SecurityTestSuite({
      sandboxCommand: [sandboxPath],
      workspaceDir: ws.root,
    });

    await suite.assertCommandBlocked("rm");
    await suite.assertCommandAllowed("echo");

    const results = suite.getResults();
    expect(results).toHaveLength(2);
    expect(results[0]!.passed).toBe(true);
    expect(results[1]!.passed).toBe(true);
  });

  test("getSummary reports correct counts", async () => {
    const sandboxPath = await createMockSandbox(ws.root, {
      allowedCommands: ["echo"],
    });

    const suite = new SecurityTestSuite({
      sandboxCommand: [sandboxPath],
      workspaceDir: ws.root,
    });

    await suite.assertCommandBlocked("rm");
    await suite.assertCommandBlocked("curl");
    await suite.assertCommandAllowed("echo");

    const summary = suite.getSummary();
    expect(summary.total).toBe(3);
    expect(summary.passed).toBe(3);
    expect(summary.failed).toBe(0);
  });

  test("clearResults resets the results", async () => {
    const sandboxPath = await createMockSandbox(ws.root, {
      allowedCommands: ["echo"],
    });

    const suite = new SecurityTestSuite({
      sandboxCommand: [sandboxPath],
      workspaceDir: ws.root,
    });

    await suite.assertCommandBlocked("rm");
    expect(suite.getResults()).toHaveLength(1);

    suite.clearResults();
    expect(suite.getResults()).toHaveLength(0);
    expect(suite.getSummary().total).toBe(0);
  });

  test("multiple security assertions in sequence", async () => {
    const sandboxPath = await createMockSandbox(ws.root, {
      allowedCommands: ["echo", "ls"],
      allowedHosts: [],
    });

    const suite = new SecurityTestSuite({
      sandboxCommand: [sandboxPath],
      workspaceDir: ws.root,
    });

    // All of these should pass
    await suite.assertCommandBlocked("rm");
    await suite.assertCommandBlocked("wget");
    await suite.assertCommandAllowed("echo");
    await suite.assertCommandAllowed("ls");
    await suite.assertPathTraversalBlocked("../../../etc/shadow");
    await suite.assertNetworkBlocked("malicious-server.com");
    await suite.assertFsWriteBlocked("/etc/crontab");

    const summary = suite.getSummary();
    expect(summary.total).toBe(7);
    expect(summary.passed).toBe(7);
    expect(summary.failed).toBe(0);
  });
});
