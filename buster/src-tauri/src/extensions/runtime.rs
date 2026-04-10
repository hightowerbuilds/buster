use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use wasmtime::*;

use super::gateway::{GatewayEvent, GatewayManager};
use super::manifest::ExtensionManifest;

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

/// Per-extension WASM state held inside the Store.
pub struct ExtensionState {
    pub manifest: ExtensionManifest,
    pub gateway_manager: Arc<GatewayManager>,
    pub workspace_root: Arc<Mutex<Option<String>>>,
    /// Buffer for passing data from host functions back to the caller
    pub return_buffer: Vec<u8>,
    /// Event callback — sends events to the Tauri frontend
    pub event_sink: Arc<dyn Fn(GatewayEvent) + Send + Sync>,
}

/// A loaded extension instance.
pub struct ExtensionInstance {
    pub manifest: ExtensionManifest,
    store: Store<ExtensionState>,
    instance: Instance,
}

impl ExtensionInstance {
    /// Call the extension's activate() export.
    pub fn activate(&mut self) -> Result<(), String> {
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

    /// Call the extension's deactivate() export.
    pub fn deactivate(&mut self) -> Result<(), String> {
        if let Ok(func) = self.instance.get_typed_func::<(), ()>(&mut self.store, "deactivate") {
            func.call(&mut self.store, ())
                .map_err(|e| format!("deactivate() failed: {}", e))?;
        }
        Ok(())
    }

    /// Call an arbitrary exported function by name, passing JSON in/out.
    pub fn call_method(&mut self, method: &str, params: &str) -> Result<String, String> {
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

        // Create store with extension state
        let state = ExtensionState {
            manifest: manifest.clone(),
            gateway_manager: self.gateway_manager.clone(),
            workspace_root,
            return_buffer: Vec::new(),
            event_sink,
        };

        let mut store = Store::new(&self.engine, state);
        // Set execution timeout: 50 epochs * 100ms = 5 seconds for activate/deactivate
        store.set_epoch_deadline(50);

        // Link host functions
        let mut linker = Linker::new(&self.engine);
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
    linker.func_wrap("buster", "notify", |mut caller: Caller<'_, ExtensionState>, title_ptr: i32, title_len: i32, msg_ptr: i32, msg_len: i32| -> i32 {
        if !caller.data().manifest.capabilities.notifications {
            return -1; // Permission denied
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
            return -1;
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
        0
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

        // Defense-in-depth: validate command safety using the shared blocklist
        if crate::ai::tools::is_command_safe(&cmd_str).is_err() {
            let ext_id = &caller.data().manifest.extension.id;
            eprintln!("[ext:{}] Blocked unsafe command: {}", ext_id, cmd_str);
            caller.data_mut().return_buffer = b"Command blocked by safety policy".to_vec();
            return -1;
        }

        // Parse the command string into program + args
        let parts: Vec<&str> = cmd_str.split_whitespace().collect();
        if parts.is_empty() {
            caller.data_mut().return_buffer = b"Error: empty command".to_vec();
            return -1;
        }

        let program = parts[0];
        let args: Vec<String> = parts[1..].iter().map(|s| s.to_string()).collect();

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

    Ok(())
}
