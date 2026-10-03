import {
  extList,
  extLoad,
  extUnload,
  extCall,
  type ExtensionInfo,
} from "./ipc";
import { registry } from "./command-registry";

export type { ExtensionInfo };

/** List all available extensions. */
export async function listExtensions(): Promise<ExtensionInfo[]> {
  return extList();
}

/** Load an extension by ID. Registers its commands in the command palette. */
export async function loadExtension(id: string): Promise<ExtensionInfo> {
  const info = await extLoad(id);
  // Register extension commands in the command palette
  for (const cmd of info.commands) {
    registry.register({
      id: cmd.id,
      label: cmd.label,
      category: info.name,
      execute: () => { extCall(id, cmd.id).catch(console.error); },
    });
  }
  return info;
}

/** Unload an extension. Unregisters its commands from the command palette. */
export async function unloadExtension(id: string): Promise<void> {
  // Unregister commands before unloading
  const exts = await extList();
  const ext = exts.find(e => e.id === id);
  if (ext) {
    for (const cmd of ext.commands) {
      registry.unregister(cmd.id);
    }
  }
  return extUnload(id);
}
