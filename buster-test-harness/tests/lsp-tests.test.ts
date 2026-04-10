import { test, expect, describe, afterEach } from "bun:test";
import { LspTestClient } from "../src/lsp-tests.ts";
import { createWorkspace, type Workspace } from "../src/fixtures.ts";
import { join } from "node:path";
import { writeFile, chmod } from "node:fs/promises";

let ws: Workspace;

afterEach(async () => {
  if (ws) await ws.cleanup();
});

describe("LspTestClient", () => {
  test("start throws if already started", async () => {
    ws = await createWorkspace();

    const client = new LspTestClient();
    await client.start(["cat"], ws.root);

    try {
      await expect(client.start(["cat"], ws.root)).rejects.toThrow(
        "already started",
      );
    } finally {
      await client.shutdown();
    }
  });

  test("shutdown is safe to call when not started", async () => {
    const client = new LspTestClient();
    // Should not throw
    await client.shutdown();
  });

  test("diagnostics returns empty array when no diagnostics received", () => {
    const client = new LspTestClient();
    expect(client.diagnostics()).toEqual([]);
    expect(client.diagnostics("file:///test.ts")).toEqual([]);
  });

  test("communicates with a mock JSON-RPC server", async () => {
    ws = await createWorkspace();

    // Create a mock LSP server that responds to initialize
    const serverScript = `#!/usr/bin/env bun
const decoder = new TextDecoder();
let buffer = "";

async function main() {
  const stdin = Bun.stdin.stream();
  const reader = stdin.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
      if (headerEnd === -1) break;

      const headerSection = buffer.slice(0, headerEnd);
      const match = headerSection.match(/Content-Length:\\s*(\\d+)/i);
      if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (buffer.length < bodyEnd) break;

      const body = buffer.slice(bodyStart, bodyEnd);
      buffer = buffer.slice(bodyEnd);

      const msg = JSON.parse(body);

      if (msg.method === "initialize") {
        const response = JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            capabilities: {
              completionProvider: { triggerCharacters: ["."] },
              hoverProvider: true,
              definitionProvider: true,
            }
          }
        });
        const header = "Content-Length: " + Buffer.byteLength(response, "utf-8") + "\\r\\n\\r\\n";
        process.stdout.write(header + response);
      } else if (msg.method === "shutdown") {
        const response = JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: null
        });
        const header = "Content-Length: " + Buffer.byteLength(response, "utf-8") + "\\r\\n\\r\\n";
        process.stdout.write(header + response);
      } else if (msg.method === "exit") {
        process.exit(0);
      }
    }
  }
}

main().catch(() => process.exit(1));
`;

    const serverPath = join(ws.root, "mock-lsp.ts");
    await writeFile(serverPath, serverScript);

    const client = new LspTestClient();
    await client.start(["bun", "run", serverPath], ws.root);

    try {
      const initResult = await client.initialize(`file://${ws.root}`);
      expect(initResult).toBeDefined();

      const capabilities = initResult as { capabilities: Record<string, unknown> };
      expect(capabilities.capabilities).toBeDefined();
      expect(capabilities.capabilities.hoverProvider).toBe(true);
      expect(capabilities.capabilities.definitionProvider).toBe(true);
    } finally {
      await client.shutdown();
    }
  });

  test("didOpen sends notification without error", async () => {
    ws = await createWorkspace();

    const client = new LspTestClient();
    await client.start(["cat"], ws.root);

    try {
      // Notifications don't throw even if server ignores them
      client.didOpen("file:///test.ts", "const x = 1;", "typescript");
    } finally {
      await client.shutdown();
    }
  });

  test("mock server handles completion requests", async () => {
    ws = await createWorkspace();

    const serverScript = `#!/usr/bin/env bun
const decoder = new TextDecoder();
let buffer = "";

async function main() {
  const stdin = Bun.stdin.stream();
  const reader = stdin.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
      if (headerEnd === -1) break;

      const headerSection = buffer.slice(0, headerEnd);
      const match = headerSection.match(/Content-Length:\\s*(\\d+)/i);
      if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (buffer.length < bodyEnd) break;

      const body = buffer.slice(bodyStart, bodyEnd);
      buffer = buffer.slice(bodyEnd);

      const msg = JSON.parse(body);

      let result = null;
      if (msg.method === "initialize") {
        result = { capabilities: { completionProvider: {} } };
      } else if (msg.method === "textDocument/completion") {
        result = { isIncomplete: false, items: [{ label: "console" }, { label: "const" }] };
      } else if (msg.method === "textDocument/hover") {
        result = { contents: { kind: "markdown", value: "**number**" } };
      } else if (msg.method === "textDocument/definition") {
        result = { uri: "file:///test.ts", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } };
      } else if (msg.method === "shutdown") {
        result = null;
      } else if (msg.method === "exit") {
        process.exit(0);
      }

      if (msg.id !== undefined) {
        const response = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result });
        const header = "Content-Length: " + Buffer.byteLength(response, "utf-8") + "\\r\\n\\r\\n";
        process.stdout.write(header + response);
      }
    }
  }
}

main().catch(() => process.exit(1));
`;

    const serverPath = join(ws.root, "mock-lsp.ts");
    await writeFile(serverPath, serverScript);

    const client = new LspTestClient();
    await client.start(["bun", "run", serverPath], ws.root);

    try {
      await client.initialize(`file://${ws.root}`);
      client.didOpen("file:///test.ts", "con", "typescript");

      const completions = await client.completion("file:///test.ts", 0, 3);
      expect(completions).toHaveLength(2);
      expect(completions[0]!.label).toBe("console");
      expect(completions[1]!.label).toBe("const");

      const hoverResult = await client.hover("file:///test.ts", 0, 0);
      expect(hoverResult).toBeDefined();
      expect((hoverResult!.contents as { value: string }).value).toBe("**number**");

      const defResult = await client.definition("file:///test.ts", 0, 0);
      expect(defResult).toBeDefined();
    } finally {
      await client.shutdown();
    }
  });

  test("mock server publishes diagnostics", async () => {
    ws = await createWorkspace();

    const serverScript = `#!/usr/bin/env bun
const decoder = new TextDecoder();
let buffer = "";

async function main() {
  const stdin = Bun.stdin.stream();
  const reader = stdin.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
      if (headerEnd === -1) break;

      const headerSection = buffer.slice(0, headerEnd);
      const match = headerSection.match(/Content-Length:\\s*(\\d+)/i);
      if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (buffer.length < bodyEnd) break;

      const body = buffer.slice(bodyStart, bodyEnd);
      buffer = buffer.slice(bodyEnd);

      const msg = JSON.parse(body);

      if (msg.method === "initialize") {
        const response = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } });
        const header = "Content-Length: " + Buffer.byteLength(response, "utf-8") + "\\r\\n\\r\\n";
        process.stdout.write(header + response);
      } else if (msg.method === "textDocument/didOpen") {
        // Publish diagnostics as a notification
        const diag = JSON.stringify({
          jsonrpc: "2.0",
          method: "textDocument/publishDiagnostics",
          params: {
            uri: msg.params.textDocument.uri,
            diagnostics: [{
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              severity: 1,
              message: "Syntax error"
            }]
          }
        });
        const header = "Content-Length: " + Buffer.byteLength(diag, "utf-8") + "\\r\\n\\r\\n";
        process.stdout.write(header + diag);
      } else if (msg.method === "shutdown") {
        const response = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: null });
        const header = "Content-Length: " + Buffer.byteLength(response, "utf-8") + "\\r\\n\\r\\n";
        process.stdout.write(header + response);
      } else if (msg.method === "exit") {
        process.exit(0);
      }
    }
  }
}

main().catch(() => process.exit(1));
`;

    const serverPath = join(ws.root, "mock-lsp.ts");
    await writeFile(serverPath, serverScript);

    const client = new LspTestClient();
    await client.start(["bun", "run", serverPath], ws.root);

    try {
      await client.initialize(`file://${ws.root}`);
      client.didOpen("file:///broken.ts", "const x =", "typescript");

      const diagnostics = await client.waitForDiagnostics("file:///broken.ts", 5000);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0]!.message).toBe("Syntax error");
      expect(diagnostics[0]!.severity).toBe(1);
    } finally {
      await client.shutdown();
    }
  });
});
