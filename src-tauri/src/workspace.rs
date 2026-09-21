use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Shared workspace root state, managed by Tauri.
pub struct WorkspaceState {
    pub root: Mutex<Option<String>>,
    notes_root: Mutex<Option<String>>,
}

impl WorkspaceState {
    pub fn new() -> Self {
        WorkspaceState { root: Mutex::new(None), notes_root: Mutex::new(None) }
    }

    pub fn get(&self) -> Option<String> {
        self.root.lock().ok()?.clone()
    }

    pub fn set_notes_root(&self, path: String) {
        if let Ok(mut root) = self.notes_root.lock() { *root = Some(path); }
    }

    pub fn is_notes_path(&self, path: &str) -> bool {
        self.notes_root.lock().ok().and_then(|root| root.clone())
            .is_some_and(|root| validate_path(path, &root).is_ok())
    }

    pub fn set(&self, path: Option<String>) {
        if let Ok(mut root) = self.root.lock() {
            *root = path;
        }
    }
}

/// Validate that a path is within the workspace root.
/// Returns the validated path if valid, or an error.
pub fn validate_path(path: &str, workspace: &str) -> Result<PathBuf, String> {
    if workspace.is_empty() {
        return Err("No workspace root set. Open a folder first.".into());
    }

    let workspace_canonical = fs::canonicalize(workspace)
        .map_err(|e| format!("Invalid workspace root: {}", e))?;

    let target = Path::new(path);
    let check_path = if target.exists() {
        fs::canonicalize(target).map_err(|e| format!("Invalid path: {}", e))?
    } else {
        // File doesn't exist yet — check that parent is within workspace
        let parent = target.parent().ok_or("Invalid path: no parent directory")?;
        if !parent.exists() {
            let mut ancestor = target.to_path_buf();
            while !ancestor.exists() {
                ancestor = ancestor.parent()
                    .ok_or("Invalid path: no existing ancestor")?
                    .to_path_buf();
            }
            let existing_ancestor = fs::canonicalize(&ancestor)
                .map_err(|e| format!("Invalid path: {}", e))?;
            if !existing_ancestor.starts_with(&workspace_canonical) {
                return Err(format!("Path is outside workspace: {}", path));
            }
            return Ok(target.to_path_buf());
        }
        let parent_canonical = fs::canonicalize(parent)
            .map_err(|e| format!("Invalid parent path: {}", e))?;
        if !parent_canonical.starts_with(&workspace_canonical) {
            return Err(format!("Path is outside workspace: {}", path));
        }
        return Ok(target.to_path_buf());
    };

    if !check_path.starts_with(&workspace_canonical) {
        return Err(format!("Path is outside workspace: {}", path));
    }

    Ok(check_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn rejects_empty_workspace() {
        assert!(validate_path("/some/file.txt", "").is_err());
    }

    #[test]
    fn accepts_file_inside_workspace() {
        let tmp = env::temp_dir().join("buster_ws_shared_test");
        let _ = fs::create_dir_all(&tmp);
        let file = tmp.join("test.txt");
        fs::write(&file, "hello").unwrap();

        let result = validate_path(file.to_str().unwrap(), tmp.to_str().unwrap());
        assert!(result.is_ok());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn rejects_file_outside_workspace() {
        let tmp = env::temp_dir().join("buster_ws_shared_reject");
        let _ = fs::create_dir_all(&tmp);

        let result = validate_path("/etc/passwd", tmp.to_str().unwrap());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside workspace"));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn workspace_state_set_and_get() {
        let state = WorkspaceState::new();
        assert!(state.get().is_none());
        state.set(Some("/test/path".into()));
        assert_eq!(state.get(), Some("/test/path".into()));
        state.set(None);
        assert!(state.get().is_none());
    }
}
