/**
 * `buster-ext validate` — Validate the extension.toml in the current directory.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateManifest, type ExtensionManifest } from "../manifest.ts";

export async function validate(_args: string[]): Promise<void> {
  const manifestPath = join(process.cwd(), "extension.toml");

  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch {
    throw new Error(`No extension.toml found in ${process.cwd()}`);
  }

  // Simple TOML parser for the flat manifest structure
  const manifest = parseSimpleToml(raw);
  const errors = validateManifest(manifest as ExtensionManifest);

  if (errors.length > 0) {
    console.error("Manifest validation failed:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log("extension.toml is valid.");
}

/** Minimal TOML parser for the flat extension manifest format. */
function parseSimpleToml(raw: string): Record<string, any> {
  const result: Record<string, any> = {};
  let currentSection = "";

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Section header: [section]
    const sectionMatch = trimmed.match(/^\[(\w+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!;
      if (!result[currentSection]) result[currentSection] = {};
      continue;
    }

    // Key-value: key = "value" or key = true
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1]!;
      let value: any = kvMatch[2]!.trim();

      // Strip quotes
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (value === "true") {
        value = true;
      } else if (value === "false") {
        value = false;
      }

      if (currentSection) {
        result[currentSection][key] = value;
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}
