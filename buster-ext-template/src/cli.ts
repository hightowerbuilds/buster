#!/usr/bin/env bun
/**
 * buster-ext CLI — scaffolding, building, and validating Buster IDE extensions.
 *
 * Commands:
 *   init <name>     Create a new extension project
 *   validate        Validate extension.toml in the current directory
 *   build           Build the extension WASM (wraps cargo build --target wasm32-unknown-unknown)
 *   package         Package the extension for distribution
 */

import { init } from "./commands/init.ts";
import { validate } from "./commands/validate.ts";
import { build } from "./commands/build.ts";
import { pack } from "./commands/package.ts";

const [command, ...args] = process.argv.slice(2);

const commands: Record<string, (args: string[]) => Promise<void>> = {
  init,
  validate,
  build,
  package: pack,
};

async function main() {
  if (!command || command === "--help" || command === "-h") {
    console.log(`buster-ext — Buster IDE Extension CLI

Usage:
  buster-ext init <name>     Create a new extension project
  buster-ext validate        Validate extension.toml
  buster-ext build           Build extension WASM
  buster-ext package         Package extension for distribution
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
