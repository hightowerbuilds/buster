use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::io::Write;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{command, AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTab {
    pub id: String,
    #[serde(rename = "type")]
    pub tab_type: String,
    pub name: String,
    pub path: String,
    pub dirty: bool,
    pub cursor_line: u32,
    pub cursor_col: u32,
    pub scroll_top: f64,
    pub backup_key: Option<String>,
    #[serde(default)]
    pub selection: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub version: u32,
    pub workspace_root: Option<String>,
    pub active_tab_id: Option<String>,
    pub layout_mode: String,
    #[serde(default)]
    pub pane_workspace: Option<serde_json::Value>,
    pub sidebar_visible: bool,
    pub sidebar_width: u32,
    pub tabs: Vec<SessionTab>,
    pub timestamp: String,
}

fn session_dir(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."));
    dir.join("session")
}

fn session_path(app: &AppHandle) -> PathBuf {
    session_dir(app).join("session.json")
}

fn backups_dir(app: &AppHandle) -> PathBuf {
    session_dir(app).join("backups")
}

/// Legacy backup keys remain readable; new backups include content in their identity.
#[cfg(test)]
fn hash_path(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn backup_key(identity: &str, content: &str) -> String {
    let mut hasher = DefaultHasher::new();
    (identity, content).hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn validate_backup_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid backup key".into());
    }
    Ok(())
}

/// Replace only after the new bytes are fully written. A failed write leaves the old file intact.
fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    static NEXT_WRITE: AtomicU64 = AtomicU64::new(0);
    let temporary = path.with_extension(format!("{}.{}.tmp", std::process::id(), NEXT_WRITE.fetch_add(1, Ordering::Relaxed)));
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary)
        .map_err(|e| format!("Failed to create recovery file: {e}"))?;
    let result = (|| -> std::io::Result<()> {
        file.write_all(content)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result.map_err(|e| format!("Failed to save recovery file: {e}"))
}

fn parse_session(content: &str) -> Result<SessionState, String> {
    let session: SessionState = serde_json::from_str(content)
        .map_err(|e| format!("Cannot read saved session; original data preserved: {e}"))?;
    if session.version != 1 { return Err("Unsupported session version; original data preserved".into()); }
    Ok(session)
}

#[command]
pub fn save_session(app: AppHandle, session: SessionState) -> Result<(), String> {
    let dir = session_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create session dir: {}", e))?;

    let path = session_path(&app);
    let json = serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?;
    atomic_write(&path, json.as_bytes())?;
    Ok(())
}

#[command]
pub fn load_session(app: AppHandle) -> Result<Option<SessionState>, String> {
    let path = session_path(&app);
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read session: {}", e))?;
    parse_session(&content).map(Some)
}

#[command]
pub fn save_backup_buffer(app: AppHandle, file_path: String, content: String) -> Result<String, String> {
    let dir = backups_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create backups dir: {}", e))?;

    let key = backup_key(&file_path, &content);
    let buf_path = dir.join(format!("{}.buf", key));
    atomic_write(&buf_path, content.as_bytes())?;
    Ok(key)
}

#[command]
pub fn load_backup_buffer(app: AppHandle, backup_key: String) -> Result<Option<String>, String> {
    validate_backup_key(&backup_key)?;
    let buf_path = backups_dir(&app).join(format!("{}.buf", backup_key));
    if !buf_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&buf_path).map_err(|e| format!("Failed to read backup: {}", e))?;
    Ok(Some(content))
}

#[command]
pub fn delete_backup_buffer(app: AppHandle, backup_key: String) -> Result<(), String> {
    validate_backup_key(&backup_key)?;
    let buf_path = backups_dir(&app).join(format!("{}.buf", backup_key));
    if buf_path.exists() {
        fs::remove_file(&buf_path).map_err(|e| format!("Failed to delete backup: {}", e))?;
    }
    Ok(())
}

#[command]
pub fn clear_session(app: AppHandle) -> Result<(), String> {
    let dir = session_dir(&app);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Failed to clear session: {}", e))?;
    }
    Ok(())
}

#[command]
pub fn confirm_app_close(window: tauri::Window) -> Result<(), String> {
    // Clear crash flag on clean shutdown
    let dir = window.app_handle().path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."));
    let flag = dir.join("session").join(".running");
    let _ = fs::remove_file(flag);
    window.destroy().map_err(|e| format!("Failed to close window: {}", e))?;
    Ok(())
}

/// Set the "running" flag on startup. If this flag exists on next launch, the app crashed.
#[command]
pub fn set_running_flag(app: AppHandle) -> Result<bool, String> {
    let dir = session_dir(&app);
    let _ = fs::create_dir_all(&dir);
    let flag = dir.join(".running");
    let was_dirty = flag.exists();
    fs::write(&flag, "1").map_err(|e| e.to_string())?;
    Ok(was_dirty)
}

/// Clear the running flag (called on clean shutdown).
#[command]
pub fn clear_running_flag(app: AppHandle) -> Result<(), String> {
    let flag = session_dir(&app).join(".running");
    let _ = fs::remove_file(flag);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;


    #[test]
    fn hash_path_produces_consistent_keys() {
        let a = hash_path("/Users/luke/project/src/main.rs");
        let b = hash_path("/Users/luke/project/src/main.rs");
        assert_eq!(a, b);
        assert_eq!(a.len(), 16); // hex format
    }

    #[test]
    fn hash_path_differs_for_different_paths() {
        let a = hash_path("/a/b.txt");
        let b = hash_path("/a/c.txt");
        assert_ne!(a, b);
    }

    #[test]
    fn session_state_roundtrip_serialization() {
        let session = SessionState {
            version: 1,
            workspace_root: Some("/Users/luke/project".into()),
            active_tab_id: Some("file_1".into()),
            layout_mode: "tabs".into(),
            pane_workspace: None,
            sidebar_visible: true,
            sidebar_width: 240,
            tabs: vec![
                SessionTab {
                    id: "file_1".into(),
                    tab_type: "file".into(),
                    name: "main.rs".into(),
                    path: "/Users/luke/project/src/main.rs".into(),
                    dirty: true,
                    cursor_line: 42,
                    cursor_col: 8,
                    scroll_top: 320.0,
                    selection: None,
                    backup_key: Some("abc123".into()),
                },
                SessionTab {
                    id: "term_1".into(),
                    tab_type: "terminal".into(),
                    name: "Terminal 1".into(),
                    path: "".into(),
                    dirty: false,
                    cursor_line: 0,
                    cursor_col: 0,
                    scroll_top: 0.0,
                    selection: None,
                    backup_key: None,
                },
            ],
            timestamp: "2026-04-07T14:30:00Z".into(),
        };

        let json = serde_json::to_string_pretty(&session).unwrap();
        let restored: SessionState = serde_json::from_str(&json).unwrap();

        assert_eq!(restored.version, 1);
        assert_eq!(restored.workspace_root, Some("/Users/luke/project".into()));
        assert_eq!(restored.tabs.len(), 2);
        assert_eq!(restored.tabs[0].tab_type, "file");
        assert_eq!(restored.tabs[0].dirty, true);
        assert_eq!(restored.tabs[0].cursor_line, 42);
        assert_eq!(restored.tabs[1].tab_type, "terminal");
    }

    #[test]
    fn session_state_handles_corrupt_json() {
        let result: Result<SessionState, _> = serde_json::from_str("not json at all");
        assert!(result.is_err());
    }

    #[test]
    fn backup_buffer_roundtrip_via_filesystem() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        let backups = dir.join("backups");
        fs::create_dir_all(&backups).unwrap();

        let key = hash_path("/test/file.rs");
        let buf_path = backups.join(format!("{}.buf", key));

        // Write
        let content = "fn main() {\n    println!(\"hello\");\n}\n";
        fs::write(&buf_path, content).unwrap();

        // Read back
        let restored = fs::read_to_string(&buf_path).unwrap();
        assert_eq!(restored, content);

        // Delete
        fs::remove_file(&buf_path).unwrap();
        assert!(!buf_path.exists());


    }

    #[test]
    fn session_json_roundtrip_via_filesystem() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        fs::create_dir_all(&dir).unwrap();

        let session = SessionState {
            version: 1,
            workspace_root: None,
            active_tab_id: None,
            layout_mode: "tabs".into(),
            pane_workspace: None,
            sidebar_visible: true,
            sidebar_width: 240,
            tabs: vec![],
            timestamp: "2026-04-07T00:00:00Z".into(),
        };

        let path = dir.join("session.json");
        let json = serde_json::to_string_pretty(&session).unwrap();
        fs::write(&path, &json).unwrap();

        let content = fs::read_to_string(&path).unwrap();
        let restored: SessionState = serde_json::from_str(&content).unwrap();
        assert_eq!(restored.version, 1);
        assert_eq!(restored.tabs.len(), 0);


    }
    #[test]
    fn backups_distinguish_drafts_and_revisions() {
        assert_ne!(backup_key("untitled:file_1", "draft"), backup_key("untitled:file_2", "draft"));
        assert_ne!(backup_key("/draft.md", "before"), backup_key("/draft.md", "after"));
        assert_eq!(backup_key("/draft.md", "same"), backup_key("/draft.md", "same"));
    }

    #[test]
    fn rejects_unsafe_backup_paths() {
        for key in ["", "../session", "/tmp/backup", "ab/cd", "nope"] {
            assert!(validate_backup_key(key).is_err());
        }
        assert!(validate_backup_key("01abcdefABCDEF").is_ok());
    }

    #[test]
    fn atomic_replace_preserves_previous_revision_backup() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("session.json");
        atomic_write(&path, b"before").unwrap();
        atomic_write(&path, b"after").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "after");
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
        let old_backup = temp.path().join(backup_key("draft", "old"));
        atomic_write(&old_backup, b"old").unwrap();
        atomic_write(&temp.path().join(backup_key("draft", "new")), b"new").unwrap();
        assert_eq!(fs::read_to_string(old_backup).unwrap(), "old");
    }

    #[test]
    fn corrupt_and_future_sessions_fail_instead_of_becoming_empty() {
        assert!(parse_session("broken").is_err());
        let json = r#"{"version":2,"workspace_root":null,"active_tab_id":null,"layout_mode":"tabs","sidebar_visible":true,"sidebar_width":240,"tabs":[],"timestamp":""}"#;
        assert!(parse_session(json).is_err());
        assert!(parse_session(&json.replace("\"version\":2", "\"version\":1")).is_ok());
    }

}
