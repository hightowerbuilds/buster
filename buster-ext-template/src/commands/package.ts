/**
 * `buster-ext package` — Package the extension for distribution.
 *
 * Creates a .buster-ext archive containing:
 * - extension.toml (manifest)
 * - The WASM binary
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { validateManifest, type ExtensionManifest } from "../manifest.ts";

export async function pack(_args: string[]): Promise<void> {
  const cwd = process.cwd();
  const manifestPath = join(cwd, "extension.toml");

  // Read and validate manifest
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch {
    throw new Error("No extension.toml found. Run 'buster-ext init' first.");
  }

  // Check WASM binary exists
  const manifest = parseManifestEntry(raw);
  const wasmPath = join(cwd, manifest.entry);

  try {
    await stat(wasmPath);
  } catch {
    throw new Error(
      `WASM binary not found at ${manifest.entry}. Run 'buster-ext build' first.`,
    );
  }

  // Create tar.gz archive
  const outName = `${manifest.id}-${manifest.version}.buster-ext`;
  const proc = Bun.spawn(
    ["tar", "czf", outName, "extension.toml", manifest.entry],
    {
      cwd,
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error("Packaging failed");
  }

  console.log(`Packaged: ${outName}`);
}

function parseManifestEntry(raw: string): { id: string; version: string; entry: string } {
  let id = "", version = "", entry = "";
  let inExtension = false;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "[extension]") { inExtension = true; continue; }
    if (trimmed.startsWith("[") && trimmed !== "[extension]") { inExtension = false; continue; }

    if (inExtension) {
      const m = trimmed.match(/^(\w+)\s*=\s*"(.+)"$/);
      if (m) {
        if (m[1] === "id") id = m[2]!;
        if (m[1] === "version") version = m[2]!;
        if (m[1] === "entry") entry = m[2]!;
      }
    }
  }

  return { id, version, entry };
}
