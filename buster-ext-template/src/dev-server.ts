/**
 * Local development server with hot-reload for Buster IDE extensions.
 *
 * Watches the extension source directory for changes, triggers a rebuild,
 * and notifies connected IDE instances via WebSocket.
 */

import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { Server, ServerWebSocket } from "bun";

export interface DevServerOptions {
  port: number;
  extensionDir: string;
}

interface ReloadMessage {
  type: "reload";
  extension_id: string;
}

export class DevServer {
  private server: Server | null = null;
  private watcher: FSWatcher | null = null;
  private clients: Set<ServerWebSocket<unknown>> = new Set();
  private extensionId: string = "unknown";
  private building = false;

  /**
   * Start the dev server, watching the given extension directory.
   *
   * @param port — port number for the WebSocket server
   * @param extensionDir — root of the extension project (must contain extension.toml)
   */
  async start(port: number, extensionDir: string): Promise<void> {
    // Read extension ID from manifest
    this.extensionId = await this.readExtensionId(extensionDir);

    const self = this;

    this.server = Bun.serve({
      port,
      fetch(req, server) {
        // Upgrade HTTP requests to WebSocket
        if (server.upgrade(req)) {
          return undefined;
        }
        return new Response("Buster Extension Dev Server", { status: 200 });
      },
      websocket: {
        open(ws) {
          self.clients.add(ws);
          console.log(`Client connected (${self.clients.size} total)`);
        },
        message(_ws, _message) {
          // No incoming messages expected from clients
        },
        close(ws) {
          self.clients.delete(ws);
          console.log(`Client disconnected (${self.clients.size} total)`);
        },
      },
    });

    // Watch for source file changes
    const srcDir = join(extensionDir, "src");
    this.watcher = watch(srcDir, { recursive: true }, (_event, filename) => {
      if (filename) {
        console.log(`File changed: ${filename}`);
        this.rebuild(extensionDir);
      }
    });

    console.log(
      `Dev server listening on ws://localhost:${port} (extension: ${this.extensionId})`,
    );
    console.log(`Watching ${srcDir} for changes...`);
  }

  /** Stop the dev server and file watcher. */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
    this.clients.clear();
    console.log("Dev server stopped.");
  }

  /** Trigger a rebuild and notify connected clients on success. */
  private async rebuild(extensionDir: string): Promise<void> {
    if (this.building) return;
    this.building = true;

    try {
      console.log("Rebuilding...");

      const proc = Bun.spawn(["buster-ext", "build"], {
        cwd: extensionDir,
        stdout: "inherit",
        stderr: "inherit",
      });

      const exitCode = await proc.exited;

      if (exitCode === 0) {
        console.log("Build succeeded. Notifying clients...");
        this.notifyClients();
      } else {
        console.error(`Build failed with exit code ${exitCode}`);
      }
    } catch (err: any) {
      console.error(`Build error: ${err.message}`);
    } finally {
      this.building = false;
    }
  }

  /** Send a reload message to all connected WebSocket clients. */
  private notifyClients(): void {
    const message: ReloadMessage = {
      type: "reload",
      extension_id: this.extensionId,
    };
    const payload = JSON.stringify(message);

    for (const client of this.clients) {
      client.send(payload);
    }
    console.log(`Notified ${this.clients.size} client(s).`);
  }

  /** Read the extension ID from extension.toml. */
  private async readExtensionId(extensionDir: string): Promise<string> {
    try {
      const raw = await readFile(join(extensionDir, "extension.toml"), "utf-8");
      const match = raw.match(/^id\s*=\s*"(.+)"/m);
      return match ? match[1]! : "unknown";
    } catch {
      return "unknown";
    }
  }
}
