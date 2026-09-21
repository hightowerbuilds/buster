use std::fs;
use std::path::Path;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use tauri::command;
use crate::workspace::{self, WorkspaceState};

#[command]
pub fn set_workspace_root(state: tauri::State<WorkspaceState>, path: Option<String>) -> Result<(), String> {
    state.set(path);
    Ok(())
}

/// Validate a path against workspace, or allow if no workspace is set (single-file mode).
fn check_path(path: &str, state: &tauri::State<WorkspaceState>) -> Result<(), String> {
    if state.is_notes_path(path) { return Ok(()); }
    if let Some(root) = state.get() {
        workspace::validate_path(path, &root)?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub file_name: String,
}

#[command]
pub fn read_file(path: String, state: tauri::State<WorkspaceState>) -> Result<FileContent, String> {
    check_path(&path, &state)?;
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let file_name = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    Ok(FileContent {
        path,
        content,
        file_name,
    })
}

#[command]
pub fn write_file(
    path: String,
    content: String,
    must_exist: Option<bool>,
    state: tauri::State<WorkspaceState>,
    watcher: tauri::State<crate::watcher::FileWatcher>,
) -> Result<(), String> {
    check_path(&path, &state)?;
    watcher.suppress_then_clear(&path);
    use std::io::Write;
    let mut file = fs::OpenOptions::new().write(true).truncate(true)
        .create(!must_exist.unwrap_or(false)).open(&path).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())
}

#[command]
pub fn watch_file(path: String, watcher: tauri::State<crate::watcher::FileWatcher>) -> Result<(), String> {
    watcher.watch(&path)
}

#[command]
pub fn unwatch_file(path: String, watcher: tauri::State<crate::watcher::FileWatcher>) -> Result<(), String> {
    watcher.unwatch(&path)
}

#[command]
pub fn list_directory(path: String, state: tauri::State<WorkspaceState>) -> Result<Vec<DirEntry>, String> {
    check_path(&path, &state)?;
    let dir_path = Path::new(&path);

    // Build gitignore matcher — walks up to find .gitignore files
    let gitignore = load_gitignore(dir_path);

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(dir_path).map_err(|e| e.to_string())?;
    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files
        if name.starts_with('.') {
            continue;
        }

        // Check gitignore
        let entry_path = entry.path();
        if let Some(ref gi) = gitignore {
            let matched = gi.matched_path_or_any_parents(&entry_path, metadata.is_dir());
            if matched.is_ignore() {
                continue;
            }
        }

        entries.push(DirEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
    });
    Ok(entries)
}

fn load_gitignore(dir: &Path) -> Option<Gitignore> {
    // Look for .gitignore in this directory and parent directories
    let mut builder = GitignoreBuilder::new(dir);
    let mut current = Some(dir);
    while let Some(d) = current {
        let gi_path = d.join(".gitignore");
        if gi_path.exists() {
            let _ = builder.add(gi_path);
        }
        current = d.parent();
    }
    builder.build().ok()
}

#[command]
pub fn move_entry(source: String, dest_dir: String, state: tauri::State<WorkspaceState>) -> Result<String, String> {
    check_path(&source, &state)?;
    check_path(&dest_dir, &state)?;
    let src = Path::new(&source);
    let dest = Path::new(&dest_dir);

    let file_name = src
        .file_name()
        .ok_or("Invalid source path")?;

    let target = dest.join(file_name);

    if target.exists() {
        return Err(format!("{} already exists in destination", file_name.to_string_lossy()));
    }

    fs::rename(&source, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[command]
pub fn create_file(path: String, state: tauri::State<WorkspaceState>) -> Result<(), String> {
    check_path(&path, &state)?;
    let p = Path::new(&path);
    if p.exists() {
        return Err("File already exists".to_string());
    }
    // Ensure parent directory exists
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::OpenOptions::new().write(true).create_new(true).open(&path)
        .map(|_| ()).map_err(|e| e.to_string())
}

#[command]
pub fn create_directory(path: String, state: tauri::State<WorkspaceState>) -> Result<(), String> {
    check_path(&path, &state)?;
    let p = Path::new(&path);
    if p.exists() {
        return Err("Directory already exists".to_string());
    }
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[command]
pub fn rename_entry(old_path: String, new_name: String, state: tauri::State<WorkspaceState>) -> Result<String, String> {
    if new_name.is_empty() || new_name == "." || new_name == ".." || new_name.contains(['/', '\\', '\0']) {
        return Err("Enter a file or folder name without path separators".into());
    }
    check_path(&old_path, &state)?;
    let src = Path::new(&old_path);
    if !src.exists() {
        return Err("Source does not exist".to_string());
    }
    let parent = src.parent().ok_or("Invalid path")?;
    let target = parent.join(&new_name);
    if target.exists() {
        return Err(format!("\"{}\" already exists", new_name));
    }
    fs::rename(&old_path, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[command]
pub fn delete_entry(path: String, state: tauri::State<WorkspaceState>) -> Result<(), String> {
    check_path(&path, &state)?;
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Path does not exist".to_string());
    }
    if p.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

#[derive(serde::Serialize)]
pub struct BinaryFileContent {
    pub path: String,
    pub data_url: String,
    pub file_name: String,
    pub size: u64,
}

#[command]
pub fn read_binary_file(path: String, state: tauri::State<WorkspaceState>) -> Result<BinaryFileContent, String> {
    use std::io::Read;
    check_path(&path, &state)?;

    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    let size = metadata.len();

    let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity(size as usize);
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;

    // Detect MIME type from magic bytes
    let mime = match bytes.get(0..8) {
        Some(b) if b.starts_with(&[0x89, 0x50, 0x4E, 0x47]) => "image/png",
        Some(b) if b.starts_with(&[0xFF, 0xD8, 0xFF]) => "image/jpeg",
        Some(b) if b.starts_with(b"GIF8") => "image/gif",
        Some(b) if b.starts_with(b"RIFF") && b.len() >= 8 => {
            // Check for WEBP after RIFF header
            if bytes.get(8..12) == Some(b"WEBP") { "image/webp" } else { "application/octet-stream" }
        }
        Some(b) if b.starts_with(b"BM") => "image/bmp",
        Some(b) if b.starts_with(&[0x00, 0x00, 0x01, 0x00]) => "image/x-icon",
        _ => {
            // Check for SVG (text-based)
            let text_start = String::from_utf8_lossy(&bytes[..bytes.len().min(256)]);
            if text_start.contains("<svg") { "image/svg+xml" } else { "application/octet-stream" }
        }
    };

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let data_url = format!("data:{};base64,{}", mime, b64);

    let file_name = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    Ok(BinaryFileContent { path, data_url, file_name, size })
}

#[derive(serde::Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::WorkspaceState;
    use std::env;

    #[test]
    fn workspace_state_starts_empty() {
        let state = WorkspaceState::new();
        assert!(state.get().is_none());
    }

    #[test]
    fn check_path_validates_inside_workspace() {
        let tmp = env::temp_dir().join("buster_file_test");
        let _ = fs::create_dir_all(&tmp);
        let file = tmp.join("test.txt");
        fs::write(&file, "hello").unwrap();

        let result = workspace::validate_path(file.to_str().unwrap(), tmp.to_str().unwrap());
        assert!(result.is_ok());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn check_path_rejects_outside_workspace() {
        let tmp = env::temp_dir().join("buster_file_reject_test");
        let _ = fs::create_dir_all(&tmp);

        let result = workspace::validate_path("/etc/passwd", tmp.to_str().unwrap());
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn file_roundtrip_via_filesystem() {
        let tmp = env::temp_dir().join("buster_file_roundtrip");
        let _ = fs::create_dir_all(&tmp);
        let path = tmp.join("roundtrip.txt");

        // Write
        fs::write(&path, "hello world").unwrap();

        // Read back
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "hello world");

        // Overwrite
        fs::write(&path, "updated content").unwrap();
        let content2 = fs::read_to_string(&path).unwrap();
        assert_eq!(content2, "updated content");

        let _ = fs::remove_dir_all(&tmp);
    }
}
