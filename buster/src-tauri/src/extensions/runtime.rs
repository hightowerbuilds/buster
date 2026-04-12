use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use wasmtime::*;
use wasmtime_wasi::{WasiCtxBuilder, preview1 as wasi_preview1};
use wasmtime_wasi::preview1::WasiP1Ctx;
use wasmtime_wasi::pipe::MemoryOutputPipe;

use super::gateway::{GatewayEvent, GatewayManager};
use super::manifest::ExtensionManifest;
use super::surface::{SurfaceManager, MeasureTextRequest};

use crate::browser::BrowserManager;

// Buster sandbox integration — allowlist-based command execution
use buster_sandbox::{SandboxConfig, ExecutionRequest, ExitStatus, ResourceLimits, execute as sandbox_execute};

/// Read a UTF-8 string from WASM linear memory at the given pointer and length.
fn read_wasm_str(memory: &Memory, caller: &Caller<'_, ExtensionState>, ptr: i32, len: i32) -> Option<String> {
    let mut buf = vec![0u8; len as usize];
    memory.read(caller, ptr as usize, &mut buf).ok()?;
    String::from_utf8(buf).ok()
}

/// Resolve the workspace root from the extension state, returning None if unavailable.
fn resolve_workspace_root(caller: &Caller<'_, ExtensionState>) -> Option<String> {
    caller.data().workspace_root.try_lock().ok()?.clone()
}

/// Validate that `path` is within `workspace_root` after canonicalization.
/// Returns the canonical path on success.
fn validate_within_workspace(path: &str, workspace_root: &str) -> Option<PathBuf> {
    let canonical_path = std::fs::canonicalize(path).ok()?;
    let canonical_root = std::fs::canonicalize(workspace_root).ok()?;
    if !canonical_path.starts_with(&canonical_root) {
        return None;
    }
    Some(canonical_path)
}

/// Validate a write target whose file may not exist yet.
/// Canonicalizes the parent directory and checks containment.
fn validate_write_target(path: &str, workspace_root: &str) -> Option<PathBuf> {
    let target = Path::new(path);
    let parent = target.parent()?;
    let canonical_parent = std::fs::canonicalize(parent).ok()?;
    let canonical_root = std::fs::canonicalize(workspace_root).ok()?;
    let canonical_target = canonical_parent.join(target.file_name().unwrap_or_default());
    if !canonical_target.starts_with(&canonical_root) {
        return None;
    }
    Some(canonical_target)
}

/// Parse a command string with shell-word splitting.
/// Handles double quotes, single quotes, and backslash escapes.
/// e.g. `git commit -m "fix bug"` → ["git", "commit", "-m", "fix bug"]
fn parse_shell_words(input: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut chars = input.chars().peekable();
    let mut in_double = false;
    let mut in_single = false;

    while let Some(ch) = chars.next() {
        match ch {
            '\\' if !in_single => {
                // Backslash escape: take next char literally
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            '"' if !in_single => {
                in_double = !in_double;
            }
            '\'' if !in_double => {
                in_single = !in_single;
            }
            c if c.is_whitespace() && !in_double && !in_single => {
                if !current.is_empty() {
                    words.push(std::mem::take(&mut current));
                }
            }
            _ => {
                current.push(ch);
            }
        }
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

/// Per-extension WASM state held inside the Store.
pub struct ExtensionState {
    pub manifest: ExtensionManifest,
    pub gateway_manager: Arc<GatewayManager>,
    pub workspace_root: Arc<Mutex<Option<String>>>,
    /// Buffer for passing data from host functions back to the caller
    pub return_buffer: Vec<u8>,
    /// Event callback — sends events to the Tauri frontend
    pub event_sink: Arc<dyn Fn(GatewayEvent) + Send + Sync>,
    pub surface_manager: Arc<SurfaceManager>,
    pub measure_event_sink: Arc<dyn Fn(MeasureTextRequest) + Send + Sync>,
    /// Tauri app handle — for browser webview control
    pub app_handle: tauri::AppHandle,
    /// Browser manager — shared with the host for webview lifecycle
    pub browser_manager: Arc<BrowserManager>,
    /// Maps extension-facing i32 browser IDs to BrowserManager string IDs
    pub browser_id_map: HashMap<i32, String>,
    /// Next browser ID counter for this extension
    pub next_browser_id: i32,
    /// WASI context — present only for runtime="wasi" extensions
    pub wasi: Option<WasiP1Ctx>,
    /// Captured stdout pipe — for WASI modules that output display list JSON
    pub stdout_pipe: Option<MemoryOutputPipe>,
}

/// A loaded extension instance.
pub struct ExtensionInstance {
    pub manifest: ExtensionManifest,
    store: Store<ExtensionState>,
    instance: Instance,
}

impl ExtensionInstance {
    /// Whether this extension uses the WASI runtime.
    pub fn is_wasi(&self) -> bool {
        self.manifest.extension.runtime == "wasi"
    }

    /// Close all browser views owned by this extension.
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

    /// Call the extension's activate() export (bare modules),
    /// or _start (WASI modules).
    pub fn activate(&mut self) -> Result<(), String> {
        if self.is_wasi() {
            // WASI modules use _start as entry point
            if let Ok(func) = self.instance.get_typed_func::<(), ()>(&mut self.store, "_start") {
                func.call(&mut self.store, ())
                    .map_err(|e| format!("_start() failed: {}", e))?;
            }
            Ok(())
        } else {
            if let Ok(func) = self.instance.get_typed_func::<(), i32>(&mut self.store, "activate") {
                let result = func
                    .call(&mut self.store, ())
                    .map_err(|e| format!("activate() failed: {}", e))?;
                if result != 0 {
                    return Err(format!("activate() returned error code {}", result));
                }
            }
            Ok(())
        }
    }

    /// Call the extension's deactivate() export.
    pub fn deactivate(&mut self) -> Result<(), String> {
        if self.is_wasi() {
            // WASI modules don't typically have deactivate — no-op
            Ok(())
        } else {
            if let Ok(func) = self.instance.get_typed_func::<(), ()>(&mut self.store, "deactivate") {
                func.call(&mut self.store, ())
                    .map_err(|e| format!("deactivate() failed: {}", e))?;
            }
            Ok(())
        }
    }

    /// Call an arbitrary exported function by name, passing JSON in/out.
    /// For bare modules, uses alloc/memory/set_return convention.
    /// For WASI modules, passes params via stdin and captures stdout.
    pub fn call_method(&mut self, method: &str, params: &str) -> Result<String, String> {
        // Reset epoch deadline before each call so it doesn't expire between calls
        self.store.set_epoch_deadline(50);

        if self.is_wasi() {
            return self.call_wasi_method(method, params);
        }

        let memory = self
            .instance
            .get_memory(&mut self.store, "memory")
            .ok_or("Extension has no exported memory")?;

        // Write params into WASM memory via the extension's alloc()
        let alloc = self
            .instance
            .get_typed_func::<i32, i32>(&mut self.store, "alloc")
            .map_err(|_| "Extension does not export alloc()")?;

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
            .map_err(|_| format!("Extension does not export {}()", method))?;

        let _result_ptr = func
            .call(&mut self.store, (ptr, param_bytes.len() as i32))
            .map_err(|e| format!("{}() failed: {}", method, e))?;

        // Read result from return buffer
        let state = self.store.data();
        Ok(String::from_utf8_lossy(&state.return_buffer).to_string())
    }

    /// Call a WASI module's exported function and capture stdout.
    fn call_wasi_method(&mut self, method: &str, _params: &str) -> Result<String, String> {
        // Try to call the named export directly
        if let Ok(func) = self.instance.get_typed_func::<(), ()>(&mut self.store, method) {
            func.call(&mut self.store, ())
                .map_err(|e| format!("{}() failed: {}", method, e))?;
        } else {
            return Err(format!("WASI extension does not export {}()", method));
        }

        // Read captured stdout
        self.read_stdout()
    }

    /// Read captured stdout from the WASI pipe.
    pub fn read_stdout(&self) -> Result<String, String> {
        match &self.store.data().stdout_pipe {
            Some(pipe) => {
                let bytes = pipe.contents();
                Ok(String::from_utf8_lossy(&bytes).to_string())
            }
            None => Ok(String::new()),
        }
    }
}

/// The WASM runtime engine — shared across all extensions.
pub struct WasmRuntime {
    engine: Engine,
    gateway_manager: Arc<GatewayManager>,
}

impl WasmRuntime {
    pub fn new(gateway_manager: Arc<GatewayManager>) -> Result<Self, String> {
        let mut config = Config::new();
        config.epoch_interruption(true);
        let engine = Engine::new(&config).map_err(|e| format!("Failed to create WASM engine: {}", e))?;

        // Spawn epoch ticker thread — increments every 100ms for timeout enforcement
        let epoch_engine = engine.clone();
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(std::time::Duration::from_millis(100));
                epoch_engine.increment_epoch();
            }
        });

        Ok(Self {
            engine,
            gateway_manager,
        })
    }

    /// Load a WASM extension from a directory containing extension.toml and extension.wasm.
    pub fn load_extension(
        &self,
        extension_dir: &Path,
        workspace_root: Arc<Mutex<Option<String>>>,
        event_sink: Arc<dyn Fn(GatewayEvent) + Send + Sync>,
        surface_manager: Arc<SurfaceManager>,
        measure_event_sink: Arc<dyn Fn(MeasureTextRequest) + Send + Sync>,
        app_handle: tauri::AppHandle,
        browser_manager: Arc<BrowserManager>,
    ) -> Result<ExtensionInstance, String> {
        // Parse manifest
        let manifest_path = extension_dir.join("extension.toml");
        let manifest_str = std::fs::read_to_string(&manifest_path)
            .map_err(|e| format!("Failed to read extension.toml: {}", e))?;
        let manifest: ExtensionManifest = toml::from_str(&manifest_str)
            .map_err(|e| format!("Invalid extension.toml: {}", e))?;

        // Load WASM module
        let wasm_path = extension_dir.join("extension.wasm");
        let module = Module::from_file(&self.engine, &wasm_path)
            .map_err(|e| format!("Failed to load extension.wasm: {}", e))?;

        let is_wasi = manifest.extension.runtime == "wasi";

        // Build WASI context and stdout pipe if needed
        let (wasi_ctx, stdout_pipe) = if is_wasi {
            let pipe = MemoryOutputPipe::new(64 * 1024); // 64KB stdout buffer
            let ctx = WasiCtxBuilder::new()
                .stdout(pipe.clone())
                .inherit_stderr()
                .args(&[&manifest.extension.id])
                .build_p1();
            (Some(ctx), Some(pipe))
        } else {
            (None, None)
        };

        // Create store with extension state
        let state = ExtensionState {
            manifest: manifest.clone(),
            gateway_manager: self.gateway_manager.clone(),
            workspace_root,
            return_buffer: Vec::new(),
            event_sink,
            surface_manager,
            measure_event_sink,
            app_handle,
            browser_manager,
            browser_id_map: HashMap::new(),
            next_browser_id: 1,
            wasi: wasi_ctx,
            stdout_pipe,
        };

        let mut store = Store::new(&self.engine, state);
        // Set execution timeout: 50 epochs * 100ms = 5 seconds for activate/deactivate
        store.set_epoch_deadline(50);

        // Link host functions
        let mut linker = Linker::new(&self.engine);

        // For WASI modules, link WASI imports first
        if is_wasi {
            wasi_preview1::add_to_linker_sync(&mut linker, |state: &mut ExtensionState| {
                state.wasi.as_mut().expect("WASI context missing for WASI extension")
            }).map_err(|e| format!("Failed to link WASI functions: {}", e))?;
        }

        // Link buster host functions (available to both bare and WASI modules)
        link_host_functions(&mut linker, &manifest.capabilities)
            .map_err(|e| format!("Failed to link host functions: {}", e))?;

        // Instantiate
        let instance = linker
            .instantiate(&mut store, &module)
            .map_err(|e| format!("Failed to instantiate extension: {}", e))?;

        Ok(ExtensionInstance {
            manifest,
            store,
            instance,
        })
    }
}

/// Link host functions into the WASM linker.
/// Only capabilities the extension declared get real implementations;
/// undeclared capabilities get stubs that return errors.
fn link_host_functions(linker: &mut Linker<ExtensionState>, _caps: &super::manifest::Capabilities) -> Result<()> {
    // --- Logging (always available) ---
    linker.func_wrap("buster", "log", |mut caller: Caller<'_, ExtensionState>, level: i32, ptr: i32, len: i32| {
        if let Some(memory) = caller.get_export("memory").and_then(|e| e.into_memory()) {
            let mut buf = vec![0u8; len as usize];
            if memory.read(&caller, ptr as usize, &mut buf).is_ok() {
                let msg = String::from_utf8_lossy(&buf);
                let ext_id = &caller.data().manifest.extension.id;
                let level_str = match level {
                    0 => "DEBUG",
                    1 => "INFO",
                    2 => "WARN",
                    3 => "ERROR",
                    _ => "LOG",
                };
                println!("[ext:{}] {} {}", ext_id, level_str, msg);
            }
        }
    })?;

    // --- Notify (requires notifications capability) ---
    linker.func_wrap("buster", "notify", |mut caller: Caller<'_, ExtensionState>, title_ptr: i32, title_len: i32, msg_ptr: i32, msg_len: i32| {
        if !caller.data().manifest.capabilities.notifications {
            return; // Permission denied
        }
        let (title, body) = if let Some(memory) = caller.get_export("memory").and_then(|e| e.into_memory()) {
            let mut tbuf = vec![0u8; title_len as usize];
            let mut mbuf = vec![0u8; msg_len as usize];
            let t = if memory.read(&caller, title_ptr as usize, &mut tbuf).is_ok() {
                String::from_utf8_lossy(&tbuf).to_string()
            } else { "".into() };
            let m = if memory.read(&caller, msg_ptr as usize, &mut mbuf).is_ok() {
                String::from_utf8_lossy(&mbuf).to_string()
            } else { "".into() };
            (t, m)
        } else {
            return;
        };
        let ext_id = caller.data().manifest.extension.id.clone();
        let event = GatewayEvent {
            connection_id: 0,
            extension_id: ext_id,
            kind: "notification".to_string(),
            content: serde_json::json!({"title": title, "body": body}).to_string(),
            tool_name: None,
        };
        (caller.data().event_sink)(event);
    })?;

    // --- Set return buffer (internal mechanism for returning data to host) ---
    linker.func_wrap("buster", "set_return", |mut caller: Caller<'_, ExtensionState>, ptr: i32, len: i32| {
        if let Some(memory) = caller.get_export("memory").and_then(|e| e.into_memory()) {
            let mut buf = vec![0u8; len as usize];
            if memory.read(&caller, ptr as usize, &mut buf).is_ok() {
                caller.data_mut().return_buffer = buf;
            }
        }
    })?;

    // --- Workspace: read file (requires workspace_read capability) ---
    linker.func_wrap("buster", "host_read_file", |mut caller: Caller<'_, ExtensionState>, path_ptr: i32, path_len: i32| -> i32 {
        if !caller.data().manifest.capabilities.workspace_read {
            return -1;
        }
        let memory = match caller.get_export("memory").and_then(|e| e.into_memory()) {
            Some(m) => m,
            None => return -1,
        };
        let path_str = match read_wasm_str(&memory, &caller, path_ptr, path_len) {
            Some(s) => s,
            None => return -1,
        };
        let ws_root = match resolve_workspace_root(&caller) {
            Some(r) => r,
            None => return -1,
        };
        let canonical_path = match validate_within_workspace(&path_str, &ws_root) {
            Some(p) => p,
            None => return -1,
        };
        match std::fs::read_to_string(&canonical_path) {
            Ok(content) => {
                caller.data_mut().return_buffer = content.into_bytes();
                0
            }
            Err(_) => -1,
        }
    })?;

    // --- Workspace: write file (requires workspace_write capability) ---
    linker.func_wrap("buster", "host_write_file", |mut caller: Caller<'_, ExtensionState>, path_ptr: i32, path_len: i32, content_ptr: i32, content_len: i32| -> i32 {
        if !caller.data().manifest.capabilities.workspace_write {
            return -1;
        }
        let memory = match caller.get_export("memory").and_then(|e| e.into_memory()) {
            Some(m) => m,
            None => return -1,
        };
        let path_str = match read_wasm_str(&memory, &caller, path_ptr, path_len) {
            Some(s) => s,
            None => return -1,
        };
        let content_str = match read_wasm_str(&memory, &caller, content_ptr, content_len) {
            Some(s) => s,
            None => return -1,
        };
        let ws_root = match resolve_workspace_root(&caller) {
            Some(r) => r,
            None => return -1,
        };
        // File may not exist yet, so validate via parent directory
        let canonical_target = match validate_write_target(&path_str, &ws_root) {
            Some(p) => p,
            None => return -1,
        };
        match std::fs::write(&canonical_target, &content_str) {
            Ok(()) => 0,
            Err(_) => -1,
        }
    })?;

    // --- Workspace: list directory (requires workspace_read capability) ---
    linker.func_wrap("buster", "host_list_directory", |mut caller: Caller<'_, ExtensionState>, path_ptr: i32, path_len: i32| -> i32 {
        if !caller.data().manifest.capabilities.workspace_read {
            return -1;
        }
        let memory = match caller.get_export("memory").and_then(|e| e.into_memory()) {
            Some(m) => m,
            None => return -1,
        };
        let path_str = match read_wasm_str(&memory, &caller, path_ptr, path_len) {
            Some(s) => s,
            None => return -1,
        };
        let ws_root = match resolve_workspace_root(&caller) {
            Some(r) => r,
            None => return -1,
        };
        let canonical_path = match validate_within_workspace(&path_str, &ws_root) {
            Some(p) => p,
            None => return -1,
        };
        let entries = match std::fs::read_dir(&canonical_path) {
            Ok(rd) => rd,
            Err(_) => return -1,
        };
        let result: Vec<serde_json::Value> = entries
            .filter_map(|e| e.ok())
            .map(|entry| {
                serde_json::json!({
                    "name": entry.file_name().to_string_lossy(),
                    "is_dir": entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false),
                })
            })
            .collect();
        match serde_json::to_string(&result) {
            Ok(json) => {
                caller.data_mut().return_buffer = json.into_bytes();
                0
            }
            Err(_) => -1,
        }
    })?;

    // --- Run command (requires commands capability) ---
    // Uses the same safety blocklist as the AI agent (crate::ai::tools::is_command_safe).
    linker.func_wrap("buster", "host_run_command", |mut caller: Caller<'_, ExtensionState>, cmd_ptr: i32, cmd_len: i32| -> i32 {
        if !caller.data().manifest.capabilities.commands {
            return -1;
        }
        let memory = match caller.get_export("memory").and_then(|e| e.into_memory()) {
            Some(m) => m,
            None => return -1,
        };
        let cmd_str = match read_wasm_str(&memory, &caller, cmd_ptr, cmd_len) {
            Some(s) => s,
            None => return -1,
        };
        let ws_root = match resolve_workspace_root(&caller) {
            Some(r) => r,
            None => return -1,
        };

        // Parse the command string with shell-word splitting
        // (handles double quotes, single quotes, backslash escapes)
        let parts = parse_shell_words(&cmd_str);
        if parts.is_empty() {
            caller.data_mut().return_buffer = b"Error: empty command".to_vec();
            return -1;
        }

        let program = parts[0].as_str();
        let args: Vec<String> = parts[1..].to_vec();

        // Build sandbox config and execution request
        let config = SandboxConfig::new(&ws_root);
        let request = ExecutionRequest {
            program: program.to_string(),
            args,
            working_dir: PathBuf::from(&ws_root),
            env: std::collections::HashMap::new(),
            stdin: None,
            capabilities: vec![],
            limits: ResourceLimits::default(),
        };

        // Execute through the sandbox
        match sandbox_execute(&config, &request) {
            Ok(result) => {
                match result.status {
                    ExitStatus::Denied => {
                        let reason = String::from_utf8_lossy(&result.stderr);
                        let json = serde_json::json!({
                            "status": -1,
                            "stdout": "",
                            "stderr": format!("Blocked by sandbox: {}", reason),
                            "error": true,
                        });
                        caller.data_mut().return_buffer = json.to_string().into_bytes();
                        -1
                    }
                    ExitStatus::Timeout => {
                        let json = serde_json::json!({
                            "status": -1,
                            "stdout": "",
                            "stderr": "Error: command timed out",
                            "error": true,
                        });
                        caller.data_mut().return_buffer = json.to_string().into_bytes();
                        -1
                    }
                    ExitStatus::ResourceLimit => {
                        let json = serde_json::json!({
                            "status": -1,
                            "stdout": "",
                            "stderr": "Error: command exceeded resource limits",
                            "error": true,
                        });
                        caller.data_mut().return_buffer = json.to_string().into_bytes();
                        -1
                    }
                    ExitStatus::Code(code) => {
                        let stdout = String::from_utf8_lossy(&result.stdout);
                        let stderr = String::from_utf8_lossy(&result.stderr);
                        let success = code == 0;
                        let json = if success {
                            serde_json::json!({
                                "status": code,
                                "stdout": stdout,
                                "stderr": stderr,
                            })
                        } else {
                            serde_json::json!({
                                "status": code,
                                "stdout": stdout,
                                "stderr": stderr,
                                "error": true,
                            })
                        };
                        caller.data_mut().return_buffer = json.to_string().into_bytes();
                        if success { 0 } else { 1 }
                    }
                }
            }
            Err(e) => {
                caller.data_mut().return_buffer = format!("Sandbox error: {}", e).into_bytes();
                -1
            }
        }
    })?;

    // ── Surface Painting ──────────────────────────────────────────

    linker.func_wrap("buster", "host_request_surface", |mut caller: Caller<'_, ExtensionState>, width: i32, height: i32, label_ptr: i32, label_len: i32| -> i32 {
        if !caller.data().manifest.capabilities.render_surface {
            return -1;
        }
        let memory = match caller.get_export("memory").and_then(|e| e.into_memory()) {
            Some(m) => m,
            None => return -1,
        };
        let label = read_wasm_str(&memory, &caller, label_ptr, label_len).unwrap_or_default();
        let ext_id = caller.data().manifest.extension.id.clone();
        let sm = caller.data().surface_manager.clone();
        sm.request_surface(&ext_id, width as u32, height as u32, &label) as i32
    })?;

    linker.func_wrap("buster", "host_paint", |mut caller: Caller<'_, ExtensionState>, surface_id: i32, json_ptr: i32, json_len: i32| -> i32 {
        if !caller.data().manifest.capabilities.render_surface {
            return -1;
        }
        let memory = match caller.get_export("memory").and_then(|e| e.into_memory()) {
            Some(m) => m,
            None => return -1,
        };
        let json = match read_wasm_str(&memory, &caller, json_ptr, json_len) {
            Some(s) => s,
            None => return -1,
        };
        let sm = caller.data().surface_manager.clone();
        match sm.paint(surface_id as u32, &json) {
            Ok(()) => 0,
            Err(_) => -1,
        }
    })?;

    linker.func_wrap("buster", "host_resize_surface", |caller: Caller<'_, ExtensionState>, surface_id: i32, width: i32, height: i32| -> i32 {
        if !caller.data().manifest.capabilities.render_surface {
            return -1;
        }
        let sm = caller.data().surface_manager.clone();
        match sm.resize_surface(surface_id as u32, width as u32, height as u32) {
            Ok(()) => 0,
            Err(_) => -1,
        }
    })?;

    linker.func_wrap("buster", "host_release_surface", |caller: Caller<'_, ExtensionState>, surface_id: i32| -> i32 {
        if !caller.data().manifest.capabilities.render_surface {
            return -1;
        }
        let sm = caller.data().surface_manager.clone();
        match sm.release_surface(surface_id as u32) {
            Ok(()) => 0,
            Err(_) => -1,
        }
    })?;

    linker.func_wrap("buster", "host_measure_text", |mut caller: Caller<'_, ExtensionState>, text_ptr: i32, text_len: i32, font_ptr: i32, font_len: i32| -> i32 {
        if !caller.data().manifest.capabilities.render_surface {
            return -1;
        }
        let memory = match caller.get_export("memory").and_then(|e| e.into_memory()) {
            Some(m) => m,
            None => return -1,
        };
        let text = match read_wasm_str(&memory, &caller, text_ptr, text_len) {
            Some(s) => s,
            None => return -1,
        };
        let font = match read_wasm_str(&memory, &caller, font_ptr, font_len) {
            Some(s) => s,
            None => return -1,
        };

        let sm = caller.data().surface_manager.clone();
        let (_request_id, rx) = sm.request_measure(&text, &font);

        // Block waiting for the frontend to respond (with 5s timeout)
        match rx.recv_timeout(std::time::Duration::from_secs(5)) {
            Ok(metrics) => {
                let json = serde_json::json!({
                    "width": metrics.width,
                    "height": metrics.height,
                    "ascent": metrics.ascent,
                    "descent": metrics.descent,
                });
                caller.data_mut().return_buffer = json.to_string().into_bytes();
                0
            }
            Err(_) => -1,
        }
    })?;

    // ── Browser Webview Control ────────────────────────────────────

    linker.func_wrap("buster", "host_create_browser", |mut caller: Caller<'_, ExtensionState>, url_ptr: i32, url_len: i32, x: f64, y: f64, width: f64, height: f64| -> i32 {
        if !caller.data().manifest.capabilities.browser_control {
            return -1;
        }
        let memory = match caller.get_export("memory").and_then(|e| e.into_memory()) {
            Some(m) => m,
            None => return -1,
        };
        let url = match read_wasm_str(&memory, &caller, url_ptr, url_len) {
            Some(s) => s,
            None => return -1,
        };
        let app_handle = caller.data().app_handle.clone();
        let bm = caller.data().browser_manager.clone();
        match bm.create(&app_handle, &url, x, y, width, height) {
            Ok(string_id) => {
                let state = caller.data_mut();
                let ext_id = state.next_browser_id;
                state.next_browser_id += 1;
                state.browser_id_map.insert(ext_id, string_id);
                ext_id
            }
            Err(e) => {
                let ext_id = caller.data().manifest.extension.id.clone();
                eprintln!("[ext:{}] host_create_browser failed: {}", ext_id, e);
                -1
            }
        }
    })?;

    linker.func_wrap("buster", "host_navigate_browser", |mut caller: Caller<'_, ExtensionState>, browser_id: i32, url_ptr: i32, url_len: i32| -> i32 {
        if !caller.data().manifest.capabilities.browser_control {
            return -1;
        }
        let memory = match caller.get_export("memory").and_then(|e| e.into_memory()) {
            Some(m) => m,
            None => return -1,
        };
        let url = match read_wasm_str(&memory, &caller, url_ptr, url_len) {
            Some(s) => s,
            None => return -1,
        };
        let string_id = match caller.data().browser_id_map.get(&browser_id) {
            Some(s) => s.clone(),
            None => return -1,
        };
        let app_handle = caller.data().app_handle.clone();
        let bm = caller.data().browser_manager.clone();
        match bm.navigate(&app_handle, &string_id, &url) {
            Ok(()) => 0,
            Err(_) => -1,
        }
    })?;

    linker.func_wrap("buster", "host_resize_browser", |caller: Caller<'_, ExtensionState>, browser_id: i32, x: f64, y: f64, width: f64, height: f64| -> i32 {
        if !caller.data().manifest.capabilities.browser_control {
            return -1;
        }
        let string_id = match caller.data().browser_id_map.get(&browser_id) {
            Some(s) => s.clone(),
            None => return -1,
        };
        let app_handle = caller.data().app_handle.clone();
        let bm = caller.data().browser_manager.clone();
        match bm.resize(&app_handle, &string_id, x, y, width, height) {
            Ok(()) => 0,
            Err(_) => -1,
        }
    })?;

    linker.func_wrap("buster", "host_show_browser", |caller: Caller<'_, ExtensionState>, browser_id: i32| -> i32 {
        if !caller.data().manifest.capabilities.browser_control {
            return -1;
        }
        let string_id = match caller.data().browser_id_map.get(&browser_id) {
            Some(s) => s.clone(),
            None => return -1,
        };
        let app_handle = caller.data().app_handle.clone();
        let bm = caller.data().browser_manager.clone();
        match bm.show(&app_handle, &string_id) {
            Ok(()) => 0,
            Err(_) => -1,
        }
    })?;

    linker.func_wrap("buster", "host_hide_browser", |caller: Caller<'_, ExtensionState>, browser_id: i32| -> i32 {
        if !caller.data().manifest.capabilities.browser_control {
            return -1;
        }
        let string_id = match caller.data().browser_id_map.get(&browser_id) {
            Some(s) => s.clone(),
            None => return -1,
        };
        let app_handle = caller.data().app_handle.clone();
        let bm = caller.data().browser_manager.clone();
        match bm.hide(&app_handle, &string_id) {
            Ok(()) => 0,
            Err(_) => -1,
        }
    })?;

    linker.func_wrap("buster", "host_close_browser", |mut caller: Caller<'_, ExtensionState>, browser_id: i32| -> i32 {
        if !caller.data().manifest.capabilities.browser_control {
            return -1;
        }
        let string_id = match caller.data().browser_id_map.get(&browser_id) {
            Some(s) => s.clone(),
            None => return -1,
        };
        let app_handle = caller.data().app_handle.clone();
        let bm = caller.data().browser_manager.clone();
        let result = match bm.close(&app_handle, &string_id) {
            Ok(()) => 0,
            Err(_) => -1,
        };
        caller.data_mut().browser_id_map.remove(&browser_id);
        result
    })?;

    linker.func_wrap("buster", "host_eval_browser", |mut caller: Caller<'_, ExtensionState>, browser_id: i32, js_ptr: i32, js_len: i32| -> i32 {
        if !caller.data().manifest.capabilities.browser_control {
            return -1;
        }
        let memory = match caller.get_export("memory").and_then(|e| e.into_memory()) {
            Some(m) => m,
            None => return -1,
        };
        let js_code = match read_wasm_str(&memory, &caller, js_ptr, js_len) {
            Some(s) => s,
            None => return -1,
        };
        let string_id = match caller.data().browser_id_map.get(&browser_id) {
            Some(s) => s.clone(),
            None => return -1,
        };
        let app_handle = caller.data().app_handle.clone();
        // Get the webview and evaluate JS
        use tauri::Manager;
        let webview = match app_handle.get_webview(&string_id) {
            Some(wv) => wv,
            None => return -1,
        };
        // evaluate_script is fire-and-forget in Tauri v2 — use eval() which is synchronous
        match webview.eval(&js_code) {
            Ok(()) => {
                // eval() doesn't return a value — for result capture, extensions
                // should use a callback pattern (e.g., store result in window.__buster_devtools
                // and poll with a second eval)
                0
            }
            Err(e) => {
                let ext_id = caller.data().manifest.extension.id.clone();
                eprintln!("[ext:{}] host_eval_browser failed: {}", ext_id, e);
                -1
            }
        }
    })?;

    Ok(())
}
