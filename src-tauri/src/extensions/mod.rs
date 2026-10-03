#[allow(dead_code)]
pub mod manifest;
#[allow(dead_code)]
pub mod gateway;
#[allow(dead_code)]
pub mod runtime;
#[allow(dead_code)]
pub mod surface;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

use gateway::{GatewayConfig, GatewayEvent, GatewayManager};
use manifest::ExtensionManifest;
use runtime::{ExtensionInstance, WasmRuntime};

/// A command contributed by an extension.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ExtensionCommand {
    pub id: String,
    pub label: String,
    pub kind: String,
}

/// Serializable extension info for the frontend.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ExtensionInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub capabilities: Vec<String>,
    pub commands: Vec<ExtensionCommand>,
    pub active: bool,
}

impl From<&ExtensionManifest> for ExtensionInfo {
    fn from(m: &ExtensionManifest) -> Self {
        Self {
            id: m.extension.id.clone(),
            name: m.extension.name.clone(),
            version: m.extension.version.clone(),
            description: m.extension.description.clone(),
            capabilities: m.capabilities.to_list(),
            commands: m.commands.iter().map(|c| ExtensionCommand { id: c.id.clone(), label: c.label.clone(), kind: c.kind.clone() }).collect(),
            active: false,
        }
    }
}

/// Top-level manager for the extension system.
/// Owns the WASM runtime, gateway manager, and all loaded extensions.
pub struct ExtensionManager {
    gateway_manager: Arc<GatewayManager>,
    /// Loaded (active) extension instances
    instances: Arc<Mutex<HashMap<String, ExtensionInstance>>>,
    /// Discovered extension manifests (from disk scan)
    discovered: Arc<Mutex<HashMap<String, (ExtensionManifest, PathBuf)>>>,
    /// Workspace root — shared with extensions
    workspace_root: Arc<Mutex<Option<String>>>,
    /// Shared surface manager — all extensions use this so buffered paints are accessible
    shared_surface_manager: Arc<surface::SurfaceManager>,
}

impl ExtensionManager {
    pub fn new() -> Self {
        Self {
            gateway_manager: Arc::new(GatewayManager::new()),
            instances: Arc::new(Mutex::new(HashMap::new())),
            discovered: Arc::new(Mutex::new(HashMap::new())),
            workspace_root: Arc::new(Mutex::new(None)),
            shared_surface_manager: Arc::new(surface::SurfaceManager::new()),
        }
    }

    /// Get the shared surface manager.
    pub fn surface_manager(&self) -> Arc<surface::SurfaceManager> {
        self.shared_surface_manager.clone()
    }

    /// Scan the extensions directory and discover available extensions.
    /// Extensions live in ~/.buster/extensions/<id>/extension.toml
    pub async fn scan(&self) -> Result<(), String> {
        let ext_dir = extensions_dir();
        if !ext_dir.exists() {
            std::fs::create_dir_all(&ext_dir)
                .map_err(|e| format!("Failed to create extensions dir: {}", e))?;
            return Ok(());
        }

        let mut discovered = self.discovered.lock().await;
        discovered.clear();

        let entries = std::fs::read_dir(&ext_dir)
            .map_err(|e| format!("Failed to read extensions dir: {}", e))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let manifest_path = path.join("extension.toml");
            if !manifest_path.exists() {
                continue;
            }
            match std::fs::read_to_string(&manifest_path) {
                Ok(content) => match toml::from_str::<ExtensionManifest>(&content) {
                    Ok(manifest) => {
                        let id = manifest.extension.id.clone();
                        discovered.insert(id, (manifest, path));
                    }
                    Err(e) => {
                        eprintln!("Invalid extension.toml in {:?}: {}", path, e);
                    }
                },
                Err(e) => {
                    eprintln!("Failed to read {:?}: {}", manifest_path, e);
                }
            }
        }

        Ok(())
    }

    /// List all discovered extensions with their active status.
    pub async fn list(&self) -> Vec<ExtensionInfo> {
        let discovered = self.discovered.lock().await;
        let instances = self.instances.lock().await;

        discovered
            .values()
            .map(|(manifest, _)| {
                let mut info = ExtensionInfo::from(manifest);
                info.active = instances.contains_key(&info.id);
                info
            })
            .collect()
    }

    /// Load and activate an extension by ID.
    pub async fn load(
        &self,
        extension_id: &str,
        event_sink: Arc<dyn Fn(GatewayEvent) + Send + Sync>,
        surface_manager: Arc<surface::SurfaceManager>,
        measure_event_sink: Arc<dyn Fn(surface::MeasureTextRequest) + Send + Sync>,
        app_handle: tauri::AppHandle,
        browser_manager: Arc<crate::browser::BrowserManager>,
    ) -> Result<ExtensionInfo, String> {
        // Check if already loaded
        if self.instances.lock().await.contains_key(extension_id) {
            return Err(format!("Extension '{}' is already loaded", extension_id));
        }

        // Find the discovered manifest
        let discovered = self.discovered.lock().await;
        let (manifest, dir) = discovered
            .get(extension_id)
            .ok_or(format!("Extension '{}' not found", extension_id))?;
        let dir = dir.clone();
        let manifest = manifest.clone();
        drop(discovered);

        // Check if WASM file exists
        let wasm_path = dir.join("extension.wasm");
        if !wasm_path.exists() {
            // No WASM binary — register as a "manifest-only" extension.
            // This is valid for extensions that only declare gateway configs
            // and don't need custom WASM logic.
            let mut info = ExtensionInfo::from(&manifest);
            info.active = true;
            return Ok(info);
        }

        // Load WASM
        let runtime = WasmRuntime::new(self.gateway_manager.clone())
            .map_err(|e| format!("Failed to create WASM runtime: {}", e))?;

        let mut instance = runtime.load_extension(
            &dir,
            self.workspace_root.clone(),
            event_sink,
            surface_manager,
            measure_event_sink,
            app_handle,
            browser_manager,
        )?;

        // Activate
        instance.activate()?;

        let mut info = ExtensionInfo::from(&manifest);
        info.active = true;

        self.instances
            .lock()
            .await
            .insert(extension_id.to_string(), instance);

        Ok(info)
    }

    /// Unload an extension.
    pub async fn unload(&self, extension_id: &str, surface_manager: &surface::SurfaceManager) -> Result<(), String> {
        // Disconnect all gateway connections for this extension
        self.gateway_manager.disconnect_all(extension_id).await;
        surface_manager.release_all_for_extension(extension_id);

        // Deactivate and remove
        let mut instances = self.instances.lock().await;
        if let Some(mut instance) = instances.remove(extension_id) {
            // Close all browser views owned by this extension before deactivating
            instance.close_all_browsers();
            instance.deactivate()?;
        }
        Ok(())
    }

    /// Connect to a gateway on behalf of an extension.
    pub async fn gateway_connect(
        &self,
        extension_id: &str,
        config: GatewayConfig,
        event_sink: Arc<dyn Fn(GatewayEvent) + Send + Sync>,
    ) -> Result<u32, String> {
        // Verify extension has network capability
        let discovered = self.discovered.lock().await;
        if let Some((manifest, _)) = discovered.get(extension_id) {
            if !manifest.capabilities.network {
                return Err(format!(
                    "Extension '{}' does not have network capability",
                    extension_id
                ));
            }
        }
        drop(discovered);

        self.gateway_manager
            .connect(extension_id, &config, move |event| {
                event_sink(event);
            })
            .await
    }

    /// Send a message through a gateway connection.
    pub async fn gateway_send(&self, connection_id: u32, message: &str) -> Result<(), String> {
        self.gateway_manager.send(connection_id, message).await
    }

    /// Disconnect a gateway connection.
    pub async fn gateway_disconnect(&self, connection_id: u32) -> Result<(), String> {
        self.gateway_manager.disconnect(connection_id).await
    }

    /// Call a method on a loaded extension.
    pub async fn call(
        &self,
        extension_id: &str,
        method: &str,
        params: &str,
    ) -> Result<String, String> {
        let mut instances = self.instances.lock().await;
        let instance = instances
            .get_mut(extension_id)
            .ok_or(format!("Extension '{}' is not loaded", extension_id))?;
        instance.call_method(method, params)
    }
}

/// Save the list of enabled extension IDs to disk.
pub fn save_enabled_state(enabled_ids: &[String]) {
    let path = buster_dir().join("extensions").join("state.json");
    if let Ok(json) = serde_json::to_string_pretty(enabled_ids) {
        let _ = std::fs::write(path, json);
    }
}

/// Load the list of previously enabled extension IDs from disk.
pub fn load_enabled_state() -> Vec<String> {
    let path = buster_dir().join("extensions").join("state.json");
    match std::fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// Get the extensions directory: ~/.buster/extensions/
pub fn extensions_dir() -> PathBuf {
    buster_dir().join("extensions")
}

fn buster_dir() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        home.join(".buster")
    } else {
        PathBuf::from(".buster")
    }
}
