use std::time::Duration;
use tauri::{command, AppHandle, State};
use crate::browser::BrowserManager;

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
