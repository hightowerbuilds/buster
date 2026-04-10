/**
 * LSP Integration Test Client.
 *
 * Spawns a real language server process and communicates with it
 * over JSON-RPC via stdio, following the Language Server Protocol.
 */

import type { Subprocess } from "bun";

/** A JSON-RPC request message */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

/** A JSON-RPC response message */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** A JSON-RPC notification (no id) */
interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

/** A diagnostic received from the server */
export interface Diagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

/** A completion item returned by the server */
export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  insertText?: string;
  [key: string]: unknown;
}

/** Hover information returned by the server */
export interface HoverResult {
  contents: string | { kind: string; value: string } | Array<string | { kind: string; value: string }>;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

/** Location returned by definition requests */
export interface LocationResult {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export class LspTestClient {
  private proc: Subprocess | null = null;
  private nextId = 1;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  private diagnosticsMap = new Map<string, Diagnostic[]>();
  private readBuffer = "";
  private readerDone = false;

  /**
   * Spawn a language server process and start reading its output.
   *
   * @param serverCommand - Command to launch the server (e.g., ["typescript-language-server", "--stdio"])
   * @param rootPath - The root workspace path to send during initialization
   */
  async start(serverCommand: string[], rootPath: string): Promise<void> {
    if (this.proc) {
      throw new Error("LspTestClient is already started");
    }

    this.diagnosticsMap.clear();
    this.pendingRequests.clear();
    this.readBuffer = "";
    this.readerDone = false;
    this.nextId = 1;

    this.proc = Bun.spawn(serverCommand, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
      cwd: rootPath,
    });

    // Start reading stdout in the background
    this.readStdout();
  }

  /**
   * Send the LSP `initialize` request.
   *
   * Returns the server's capabilities.
   */
  async initialize(rootUri?: string): Promise<unknown> {
    const result = await this.sendRequest("initialize", {
      processId: process.pid,
      rootUri: rootUri ?? `file://${process.cwd()}`,
      capabilities: {
        textDocument: {
          completion: {
            completionItem: { snippetSupport: true },
          },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: {},
          publishDiagnostics: { relatedInformation: true },
        },
        workspace: {
          workspaceFolders: true,
        },
      },
      workspaceFolders: null,
    });

    // Send initialized notification
    this.sendNotification("initialized", {});

    return result;
  }

  /**
   * Notify the server that a document was opened.
   */
  didOpen(uri: string, content: string, languageId = "plaintext"): void {
    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text: content,
      },
    });
  }

  /**
   * Request completions at a position in a document.
   */
  async completion(
    uri: string,
    line: number,
    col: number,
  ): Promise<CompletionItem[]> {
    const result = await this.sendRequest("textDocument/completion", {
      textDocument: { uri },
      position: { line, character: col },
    });

    if (!result) return [];

    // Handle both CompletionList and CompletionItem[] responses
    if (Array.isArray(result)) {
      return result as CompletionItem[];
    }
    if (typeof result === "object" && result !== null && "items" in result) {
      return (result as { items: CompletionItem[] }).items;
    }
    return [];
  }

  /**
   * Request hover information at a position in a document.
   */
  async hover(
    uri: string,
    line: number,
    col: number,
  ): Promise<HoverResult | null> {
    const result = await this.sendRequest("textDocument/hover", {
      textDocument: { uri },
      position: { line, character: col },
    });

    return (result as HoverResult) ?? null;
  }

  /**
   * Request go-to-definition at a position in a document.
   */
  async definition(
    uri: string,
    line: number,
    col: number,
  ): Promise<LocationResult | LocationResult[] | null> {
    const result = await this.sendRequest("textDocument/definition", {
      textDocument: { uri },
      position: { line, character: col },
    });

    return (result as LocationResult | LocationResult[]) ?? null;
  }

  /**
   * Return all diagnostics received so far, optionally filtered by URI.
   */
  diagnostics(uri?: string): Diagnostic[] {
    if (uri) {
      return this.diagnosticsMap.get(uri) ?? [];
    }

    const all: Diagnostic[] = [];
    for (const diags of this.diagnosticsMap.values()) {
      all.push(...diags);
    }
    return all;
  }

  /**
   * Wait for diagnostics to be published for a given URI.
   */
  async waitForDiagnostics(uri: string, timeoutMs = 10_000): Promise<Diagnostic[]> {
    const startTime = performance.now();
    while (performance.now() - startTime < timeoutMs) {
      const diags = this.diagnosticsMap.get(uri);
      if (diags && diags.length > 0) {
        return diags;
      }
      await Bun.sleep(50);
    }
    // Return whatever we have (possibly empty)
    return this.diagnosticsMap.get(uri) ?? [];
  }

  /**
   * Send the LSP `shutdown` request and `exit` notification.
   */
  async shutdown(): Promise<void> {
    if (!this.proc) return;

    try {
      await this.sendRequest("shutdown", null);
      this.sendNotification("exit", null);
    } catch {
      // Server may have already exited
    }

    // Give it a moment, then force-kill if needed
    const exited = Promise.race([
      this.proc.exited,
      Bun.sleep(2000).then(() => "timeout"),
    ]);

    const result = await exited;
    if (result === "timeout") {
      this.proc.kill();
    }

    this.proc = null;
  }

  // ─── Internal JSON-RPC Handling ──────────────────────────────

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    const stdin = this.proc?.stdin;
    if (!stdin || typeof stdin === "number") {
      throw new Error("LspTestClient is not started");
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? undefined,
    };

    const body = JSON.stringify(request);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
    (stdin as import("bun").FileSink).write(header + body);

    return new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // Timeout safety
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`LSP request '${method}' timed out (id=${id})`));
        }
      }, 30_000);
    });
  }

  private sendNotification(method: string, params: unknown): void {
    const stdin = this.proc?.stdin;
    if (!stdin || typeof stdin === "number") {
      throw new Error("LspTestClient is not started");
    }

    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params: params ?? undefined,
    };

    const body = JSON.stringify(notification);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
    (stdin as import("bun").FileSink).write(header + body);
  }

  private async readStdout(): Promise<void> {
    const stdout = this.proc?.stdout;
    if (!stdout || typeof stdout === "number") return;

    const reader = (stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        this.readBuffer += decoder.decode(value, { stream: true });
        this.processBuffer();
      }
    } catch {
      // Stream closed
    } finally {
      this.readerDone = true;
    }
  }

  private processBuffer(): void {
    while (true) {
      // Look for the Content-Length header
      const headerEnd = this.readBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const headerSection = this.readBuffer.slice(0, headerEnd);
      const match = headerSection.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Skip malformed header
        this.readBuffer = this.readBuffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1]!, 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (this.readBuffer.length < bodyEnd) {
        // Not enough data yet
        break;
      }

      const body = this.readBuffer.slice(bodyStart, bodyEnd);
      this.readBuffer = this.readBuffer.slice(bodyEnd);

      try {
        const message = JSON.parse(body);
        this.handleMessage(message);
      } catch {
        // Ignore unparseable messages
      }
    }
  }

  private handleMessage(message: JsonRpcResponse | JsonRpcNotification | Record<string, unknown>): void {
    // Response to a request
    if ("id" in message && typeof message.id === "number") {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if ("error" in message && message.error) {
          const err = message.error as { code: number; message: string };
          pending.reject(new Error(`LSP error ${err.code}: ${err.message}`));
        } else {
          pending.resolve((message as JsonRpcResponse).result);
        }
      }
      return;
    }

    // Notification from server
    if ("method" in message) {
      if (message.method === "textDocument/publishDiagnostics") {
        const params = message.params as {
          uri: string;
          diagnostics: Diagnostic[];
        };
        this.diagnosticsMap.set(params.uri, params.diagnostics);
      }
    }
  }
}
