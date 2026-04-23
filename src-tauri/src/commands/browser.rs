use std::sync::Arc;
use std::time::Duration;
use tauri::{command, AppHandle, State};
use tokio::sync::Mutex;

use crate::browser::BrowserManager;
use crate::browser_module::BrowserModule;
use crate::extensions::surface::SurfaceManager;
use crate::workspace::WorkspaceState;

#[derive(Debug, Clone, serde::Serialize)]
pub struct LocalPort {
    pub port: u16,
    pub url: String,
}

/// Scan common dev server ports in parallel to find running local servers.
#[command]
pub async fn scan_local_ports() -> Vec<LocalPort> {
    let common_ports: Vec<u16> = vec![
        3000, 3001, 3333, 4000, 4200, 4321, 5000, 5173, 5174, 5500,
        8000, 8080, 8081, 8888, 9000, 9090,
    ];
    let timeout = Duration::from_millis(200);

    let handles: Vec<_> = common_ports
        .into_iter()
        .map(|port| {
            tokio::spawn(async move {
                let addr = format!("127.0.0.1:{}", port);
                match tokio::time::timeout(
                    timeout,
                    tokio::net::TcpStream::connect(&addr),
                )
                .await
                {
                    Ok(Ok(_)) => Some(LocalPort {
                        port,
                        url: format!("http://localhost:{}", port),
                    }),
                    _ => None,
                }
            })
        })
        .collect();

    let mut results = Vec::new();
    for handle in handles {
        if let Ok(Some(port)) = handle.await {
            results.push(port);
        }
    }
    results
}

#[command]
pub fn create_browser_view(
    app: AppHandle,
    state: State<'_, std::sync::Arc<BrowserManager>>,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, String> {
    state.create(&app, &url, x, y, width, height)
}

#[command]
pub fn navigate_browser_view(
    app: AppHandle,
    state: State<'_, std::sync::Arc<BrowserManager>>,
    browser_id: String,
    url: String,
) -> Result<(), String> {
    state.navigate(&app, &browser_id, &url)
}

#[command]
pub fn resize_browser_view(
    app: AppHandle,
    state: State<'_, std::sync::Arc<BrowserManager>>,
    browser_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    state.resize(&app, &browser_id, x, y, width, height)
}

#[command]
pub fn show_browser_view(
    app: AppHandle,
    state: State<'_, std::sync::Arc<BrowserManager>>,
    browser_id: String,
) -> Result<(), String> {
    state.show(&app, &browser_id)
}

#[command]
pub fn hide_browser_view(
    app: AppHandle,
    state: State<'_, std::sync::Arc<BrowserManager>>,
    browser_id: String,
) -> Result<(), String> {
    state.hide(&app, &browser_id)
}

#[command]
pub fn close_browser_view(
    app: AppHandle,
    state: State<'_, std::sync::Arc<BrowserManager>>,
    browser_id: String,
) -> Result<(), String> {
    state.close(&app, &browser_id)
}

#[command]
pub fn hide_all_browser_views(
    app: AppHandle,
    state: State<'_, std::sync::Arc<BrowserManager>>,
) -> Result<(), String> {
    state.hide_all(&app)
}

#[command]
pub fn browser_go_back(
    app: AppHandle,
    state: State<'_, std::sync::Arc<BrowserManager>>,
    browser_id: String,
) -> Result<(), String> {
    state.go_back(&app, &browser_id)
}

#[command]
pub fn browser_go_forward(
    app: AppHandle,
    state: State<'_, std::sync::Arc<BrowserManager>>,
    browser_id: String,
) -> Result<(), String> {
    state.go_forward(&app, &browser_id)
}

#[command]
pub fn browser_reload(
    app: AppHandle,
    state: State<'_, std::sync::Arc<BrowserManager>>,
    browser_id: String,
) -> Result<(), String> {
    state.reload(&app, &browser_id)
}

#[command]
pub fn show_all_browser_views(
    app: AppHandle,
    state: State<'_, std::sync::Arc<BrowserManager>>,
) -> Result<(), String> {
    state.show_all(&app)
}

// ---------------------------------------------------------------------------
// Browser Module commands (canvas-rendered browser)
// ---------------------------------------------------------------------------

type BrowserModuleState = Mutex<Option<BrowserModule>>;

/// Ensure the browser module is initialized, creating it lazily on first use.
async fn ensure_module(
    state: &BrowserModuleState,
    app: &AppHandle,
    surface_manager: &Arc<SurfaceManager>,
    browser_manager: &Arc<BrowserManager>,
    workspace: &WorkspaceState,
) -> Result<(), String> {
    let mut guard = state.lock().await;
    if guard.is_none() {
        let ws_root = workspace.get();
        let ws_mutex = tokio::sync::Mutex::new(ws_root);
        let module = BrowserModule::new(
            app.clone(),
            surface_manager.clone(),
            browser_manager.clone(),
            Arc::new(ws_mutex),
        )?;
        *guard = Some(module);
    }
    Ok(())
}

#[command]
pub async fn browser_module_launch(
    app: AppHandle,
    state: State<'_, BrowserModuleState>,
    surface_manager: State<'_, Arc<SurfaceManager>>,
    browser_manager: State<'_, Arc<BrowserManager>>,
    workspace: State<'_, WorkspaceState>,
) -> Result<String, String> {
    ensure_module(&state, &app, &surface_manager, &browser_manager, &workspace).await?;
    let mut guard = state.lock().await;
    let module = guard.as_mut().ok_or("Browser module not initialized")?;
    module.call_command("launch_browser", "{}")
}

#[command]
pub async fn browser_module_navigate(
    state: State<'_, BrowserModuleState>,
    url: String,
) -> Result<String, String> {
    let mut guard = state.lock().await;
    let module = guard.as_mut().ok_or("Browser module not initialized")?;
    module.call_command("navigate", &url)
}

#[command]
pub async fn browser_module_refresh(
    state: State<'_, BrowserModuleState>,
) -> Result<String, String> {
    let mut guard = state.lock().await;
    let module = guard.as_mut().ok_or("Browser module not initialized")?;
    module.call_command("refresh", "{}")
}

#[command]
pub async fn browser_module_poll(
    state: State<'_, BrowserModuleState>,
) -> Result<String, String> {
    let mut guard = state.lock().await;
    let module = guard.as_mut().ok_or("Browser module not initialized")?;
    module.call_command("poll", "{}")
}

#[command]
pub async fn browser_module_on_click(
    state: State<'_, BrowserModuleState>,
    x: f64,
    y: f64,
    button: i32,
) -> Result<String, String> {
    let mut guard = state.lock().await;
    let module = guard.as_mut().ok_or("Browser module not initialized")?;
    let params = serde_json::json!({"x": x, "y": y, "button": button}).to_string();
    module.call_command("on_click", &params)
}

#[command]
pub async fn browser_module_on_key(
    state: State<'_, BrowserModuleState>,
    key: String,
    code: String,
    shift: bool,
    ctrl: bool,
    alt: bool,
) -> Result<String, String> {
    let mut guard = state.lock().await;
    let module = guard.as_mut().ok_or("Browser module not initialized")?;
    let params = serde_json::json!({
        "key": key, "code": code, "shift": shift, "ctrl": ctrl, "alt": alt
    })
    .to_string();
    module.call_command("on_key", &params)
}

#[command]
pub async fn browser_module_on_resize(
    state: State<'_, BrowserModuleState>,
    width: f64,
    height: f64,
    abs_x: f64,
    abs_y: f64,
) -> Result<String, String> {
    let mut guard = state.lock().await;
    let module = guard.as_mut().ok_or("Browser module not initialized")?;
    let params =
        serde_json::json!({"width": width, "height": height, "abs_x": abs_x, "abs_y": abs_y})
            .to_string();
    module.call_command("on_resize", &params)
}

#[command]
pub async fn browser_module_on_visibility(
    state: State<'_, BrowserModuleState>,
    visible: bool,
) -> Result<String, String> {
    let mut guard = state.lock().await;
    let module = guard.as_mut().ok_or("Browser module not initialized")?;
    let params = serde_json::json!({"visible": visible}).to_string();
    module.call_command("on_visibility", &params)
}

#[command]
pub async fn browser_module_on_mouse_move(
    state: State<'_, BrowserModuleState>,
    x: f64,
    y: f64,
    buttons: i32,
) -> Result<String, String> {
    let mut guard = state.lock().await;
    let module = guard.as_mut().ok_or("Browser module not initialized")?;
    let params = serde_json::json!({"x": x, "y": y, "buttons": buttons}).to_string();
    module.call_command("on_mouse_move", &params)
}

#[command]
pub async fn browser_module_close(
    state: State<'_, BrowserModuleState>,
) -> Result<(), String> {
    let mut guard = state.lock().await;
    if let Some(module) = guard.as_mut() {
        module.deactivate();
    }
    *guard = None;
    Ok(())
}
