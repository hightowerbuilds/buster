//! Safe wrappers around the WASM host function imports.
//!
//! These functions are provided by Buster's WasmRuntime when the extension
//! is loaded. In a WASM build, they link to the actual host functions.
//! In a native test build, they use mock implementations.

/// Read a file relative to the workspace root.
///
/// Returns the file contents as a string, or an error message.
///
/// # Example
/// ```ignore
/// let content = buster_ext_sdk::read_file("src/main.rs")?;
/// ```
pub fn read_file(path: &str) -> Result<String, String> {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { _host_read_file(path) }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        // Mock implementation for testing
        std::fs::read_to_string(path).map_err(|e| e.to_string())
    }
}

/// Write content to a file relative to the workspace root.
///
/// Requires write capability in the extension manifest.
pub fn write_file(path: &str, content: &str) -> Result<(), String> {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { _host_write_file(path, content) }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::fs::write(path, content).map_err(|e| e.to_string())
    }
}

/// List files and directories at a path relative to the workspace root.
pub fn list_directory(path: &str) -> Result<Vec<String>, String> {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { _host_list_directory(path) }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let entries = std::fs::read_dir(path).map_err(|e| e.to_string())?;
        let mut names = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            if let Some(name) = entry.file_name().to_str() {
                names.push(name.to_string());
            }
        }
        Ok(names)
    }
}

/// Run a command in the sandbox.
///
/// The command must be on the sandbox allowlist. Returns (stdout, stderr, exit_code).
pub fn run_command(cmd: &str, args: &[&str]) -> Result<(String, String, i32), String> {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { _host_run_command(cmd, args) }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let output = std::process::Command::new(cmd)
            .args(args)
            .output()
            .map_err(|e| e.to_string())?;
        Ok((
            String::from_utf8_lossy(&output.stdout).to_string(),
            String::from_utf8_lossy(&output.stderr).to_string(),
            output.status.code().unwrap_or(-1),
        ))
    }
}

/// Log a message at the given level.
fn log_impl(level: &str, message: &str) {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { _host_log(level, message) }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        eprintln!("[{}] {}", level, message);
    }
}

pub fn log_debug(message: &str) { log_impl("debug", message); }
pub fn log_info(message: &str) { log_impl("info", message); }
pub fn log_warn(message: &str) { log_impl("warn", message); }
pub fn log_error(message: &str) { log_impl("error", message); }

/// Show a notification to the user.
pub fn notify(title: &str, message: &str) {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { _host_notify(title, message) }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        eprintln!("[NOTIFY] {}: {}", title, message);
    }
}

/// Set the return value for this extension call.
///
/// The value is serialized to JSON and returned to the caller.
pub fn set_return(value: &serde_json::Value) {
    let json = serde_json::to_string(value).unwrap_or_default();
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { _host_set_return(&json) }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        println!("{}", json);
    }
}

// WASM host function imports — these are linked by the Buster runtime.
#[cfg(target_arch = "wasm32")]
extern "C" {
    fn _host_read_file(path: &str) -> Result<String, String>;
    fn _host_write_file(path: &str, content: &str) -> Result<(), String>;
    fn _host_list_directory(path: &str) -> Result<Vec<String>, String>;
    fn _host_run_command(cmd: &str, args: &[&str]) -> Result<(String, String, i32), String>;
    fn _host_log(level: &str, message: &str);
    fn _host_notify(title: &str, message: &str);
    fn _host_set_return(json: &str);
}
