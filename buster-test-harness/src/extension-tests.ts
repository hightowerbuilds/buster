/**
 * Extension Lifecycle Test Harness.
 *
 * Simulates installing, loading, calling, unloading, and uninstalling
 * extensions in a mock host environment. Used for testing extension
 * lifecycle behavior without requiring the full IDE.
 */

import { join } from "node:path";
import { mkdir, rm, readdir, stat, writeFile, readFile, cp } from "node:fs/promises";

/** Represents the activation state of an extension */
export type ExtensionState = "installed" | "loaded" | "unloaded" | "uninstalled";

/** Metadata about an installed extension */
export interface ExtensionInfo {
  id: string;
  path: string;
  state: ExtensionState;
  manifest: ExtensionManifest;
}

/** Extension manifest (package.json-style) */
export interface ExtensionManifest {
  name: string;
  version: string;
  main?: string;
  activationEvents?: string[];
  contributes?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Mock host environment context passed to extensions */
export interface HostContext {
  /** The workspace root path */
  workspaceRoot: string;
  /** Storage path for the extension */
  storagePath: string;
  /** Log function */
  log: (message: string) => void;
  /** Register a command handler */
  registerCommand: (name: string, handler: (...args: unknown[]) => unknown) => void;
}

/**
 * A test harness for simulating extension lifecycle events.
 *
 * Uses a mock host environment pattern: extensions are loaded as
 * ES modules, their activate/deactivate exports are called, and
 * command registrations are captured.
 */
export class ExtensionTestHarness {
  private readonly extensionsDir: string;
  private readonly extensions = new Map<string, ExtensionInfo>();
  private readonly loadedModules = new Map<string, Record<string, unknown>>();
  private readonly commands = new Map<string, (...args: unknown[]) => unknown>();
  private readonly logs: string[] = [];

  /**
   * @param extensionsDir - Directory to store installed extensions.
   *                        Will be created if it doesn't exist.
   */
  constructor(extensionsDir: string) {
    this.extensionsDir = extensionsDir;
  }

  /**
   * Install an extension from a source path.
   *
   * Copies the extension files into the managed extensions directory
   * and reads its manifest.
   */
  async install(extensionPath: string): Promise<string> {
    // Read the manifest
    const manifestPath = join(extensionPath, "package.json");
    let manifest: ExtensionManifest;

    try {
      const raw = await readFile(manifestPath, "utf-8");
      manifest = JSON.parse(raw) as ExtensionManifest;
    } catch {
      throw new Error(
        `Failed to read extension manifest at ${manifestPath}. ` +
        `Extensions must have a package.json with at least "name" and "version".`,
      );
    }

    if (!manifest.name || !manifest.version) {
      throw new Error(
        `Extension manifest must include "name" and "version" fields`,
      );
    }

    const id = manifest.name;

    if (this.extensions.has(id)) {
      throw new Error(`Extension "${id}" is already installed`);
    }

    // Copy to extensions directory
    const destPath = join(this.extensionsDir, id);
    await mkdir(destPath, { recursive: true });
    await cp(extensionPath, destPath, { recursive: true });

    const info: ExtensionInfo = {
      id,
      path: destPath,
      state: "installed",
      manifest,
    };

    this.extensions.set(id, info);
    return id;
  }

  /**
   * Load and activate an extension.
   *
   * Imports the extension's main module and calls its `activate` export
   * with a mock host context.
   */
  async load(extensionId: string): Promise<void> {
    const info = this.extensions.get(extensionId);
    if (!info) {
      throw new Error(`Extension "${extensionId}" is not installed`);
    }

    if (info.state === "loaded") {
      throw new Error(`Extension "${extensionId}" is already loaded`);
    }

    const mainFile = info.manifest.main ?? "index.js";
    const mainPath = join(info.path, mainFile);

    // Verify the entry point exists
    try {
      await stat(mainPath);
    } catch {
      throw new Error(
        `Extension entry point not found: ${mainPath}`,
      );
    }

    // Import the module
    const mod = (await import(mainPath)) as Record<string, unknown>;
    this.loadedModules.set(extensionId, mod);

    // Create a mock host context
    const context: HostContext = {
      workspaceRoot: this.extensionsDir,
      storagePath: join(this.extensionsDir, ".storage", extensionId),
      log: (message: string) => {
        this.logs.push(`[${extensionId}] ${message}`);
      },
      registerCommand: (name: string, handler: (...args: unknown[]) => unknown) => {
        this.commands.set(`${extensionId}.${name}`, handler);
      },
    };

    // Ensure storage directory exists
    await mkdir(context.storagePath, { recursive: true });

    // Call activate if it exists
    if (typeof mod.activate === "function") {
      await (mod.activate as (ctx: HostContext) => unknown | Promise<unknown>)(context);
    }

    info.state = "loaded";
  }

  /**
   * Call a method/command registered by an extension.
   *
   * The command name is looked up as `extensionId.method`.
   */
  async call(
    extensionId: string,
    method: string,
    ...args: unknown[]
  ): Promise<unknown> {
    const info = this.extensions.get(extensionId);
    if (!info) {
      throw new Error(`Extension "${extensionId}" is not installed`);
    }

    if (info.state !== "loaded") {
      throw new Error(
        `Extension "${extensionId}" is not loaded (state: ${info.state})`,
      );
    }

    const commandKey = `${extensionId}.${method}`;
    const handler = this.commands.get(commandKey);

    if (handler) {
      return await handler(...args);
    }

    // Fall back to calling an exported function on the module
    const mod = this.loadedModules.get(extensionId);
    if (mod && typeof mod[method] === "function") {
      return await (mod[method] as (...a: unknown[]) => unknown)(...args);
    }

    throw new Error(
      `Extension "${extensionId}" has no command or export named "${method}"`,
    );
  }

  /**
   * Deactivate an extension.
   *
   * Calls the extension's `deactivate` export if it exists and
   * removes all its registered commands.
   */
  async unload(extensionId: string): Promise<void> {
    const info = this.extensions.get(extensionId);
    if (!info) {
      throw new Error(`Extension "${extensionId}" is not installed`);
    }

    if (info.state !== "loaded") {
      throw new Error(
        `Extension "${extensionId}" is not loaded (state: ${info.state})`,
      );
    }

    const mod = this.loadedModules.get(extensionId);
    if (mod && typeof mod.deactivate === "function") {
      await (mod.deactivate as () => unknown | Promise<unknown>)();
    }

    // Remove registered commands
    for (const key of this.commands.keys()) {
      if (key.startsWith(`${extensionId}.`)) {
        this.commands.delete(key);
      }
    }

    this.loadedModules.delete(extensionId);
    info.state = "unloaded";
  }

  /**
   * Uninstall an extension.
   *
   * Removes the extension files and all metadata. The extension
   * must be unloaded first.
   */
  async uninstall(extensionId: string): Promise<void> {
    const info = this.extensions.get(extensionId);
    if (!info) {
      throw new Error(`Extension "${extensionId}" is not installed`);
    }

    if (info.state === "loaded") {
      throw new Error(
        `Extension "${extensionId}" must be unloaded before uninstalling`,
      );
    }

    // Remove files
    await rm(info.path, { recursive: true, force: true });

    // Clean up storage
    const storagePath = join(this.extensionsDir, ".storage", extensionId);
    await rm(storagePath, { recursive: true, force: true });

    info.state = "uninstalled";
    this.extensions.delete(extensionId);
  }

  /**
   * List all currently installed extensions.
   */
  getInstalledExtensions(): ExtensionInfo[] {
    return Array.from(this.extensions.values());
  }

  /**
   * Get info about a specific extension.
   */
  getExtension(extensionId: string): ExtensionInfo | undefined {
    return this.extensions.get(extensionId);
  }

  /**
   * Get all log messages captured during extension operations.
   */
  getLogs(): string[] {
    return [...this.logs];
  }

  /**
   * Get all registered command names.
   */
  getRegisteredCommands(): string[] {
    return Array.from(this.commands.keys());
  }

  /**
   * Clean up the entire extensions directory.
   */
  async cleanup(): Promise<void> {
    // Unload all loaded extensions first
    for (const info of this.extensions.values()) {
      if (info.state === "loaded") {
        await this.unload(info.id);
      }
    }

    await rm(this.extensionsDir, { recursive: true, force: true });
    this.extensions.clear();
    this.loadedModules.clear();
    this.commands.clear();
    this.logs.length = 0;
  }
}
