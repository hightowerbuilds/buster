use std::sync::Arc;
use std::fs;
use std::path::Path;
use tauri::{command, AppHandle, Emitter, State};

use crate::extensions::gateway::GatewayConfig;
use crate::extensions::{ExtensionInfo, ExtensionManager, save_enabled_state};
use crate::browser::BrowserManager;

/// List all discovered extensions.
#[command]
pub async fn ext_list(
    state: State<'_, ExtensionManager>,
) -> Result<Vec<ExtensionInfo>, String> {
    // Re-scan on every list to pick up newly installed extensions
    state.scan().await?;
    Ok(state.list().await)
}

/// Load (activate) an extension by ID.
#[command]
pub async fn ext_load(
    app: AppHandle,
    state: State<'_, ExtensionManager>,
    _surfaces: State<'_, Arc<crate::extensions::surface::SurfaceManager>>,
    browser_mgr: State<'_, Arc<BrowserManager>>,
    extension_id: String,
) -> Result<ExtensionInfo, String> {
    state.scan().await?;

    let app_handle = app.clone();
    let event_sink = Arc::new(move |event: crate::extensions::gateway::GatewayEvent| {
        let _ = app_handle.emit("gateway-event", &event);
    });

    // Use the shared SurfaceManager from ExtensionManager
    let surface_manager = state.surface_manager();
    {
        let measure_app = app.clone();
        surface_manager.set_measure_sink(Arc::new(move |req: crate::extensions::surface::MeasureTextRequest| {
            let _ = measure_app.emit("surface-measure-text", &req);
        }));
        let surface_app = app.clone();
        surface_manager.set_event_sink(Arc::new(move |event: crate::extensions::surface::SurfaceEvent| {
            let _ = surface_app.emit("surface-event", &event);
        }));
    }

    let measure_app = app.clone();
    let measure_event_sink: Arc<dyn Fn(crate::extensions::surface::MeasureTextRequest) + Send + Sync> = Arc::new(move |req: crate::extensions::surface::MeasureTextRequest| {
        let _ = measure_app.emit("surface-measure-text", &req);
    });

    let browser_manager: Arc<BrowserManager> = (*browser_mgr).clone();
    let info = state.load(&extension_id, event_sink, surface_manager, measure_event_sink, app.clone(), browser_manager).await?;

    // Persist enabled state
    let enabled: Vec<String> = state.list().await.iter()
        .filter(|e| e.active)
        .map(|e| e.id.clone())
        .collect();
    save_enabled_state(&enabled);

    Ok(info)
}

/// Unload (deactivate) an extension.
#[command]
pub async fn ext_unload(
    state: State<'_, ExtensionManager>,
    surfaces: State<'_, Arc<crate::extensions::surface::SurfaceManager>>,
    extension_id: String,
) -> Result<(), String> {
    state.unload(&extension_id, &*surfaces).await?;

    // Persist enabled state
    let enabled: Vec<String> = state.list().await.iter()
        .filter(|e| e.active)
        .map(|e| e.id.clone())
        .collect();
    save_enabled_state(&enabled);

    Ok(())
}

/// Restore previously enabled extensions from persisted state.
#[command]
pub async fn ext_restore(
    app: AppHandle,
    state: State<'_, ExtensionManager>,
    browser_mgr: State<'_, Arc<BrowserManager>>,
) -> Result<Vec<String>, String> {
    let enabled_ids = crate::extensions::load_enabled_state();
    if enabled_ids.is_empty() {
        return Ok(Vec::new());
    }

    state.scan().await?;

    let mut restored = Vec::new();
    for id in &enabled_ids {
        let app_handle = app.clone();
        let event_sink = Arc::new(move |event: crate::extensions::gateway::GatewayEvent| {
            let _ = app_handle.emit("gateway-event", &event);
        });

        let surface_manager = state.surface_manager();
        {
            let measure_app = app.clone();
            surface_manager.set_measure_sink(Arc::new(move |req: crate::extensions::surface::MeasureTextRequest| {
                let _ = measure_app.emit("surface-measure-text", &req);
            }));
            let surface_app = app.clone();
            surface_manager.set_event_sink(Arc::new(move |event: crate::extensions::surface::SurfaceEvent| {
                let _ = surface_app.emit("surface-event", &event);
            }));
        }

        let measure_app = app.clone();
        let measure_event_sink: Arc<dyn Fn(crate::extensions::surface::MeasureTextRequest) + Send + Sync> = Arc::new(move |req: crate::extensions::surface::MeasureTextRequest| {
            let _ = measure_app.emit("surface-measure-text", &req);
        });

        let browser_manager: Arc<BrowserManager> = (*browser_mgr).clone();
        match state.load(id, event_sink, surface_manager, measure_event_sink, app.clone(), browser_manager).await {
            Ok(_) => restored.push(id.clone()),
            Err(e) => eprintln!("Failed to restore extension '{}': {}", id, e),
        }
    }

    Ok(restored)
}

/// Connect to a gateway on behalf of an extension.
#[command]
pub async fn ext_gateway_connect(
    app: AppHandle,
    state: State<'_, ExtensionManager>,
    extension_id: String,
    config: GatewayConfig,
) -> Result<u32, String> {
    let app_handle = app.clone();
    let event_sink = Arc::new(move |event: crate::extensions::gateway::GatewayEvent| {
        let _ = app_handle.emit("gateway-event", &event);
    });

    state.gateway_connect(&extension_id, config, event_sink).await
}

/// Send a message through a gateway connection.
#[command]
pub async fn ext_gateway_send(
    state: State<'_, ExtensionManager>,
    connection_id: u32,
    message: String,
) -> Result<(), String> {
    state.gateway_send(connection_id, &message).await
}

/// Disconnect a gateway connection.
#[command]
pub async fn ext_gateway_disconnect(
    state: State<'_, ExtensionManager>,
    connection_id: u32,
) -> Result<(), String> {
    state.gateway_disconnect(connection_id).await
}

/// Call a method on a loaded extension's WASM module.
#[command]
pub async fn ext_call(
    state: State<'_, ExtensionManager>,
    extension_id: String,
    method: String,
    params: Option<String>,
) -> Result<String, String> {
    state
        .call(&extension_id, &method, params.as_deref().unwrap_or("{}"))
        .await
}

/// Install an extension from a local directory path.
#[command]
pub async fn ext_install(
    _app: AppHandle,
    state: State<'_, ExtensionManager>,
    source_path: String,
) -> Result<ExtensionInfo, String> {
    let src = Path::new(&source_path);
    let manifest_path = src.join("extension.toml");
    if !manifest_path.exists() {
        return Err("No extension.toml found in the specified directory".into());
    }

    // Parse manifest to get the extension ID
    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read extension.toml: {}", e))?;
    let manifest: toml::Value = toml::from_str(&manifest_str)
        .map_err(|e| format!("Invalid extension.toml: {}", e))?;
    let ext_id = manifest.get("extension")
        .and_then(|e| e.get("id"))
        .and_then(|v| v.as_str())
        .ok_or("extension.toml missing [extension].id")?;

    // Copy to extensions directory
    let ext_dir = crate::extensions::extensions_dir().join(ext_id);

    if ext_dir.exists() {
        fs::remove_dir_all(&ext_dir)
            .map_err(|e| format!("Failed to remove existing extension: {}", e))?;
    }

    // Copy directory recursively
    copy_dir_recursive(src, &ext_dir)?;

    // Re-scan and return info
    state.scan().await?;
    let list = state.list().await;
    list.into_iter()
        .find(|e| e.id == ext_id)
        .ok_or_else(|| "Extension installed but not found after scan".into())
}

/// Uninstall an extension by ID.
#[command]
pub async fn ext_uninstall(
    _app: AppHandle,
    state: State<'_, ExtensionManager>,
    surfaces: State<'_, Arc<crate::extensions::surface::SurfaceManager>>,
    extension_id: String,
) -> Result<(), String> {
    // Unload if active
    let _ = state.unload(&extension_id, &*surfaces).await;

    let ext_dir = crate::extensions::extensions_dir().join(&extension_id);

    if ext_dir.exists() {
        fs::remove_dir_all(&ext_dir)
            .map_err(|e| format!("Failed to remove extension directory: {}", e))?;
    }

    // Remove from persisted enabled state
    let enabled: Vec<String> = state.list().await.iter()
        .filter(|e| e.active && e.id != extension_id)
        .map(|e| e.id.clone())
        .collect();
    save_enabled_state(&enabled);

    state.scan().await?;
    Ok(())
}

#[tauri::command]
pub fn surface_measure_text_response(
    surfaces: tauri::State<'_, Arc<crate::extensions::surface::SurfaceManager>>,
    request_id: u64,
    width: f64,
    height: f64,
    ascent: f64,
    descent: f64,
) -> Result<(), String> {
    surfaces.resolve_measure(
        request_id,
        crate::extensions::surface::TextMetrics { width, height, ascent, descent },
    );
    Ok(())
}

#[tauri::command]
pub async fn surface_get_last_paint(
    state: tauri::State<'_, ExtensionManager>,
    surface_id: u32,
) -> Result<Option<String>, String> {
    Ok(state.surface_manager().get_last_paint(surface_id))
}

#[tauri::command]
pub fn surface_resize_notify(
    surfaces: tauri::State<'_, Arc<crate::extensions::surface::SurfaceManager>>,
    surface_id: u32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    surfaces.resize_surface(surface_id, width, height)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Failed to create dir: {}", e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read dir: {}", e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dst_path)?;
        } else {
            fs::copy(entry.path(), &dst_path).map_err(|e| format!("Failed to copy file: {}", e))?;
        }
    }
    Ok(())
}
