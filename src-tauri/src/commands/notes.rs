use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use crate::workspace::WorkspaceState;

#[derive(serde::Serialize)]
pub struct NotesWorkspace {
    pub root: String,
    pub first_run: bool,
    pub desktop_link: Option<String>,
    pub warning: Option<String>,
}

// Never replace a pre-existing Desktop folder or an unrelated symbolic link.
fn desktop_link(root: &Path, desktop: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(desktop).map_err(|e| e.to_string())?;
    for suffix in 0..100 {
        let name = if suffix == 0 { "BusterMark".to_string() }
            else { format!("BusterMark Notes {}", suffix) };
        let link = desktop.join(name);
        match fs::symlink_metadata(&link) {
            Ok(meta) => {
                if meta.file_type().is_symlink() && fs::canonicalize(&link).ok().as_deref() == Some(root) {
                    return Ok(link);
                }
                continue;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        #[cfg(unix)]
        let result = std::os::unix::fs::symlink(root, &link);
        #[cfg(windows)]
        let result = std::os::windows::fs::symlink_dir(root, &link);
        #[cfg(not(any(unix, windows)))]
        let result: std::io::Result<()> = Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "Symbolic links are unavailable"));
        match result {
            Ok(()) => return Ok(link),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("No free BusterMark shortcut name was found on the Desktop".into())
}

#[tauri::command]
pub fn initialize_notes_workspace(app: tauri::AppHandle, state: tauri::State<WorkspaceState>) -> Result<NotesWorkspace, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("Notes");
    let first_run = !root.exists();
    fs::create_dir_all(&root).map_err(|e| format!("Could not create the Notes folder: {e}"))?;
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let root_string = root.to_string_lossy().into_owned();
    state.set_notes_root(root_string.clone());
    let shortcut = dirs::desktop_dir().ok_or("Desktop folder was not found".to_string())
        .and_then(|desktop| desktop_link(&root, &desktop));
    let (desktop_link, warning) = match shortcut {
        Ok(path) => (Some(path.to_string_lossy().into_owned()), None),
        Err(error) => (None, Some(format!("Notes are saved at {}. Desktop shortcut could not be created: {error}", root.display()))),
    };
    Ok(NotesWorkspace { root: root_string, first_run, desktop_link, warning })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    fn fixture() -> (PathBuf, PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("bustermark-notes-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        let root = base.join("app/Notes");
        fs::create_dir_all(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let desktop = base.join("Desktop");
        (base, root, desktop)
    }
    #[test]
    fn shortcut_is_idempotent_and_shares_files_in_both_directions() {
        let (base, root, desktop) = fixture();
        let link = desktop_link(&root, &desktop).unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        fs::create_dir(root.join("Drafts")).unwrap();
        fs::write(root.join("Drafts/note.md"), "from app").unwrap();
        assert_eq!(fs::read_to_string(link.join("Drafts/note.md")).unwrap(), "from app");
        fs::write(link.join("Drafts/note.md"), "from Desktop").unwrap();
        assert_eq!(fs::read_to_string(root.join("Drafts/note.md")).unwrap(), "from Desktop");
        assert_eq!(desktop_link(&root, &desktop).unwrap(), link);
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn existing_folder_and_unrelated_broken_link_are_preserved() {
        let (base, root, desktop) = fixture();
        fs::create_dir_all(desktop.join("BusterMark")).unwrap();
        fs::write(desktop.join("BusterMark/keep.md"), "keep").unwrap();
        std::os::unix::fs::symlink(base.join("missing"), desktop.join("BusterMark Notes 1")).unwrap();
        let link = desktop_link(&root, &desktop).unwrap();
        assert_eq!(link, desktop.join("BusterMark Notes 2"));
        assert_eq!(desktop_link(&root, &desktop).unwrap(), link);
        assert_eq!(fs::read_to_string(desktop.join("BusterMark/keep.md")).unwrap(), "keep");
        assert_eq!(fs::read_link(desktop.join("BusterMark Notes 1")).unwrap(), base.join("missing"));
        fs::remove_dir_all(base).unwrap();
    }
}
