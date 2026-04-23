use std::sync::Arc;
use crate::extensions::surface::SurfaceManager;
use crate::extensions::ExtensionManager;

#[tauri::command]
pub fn surface_measure_text_response(
    surfaces: tauri::State<'_, Arc<SurfaceManager>>,
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
    surfaces: tauri::State<'_, Arc<SurfaceManager>>,
    surface_id: u32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    surfaces.resize_surface(surface_id, width, height)
}
