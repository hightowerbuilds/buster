use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewBuilder, WebviewUrl};

pub struct BrowserInstance {
    pub url: String,
    pub visible: bool,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub struct BrowserManager {
    instances: Mutex<HashMap<String, BrowserInstance>>,
    next_id: Mutex<u32>,
}

impl BrowserManager {
    pub fn new() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
            next_id: Mutex::new(1),
        }
    }

    pub fn create(
        &self,
        app: &AppHandle,
        url: &str,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<String, String> {
        let mut id_counter = self.next_id.lock().map_err(|e| e.to_string())?;
        let browser_id = format!("browser_{}", *id_counter);
        *id_counter += 1;

        let window = app
            .get_window("main")
            .ok_or("Main window not found")?;

        let parsed_url: url::Url = url.parse().map_err(|e| format!("Invalid URL: {}", e))?;

        // Persistent data directory so cookies/cache survive across sessions
        let data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("browser_data");

        window
            .add_child(
                WebviewBuilder::new(&browser_id, WebviewUrl::External(parsed_url))
                    .data_directory(data_dir)
                    .initialization_script(Self::dark_theme_script()),
                tauri::LogicalPosition::new(x, y),
                tauri::LogicalSize::new(width, height),
            )
            .map_err(|e| format!("Failed to create webview: {}", e))?;

        self.instances
            .lock()
            .map_err(|e| e.to_string())?
            .insert(
                browser_id.clone(),
                BrowserInstance {
                    url: url.to_string(),
                    visible: true,
                    x, y, width, height,
                },
            );

        Ok(browser_id)
    }

    pub fn navigate(&self, app: &AppHandle, browser_id: &str, url: &str) -> Result<(), String> {
        let parsed_url: url::Url = url.parse().map_err(|e| format!("Invalid URL: {}", e))?;
        let webview = app
            .get_webview(browser_id)
            .ok_or("Browser view not found")?;
        webview.navigate(parsed_url).map_err(|e| format!("Navigation failed: {}", e))?;

        if let Ok(mut instances) = self.instances.lock() {
            if let Some(inst) = instances.get_mut(browser_id) {
                inst.url = url.to_string();
            }
        }
        Ok(())
    }

    pub fn resize(
        &self,
        app: &AppHandle,
        browser_id: &str,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<(), String> {
        let webview = app
            .get_webview(browser_id)
            .ok_or("Browser view not found")?;
        webview
            .set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| format!("Set position failed: {}", e))?;
        webview
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| format!("Set size failed: {}", e))?;

        if let Ok(mut instances) = self.instances.lock() {
            if let Some(inst) = instances.get_mut(browser_id) {
                inst.x = x;
                inst.y = y;
                inst.width = width;
                inst.height = height;
            }
        }
        Ok(())
    }

    pub fn show(&self, app: &AppHandle, browser_id: &str) -> Result<(), String> {
        let webview = app
            .get_webview(browser_id)
            .ok_or("Browser view not found")?;

        let _ = webview.show();

        // Restore to saved position
        let (x, y, w, h) = {
            let instances = self.instances.lock().map_err(|e| e.to_string())?;
            let inst = instances.get(browser_id).ok_or("Instance not found")?;
            (inst.x, inst.y, inst.width, inst.height)
        };

        webview
            .set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| format!("Show failed: {}", e))?;
        webview
            .set_size(tauri::LogicalSize::new(w, h))
            .map_err(|e| format!("Show failed: {}", e))?;

        if let Ok(mut instances) = self.instances.lock() {
            if let Some(inst) = instances.get_mut(browser_id) {
                inst.visible = true;
            }
        }
        Ok(())
    }

    pub fn hide(&self, app: &AppHandle, browser_id: &str) -> Result<(), String> {
        let webview = app
            .get_webview(browser_id)
            .ok_or("Browser view not found")?;
        webview
            .set_position(tauri::LogicalPosition::new(-10000.0_f64, -10000.0_f64))
            .map_err(|e| format!("Hide failed: {}", e))?;
        let _ = webview.hide();
        if let Ok(mut instances) = self.instances.lock() {
            if let Some(inst) = instances.get_mut(browser_id) {
                inst.visible = false;
            }
        }
        Ok(())
    }

    pub fn close(&self, app: &AppHandle, browser_id: &str) -> Result<(), String> {
        if let Some(webview) = app.get_webview(browser_id) {
            webview.close().map_err(|e| format!("Close failed: {}", e))?;
        }
        self.instances
            .lock()
            .map_err(|e| e.to_string())?
            .remove(browser_id);
        Ok(())
    }

    /// Hide all browser views (move offscreen).
    pub fn hide_all(&self, app: &AppHandle) -> Result<(), String> {
        let instances = self.instances.lock().map_err(|e| e.to_string())?;
        for (id, _) in instances.iter() {
            if let Some(webview) = app.get_webview(id) {
                let _ = webview.set_position(tauri::LogicalPosition::new(-10000.0_f64, -10000.0_f64));
            }
        }
        Ok(())
    }

    /// Show all browser views (restore to saved positions).
    pub fn show_all(&self, app: &AppHandle) -> Result<(), String> {
        let instances = self.instances.lock().map_err(|e| e.to_string())?;
        for (id, inst) in instances.iter() {
            if let Some(webview) = app.get_webview(id) {
                let _ = webview.set_position(tauri::LogicalPosition::new(inst.x, inst.y));
                let _ = webview.set_size(tauri::LogicalSize::new(inst.width, inst.height));
            }
        }
        Ok(())
    }

    pub fn go_back(&self, app: &AppHandle, browser_id: &str) -> Result<(), String> {
        let webview = app.get_webview(browser_id).ok_or("Browser view not found")?;
        webview.eval("history.back()").map_err(|e| format!("eval failed: {}", e))
    }

    pub fn go_forward(&self, app: &AppHandle, browser_id: &str) -> Result<(), String> {
        let webview = app.get_webview(browser_id).ok_or("Browser view not found")?;
        webview.eval("history.forward()").map_err(|e| format!("eval failed: {}", e))
    }

    pub fn reload(&self, app: &AppHandle, browser_id: &str) -> Result<(), String> {
        let webview = app.get_webview(browser_id).ok_or("Browser view not found")?;
        webview.eval("location.reload()").map_err(|e| format!("eval failed: {}", e))
    }

    fn dark_theme_script() -> &'static str {
        r#"(function(){
            var s=document.createElement('style');
            s.textContent='html{background:#1e1e2e!important;color-scheme:dark}::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track{background:#1e1e2e}::-webkit-scrollbar-thumb{background:#45475a;border-radius:4px}::-webkit-scrollbar-thumb:hover{background:#585b70}::selection{background:rgba(137,180,250,0.3)}';
            document.documentElement.appendChild(s);
        })();"#
    }
}
