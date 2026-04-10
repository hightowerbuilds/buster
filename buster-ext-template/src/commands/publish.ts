/**
 * `buster-ext publish [path] --registry <url> --token <token>`
 *
 * CLI command handler that wraps the publish module.
 */

import { resolve } from "node:path";
import { publish, type PublishConfig } from "../publish.ts";

export async function publishCommand(args: string[]): Promise<void> {
  let packagePath: string | undefined;
  let registryUrl: string | undefined;
  let token: string | undefined;

  // Parse args
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--registry" || arg === "-r") {
      registryUrl = args[++i];
    } else if (arg === "--token" || arg === "-t") {
      token = args[++i];
    } else if (!arg.startsWith("-")) {
      packagePath = arg;
    }
  }

  if (!registryUrl) {
    throw new Error(
      "Registry URL is required. Usage: buster-ext publish [path] --registry <url> --token <token>",
    );
  }

  if (!token) {
    throw new Error(
      "Auth token is required. Usage: buster-ext publish [path] --registry <url> --token <token>",
    );
  }

  // Default to finding a .buster-ext file in the current directory
  if (!packagePath) {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(process.cwd());
    const extFiles = files.filter((f) => f.endsWith(".buster-ext"));
    if (extFiles.length === 0) {
      throw new Error(
        "No .buster-ext file found in current directory. Run 'buster-ext package' first, or provide a path.",
      );
    }
    if (extFiles.length > 1) {
      throw new Error(
        `Multiple .buster-ext files found: ${extFiles.join(", ")}. Please specify which one to publish.`,
      );
    }
    packagePath = extFiles[0]!;
  }

  const resolvedPath = resolve(process.cwd(), packagePath);
  const config: PublishConfig = { registryUrl, token };

  console.log(`Publishing ${packagePath}...`);
  const result = await publish(resolvedPath, config);
  console.log(`Published ${result.id}@${result.version}`);
}
