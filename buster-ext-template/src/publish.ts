/**
 * `buster-ext publish` — Publish a .buster-ext package to a registry.
 *
 * Validates the package, reads the manifest, and uploads via multipart POST.
 */

import { stat, readFile } from "node:fs/promises";
import { basename } from "node:path";

export interface PublishConfig {
  registryUrl: string;
  token: string;
}

export interface PublishResult {
  id: string;
  version: string;
}

/**
 * Publish a .buster-ext package to the given registry.
 *
 * @param packagePath — path to the .buster-ext file
 * @param config — registry URL and auth token
 * @returns the extension id and version from the registry response
 */
export async function publish(
  packagePath: string,
  config: PublishConfig,
): Promise<PublishResult> {
  // Validate config
  if (!config.registryUrl) {
    throw new Error("registryUrl is required");
  }
  if (!config.token) {
    throw new Error("token is required");
  }

  // Validate the package file exists
  try {
    const info = await stat(packagePath);
    if (!info.isFile()) {
      throw new Error(`${packagePath} is not a file`);
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(`Package not found: ${packagePath}`);
    }
    throw err;
  }

  // Validate file extension
  if (!packagePath.endsWith(".buster-ext")) {
    throw new Error("Package file must have a .buster-ext extension");
  }

  // Read the package file
  const fileContent = await readFile(packagePath);
  const fileName = basename(packagePath);

  // Build multipart form data
  const formData = new FormData();
  formData.append(
    "package",
    new Blob([fileContent], { type: "application/gzip" }),
    fileName,
  );

  // Upload to registry
  const url = `${config.registryUrl.replace(/\/+$/, "")}/api/extensions/publish`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    let errorMessage: string;
    try {
      const body = await response.json() as { error?: string };
      errorMessage = body.error || response.statusText;
    } catch {
      errorMessage = response.statusText;
    }
    throw new Error(`Publish failed (${response.status}): ${errorMessage}`);
  }

  const result = (await response.json()) as PublishResult;

  if (!result.id || !result.version) {
    throw new Error("Invalid response from registry: missing id or version");
  }

  return result;
}
