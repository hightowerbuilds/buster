/**
 * `buster-ext dev` — Start a local dev server with hot-reload.
 *
 * Usage: buster-ext dev [--port <port>] [--dir <path>]
 */

import { resolve } from "node:path";
import { DevServer } from "../dev-server.ts";

export async function devCommand(args: string[]): Promise<void> {
  let port = 3000;
  let dir = process.cwd();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--port" || arg === "-p") {
      const val = args[++i];
      if (!val) throw new Error("--port requires a value");
      port = parseInt(val, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port: ${val}`);
      }
    } else if (arg === "--dir" || arg === "-d") {
      const val = args[++i];
      if (!val) throw new Error("--dir requires a value");
      dir = resolve(val);
    }
  }

  const server = new DevServer();
  await server.start(port, dir);

  // Keep running until the process is killed
  process.on("SIGINT", () => {
    server.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    server.stop();
    process.exit(0);
  });
}
