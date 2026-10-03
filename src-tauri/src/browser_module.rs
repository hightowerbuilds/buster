//! Built-in browser module — loads browser.wasm from bundled resources
//! and provides a first-class browser experience without extension installation.
//!
//! Reuses the extension system's WASM host functions and ExtensionState,
//! but with a synthetic manifest that has all needed capabilities enabled.

use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;
use wasmtime::*;

use crate::browser::BrowserManager;
use crate::extensions::gateway::{GatewayEvent, GatewayManager};
use crate::extensions::manifest::{
    Capabilities, CommandDecl, ExtensionManifest, ExtensionMeta,
};
use crate::extensions::runtime::{link_host_functions, ExtensionState};
use crate::extensions::surface::{MeasureTextRequest, SurfaceManager};

/// The built-in browser extension ID — used to identify surface events
/// from this module vs regular extensions.
pub const BUILTIN_BROWSER_ID: &str = "__builtin_browser";

pub struct BrowserModule {
    store: Store<ExtensionState>,
    instance: Instance,
    #[allow(dead_code)]
    engine: Engine,
}

impl BrowserModule {
    /// Load browser.wasm from Tauri's bundled resources and instantiate it.
    pub fn new(
        app_handle: tauri::AppHandle,
        surface_manager: Arc<SurfaceManager>,
        browser_manager: Arc<BrowserManager>,
        workspace_root: Arc<Mutex<Option<String>>>,
    ) -> Result<Self, String> {
        // Resolve resource path
        let resource_path = app_handle
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource dir: {}", e))?
            .join("resources")
            .join("browser.wasm");

        if !resource_path.exists() {
            return Err(format!(
                "browser.wasm not found at {}",
                resource_path.display()
            ));
        }

        // Create engine with epoch interruption
        let mut config = Config::new();
        config.epoch_interruption(true);
        let engine =
            Engine::new(&config).map_err(|e| format!("Failed to create WASM engine: {}", e))?;

        // Spawn epoch ticker (100ms ticks)
        let epoch_engine = engine.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(100));
            epoch_engine.increment_epoch();
        });

        // Load the module
        let module = Module::from_file(&engine, &resource_path)
            .map_err(|e| format!("Failed to load browser.wasm: {}", e))?;

        // Build a synthetic manifest with all capabilities the browser needs
        let manifest = ExtensionManifest {
            extension: ExtensionMeta {
                id: BUILTIN_BROWSER_ID.to_string(),
                name: "Browser".to_string(),
                version: "1.0.0".to_string(),
                description: "Built-in browser".to_string(),
                runtime: "bare".to_string(),
            },
            capabilities: Capabilities {
                render_surface: true,
                browser_control: true,
                notifications: true,
                network: false,
                workspace_read: false,
                workspace_write: false,
                commands: false,
                terminal: false,
            },
            services: vec![],
            commands: vec![CommandDecl {
                id: "launch_browser".to_string(),
                label: "Launch".to_string(),
                kind: "launch".to_string(),
            }],
        };

        // Build event sink (for notifications)
        let event_handle = app_handle.clone();
        let event_sink: Arc<dyn Fn(GatewayEvent) + Send + Sync> = Arc::new(move |event| {
            let _ = tauri::Emitter::emit(&event_handle, "gateway-event", &event);
        });

        // Build measure text sink
        let measure_handle = app_handle.clone();
        let measure_sink: Arc<dyn Fn(MeasureTextRequest) + Send + Sync> = Arc::new(move |req| {
            let _ = tauri::Emitter::emit(&measure_handle, "surface-measure-text", &req);
        });

        // Dummy gateway manager (browser doesn't use gateways)
        let gateway_manager = Arc::new(GatewayManager::new());

        // Construct ExtensionState
        let state = ExtensionState {
            manifest: manifest.clone(),
            gateway_manager,
            workspace_root,
            return_buffer: Vec::new(),
            event_sink,
            surface_manager,
            measure_event_sink: measure_sink,
            app_handle,
            browser_manager,
            browser_id_map: HashMap::new(),
            next_browser_id: 1,
            wasi: None,
            stdout_pipe: None,
        };

        let mut store = Store::new(&engine, state);
        store.set_epoch_deadline(50); // 5 second timeout

        // Link host functions
        let mut linker = Linker::new(&engine);
        link_host_functions(&mut linker, &manifest.capabilities)
            .map_err(|e| format!("Failed to link host functions: {}", e))?;

        // Instantiate
        let instance = linker
            .instantiate(&mut store, &module)
            .map_err(|e| format!("Failed to instantiate browser.wasm: {}", e))?;

        // Call activate
        if let Ok(func) = instance.get_typed_func::<(), i32>(&mut store, "activate") {
            let result = func
                .call(&mut store, ())
                .map_err(|e| format!("activate() failed: {}", e))?;
            if result != 0 {
                return Err(format!("activate() returned error code {}", result));
            }
        }

        Ok(Self {
            store,
            instance,
            engine,
        })
    }

    /// Call an exported command on the browser WASM module.
    /// Uses the same alloc/write/call convention as ExtensionInstance.
    pub fn call_command(&mut self, method: &str, params: &str) -> Result<String, String> {
        // Reset epoch deadline before each call
        self.store.set_epoch_deadline(50);

        let memory = self
            .instance
            .get_memory(&mut self.store, "memory")
            .ok_or("Browser module has no exported memory")?;

        // Allocate space in WASM memory
        let alloc = self
            .instance
            .get_typed_func::<i32, i32>(&mut self.store, "alloc")
            .map_err(|_| "Browser module does not export alloc()")?;

        let param_bytes = params.as_bytes();
        let ptr = alloc
            .call(&mut self.store, param_bytes.len() as i32)
            .map_err(|e| format!("alloc failed: {}", e))?;

        memory
            .write(&mut self.store, ptr as usize, param_bytes)
            .map_err(|e| format!("memory write failed: {}", e))?;

        // Call the method
        let func = self
            .instance
            .get_typed_func::<(i32, i32), i32>(&mut self.store, method)
            .map_err(|_| format!("Browser module does not export {}()", method))?;

        let _result = func
            .call(&mut self.store, (ptr, param_bytes.len() as i32))
            .map_err(|e| format!("{}() failed: {}", method, e))?;

        // Read result from return buffer
        let state = self.store.data();
        Ok(String::from_utf8_lossy(&state.return_buffer).to_string())
    }

    /// Close all browser webviews owned by this module.
    pub fn close_all_browsers(&mut self) {
        let state = self.store.data();
        let browser_ids: Vec<String> = state.browser_id_map.values().cloned().collect();
        let app_handle = state.app_handle.clone();
        let browser_manager = state.browser_manager.clone();
        for bid in &browser_ids {
            let _ = browser_manager.close(&app_handle, bid);
        }
        self.store.data_mut().browser_id_map.clear();
    }

    /// Call deactivate and clean up.
    pub fn deactivate(&mut self) {
        self.store.set_epoch_deadline(50);
        if let Ok(func) = self
            .instance
            .get_typed_func::<(), ()>(&mut self.store, "deactivate")
        {
            let _ = func.call(&mut self.store, ());
        }
        self.close_all_browsers();
    }
}
