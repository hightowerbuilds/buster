/**
 * Extension manifest parsing and validation (TypeScript side).
 * Mirrors the Rust manifest validator in the SDK.
 */

export interface ExtensionManifest {
  extension: {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    entry: string;
  };
  capabilities?: {
    read_files?: boolean;
    write_files?: boolean;
    list_directories?: boolean;
    run_commands?: boolean;
    network?: boolean;
  };
}

/** Validate an extension ID. Returns an array of error strings (empty = valid). */
export function validateId(id: string): string[] {
  const errors: string[] = [];

  if (!id) {
    errors.push("id is required");
    return errors;
  }

  if (id.length > 64) {
    errors.push("id must be 64 characters or fewer");
  }

  if (!/^[a-z0-9-]+$/.test(id)) {
    errors.push("id must contain only lowercase letters, numbers, and hyphens");
  }

  if (id.startsWith("-") || id.endsWith("-")) {
    errors.push("id must not start or end with a hyphen");
  }

  if (id.includes("--")) {
    errors.push("id must not contain consecutive hyphens");
  }

  return errors;
}

/** Validate a full manifest. Returns an array of error strings (empty = valid). */
export function validateManifest(manifest: ExtensionManifest): string[] {
  const errors: string[] = [];
  const ext = manifest.extension;

  if (!ext) {
    errors.push("[extension] section is required");
    return errors;
  }

  errors.push(...validateId(ext.id));

  if (!ext.name) errors.push("name is required");
  if (!ext.version) errors.push("version is required");

  if (!ext.entry) {
    errors.push("entry is required");
  } else if (ext.entry.includes("..") || ext.entry.startsWith("/")) {
    errors.push("entry must be a relative path without '..'");
  }

  return errors;
}
