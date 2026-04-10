#!/usr/bin/env bun
/**
 * buster-ext CLI — scaffolding, building, validating, and publishing Buster IDE extensions.
 *
 * Commands:
 *   init <name>     Create a new extension project (--template formatter|linter|language)
 *   validate        Validate extension.toml in the current directory
 *   build           Build the extension WASM (wraps cargo build --target wasm32-unknown-unknown)
 *   package         Package the extension for distribution
 *   publish         Publish a .buster-ext package to a registry
 *   dev             Start a dev server with hot-reload
 */

import { init } from "./commands/init.ts";
import { validate } from "./commands/validate.ts";
import { build } from "./commands/build.ts";
import { pack } from "./commands/package.ts";
import { publishCommand } from "./commands/publish.ts";
import { devCommand } from "./commands/dev.ts";

const [command, ...args] = process.argv.slice(2);

const commands: Record<string, (args: string[]) => Promise<void>> = {
  init,
  validate,
  build,
  package: pack,
  publish: publishCommand,
  dev: devCommand,
};

async function main() {
  if (!command || command === "--help" || command === "-h") {
    console.log(`buster-ext — Buster IDE Extension CLI

Usage:
  buster-ext init <name>                Create a new extension project
    --template formatter|linter|language   Use a specialized template
  buster-ext validate                   Validate extension.toml
  buster-ext build                      Build extension WASM
  buster-ext package                    Package extension for distribution
  buster-ext publish [path]             Publish to a registry
    --registry <url>                       Registry URL (required)
    --token <token>                        Auth token (required)
  buster-ext dev                        Start dev server with hot-reload
    --port <port>                          Server port (default: 3000)
    --dir <path>                           Extension directory (default: .)
`);
    process.exit(0);
  }

  const handler = commands[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.error(`Run 'buster-ext --help' for usage.`);
    process.exit(1);
  }

  try {
    await handler(args);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
