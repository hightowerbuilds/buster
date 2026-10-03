import { Component, createSignal, For, Show, onMount } from "solid-js";
import { listExtensions, loadExtension, unloadExtension, type ExtensionInfo } from "../lib/extension-host";
import { extInstall, extUninstall, extCall } from "../lib/ipc";
import { showError, showSuccess, showInfo } from "../lib/notify";

const CAPABILITY_LABELS: Record<string, string> = {
  network: "Open gateway connections",
  workspace_read: "Read workspace files",
  workspace_write: "Write workspace files",
  commands: "Execute shell commands",
  terminal: "Access terminal system",
  notifications: "Show notifications",
  gateway_connect: "Connect to gateways",
  file_read: "Read files",
  file_write: "Write files",
  render_surface: "Render to canvas surfaces",
};

const ExtensionsPage: Component = () => {
  const [extensions, setExtensions] = createSignal<ExtensionInfo[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [toggling, setToggling] = createSignal<string | null>(null);
  const [installing, setInstalling] = createSignal(false);
  const [confirmUninstall, setConfirmUninstall] = createSignal<string | null>(null);

  async function refresh() {
    try {
      setExtensions(await listExtensions());
    } catch {
      showError("Failed to load extensions");
    }
    setLoaded(true);
  }

  onMount(refresh);

  async function handleToggle(ext: ExtensionInfo) {
    setToggling(ext.id);
    try {
      if (ext.active) {
        await unloadExtension(ext.id);
        showInfo(`Disabled ${ext.name}`);
      } else {
        await loadExtension(ext.id);
        showSuccess(`Enabled ${ext.name}`);
      }
      await refresh();
    } catch (e) {
      showError("Extension toggle failed", e);
    }
    setToggling(null);
  }

  async function handleLaunch(ext: ExtensionInfo, commandId: string) {
    try {
      // Auto-enable if not active
      if (!ext.active) {
        await loadExtension(ext.id);
        await refresh();
      }
      await extCall(ext.id, commandId);
    } catch (e) {
      showError("Extension launch failed", e);
    }
  }

  async function handleInstall() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, title: "Select extension folder" });
      if (!selected) return;
      setInstalling(true);
      const info = await extInstall(selected as string);
      showSuccess(`Installed ${info.name}`);
      await refresh();
    } catch (e) {
      showError("Extension install failed", e);
    }
    setInstalling(false);
  }

  async function handleUninstall(id: string) {
    setConfirmUninstall(null);
    try {
      await extUninstall(id);
      showSuccess("Extension uninstalled");
      await refresh();
    } catch (e) {
      showError("Extension uninstall failed", e);
    }
  }

  return (
    <div class="ext-page">
      <div class="ext-header">
        <span class="ext-title">Extensions</span>
        <button class="ext-install-btn" onClick={handleInstall} disabled={installing()}>
          {installing() ? <><span class="spinner spinner-sm" /> Installing...</> : "Install from folder"}
        </button>
      </div>
      <div class="ext-body">
        <Show when={!loaded()}>
          <div class="ext-empty"><span class="spinner" style={{ "margin-right": "8px" }} /> Loading extensions...</div>
        </Show>
        <Show when={loaded() && extensions().length === 0}>
          <div class="ext-empty">
            No extensions installed. Click "Install from folder" or place extensions in <code>~/.buster/extensions/</code>.
          </div>
        </Show>

        <For each={extensions()}>
          {(ext) => {
            const launchCmds = () => ext.commands.filter(c => c.kind === "launch");
            const hasLaunch = () => launchCmds().length > 0;

            return (
              <div class="ext-card">
                <div class="ext-card-header">
                  <span class="ext-card-name">{ext.name}</span>
                  <span class="ext-card-version">v{ext.version}</span>
                  <Show when={hasLaunch()}>
                    <For each={launchCmds()}>
                      {(cmd) => (
                        <button
                          class="ext-launch-btn"
                          onClick={() => handleLaunch(ext, cmd.id)}
                        >
                          {cmd.label}
                        </button>
                      )}
                    </For>
                  </Show>
                  <Show when={!hasLaunch()}>
                    <button
                      class={`ext-toggle-btn ${ext.active ? "ext-toggle-active" : ""}`}
                      onClick={() => handleToggle(ext)}
                      disabled={toggling() === ext.id}
                    >
                      {toggling() === ext.id ? <><span class="spinner spinner-sm" /></> : ext.active ? "Disable" : "Enable"}
                    </button>
                  </Show>
                </div>
                <Show when={ext.description}>
                  <div class="ext-card-desc">{ext.description}</div>
                </Show>
                <Show when={ext.capabilities.length > 0}>
                  <div class="ext-card-caps">
                    <For each={ext.capabilities}>
                      {(cap) => (
                        <span class="ext-cap-badge" title={CAPABILITY_LABELS[cap] ?? cap}>{cap}</span>
                      )}
                    </For>
                  </div>
                </Show>
                <div class="ext-card-actions">
                  <Show when={confirmUninstall() === ext.id}>
                    <span class="ext-confirm-text">Uninstall {ext.name}?</span>
                    <button class="ext-confirm-yes" onClick={() => handleUninstall(ext.id)}>Yes</button>
                    <button class="ext-confirm-no" onClick={() => setConfirmUninstall(null)}>No</button>
                  </Show>
                  <Show when={confirmUninstall() !== ext.id}>
                    <button class="ext-uninstall-btn" onClick={() => setConfirmUninstall(ext.id)}>Uninstall</button>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export default ExtensionsPage;
