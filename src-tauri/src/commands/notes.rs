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
        let name = if suffix == 0 { "bustermark-workspace".to_string() }
            else { format!("bustermark-workspace-{}", suffix) };
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
    Err("No free bustermark-workspace shortcut name was found on the Desktop".into())
}

// XDG treats a Desktop directory equal to $HOME as disabled; fall back to an existing ~/Desktop.
fn desktop_folder(configured: Option<PathBuf>, home: Option<PathBuf>) -> Option<PathBuf> {
    configured.or_else(|| home.map(|home| home.join("Desktop")).filter(|desktop| desktop.is_dir()))
}

#[tauri::command]
pub fn initialize_notes_workspace(app: tauri::AppHandle, state: tauri::State<WorkspaceState>) -> Result<NotesWorkspace, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("Notes");
    let first_run = !root.exists();
    fs::create_dir_all(&root).map_err(|e| format!("Could not create the Notes folder: {e}"))?;
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let root_string = root.to_string_lossy().into_owned();
    state.set_notes_root(root_string.clone());
    let shortcut = desktop_folder(dirs::desktop_dir(), dirs::home_dir())
        .ok_or("Desktop folder was not found".to_string())
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
        fs::create_dir_all(desktop.join("bustermark-workspace")).unwrap();
        fs::write(desktop.join("bustermark-workspace/keep.md"), "keep").unwrap();
        std::os::unix::fs::symlink(base.join("missing"), desktop.join("bustermark-workspace-1")).unwrap();
        let link = desktop_link(&root, &desktop).unwrap();
        assert_eq!(link, desktop.join("bustermark-workspace-2"));
        assert_eq!(desktop_link(&root, &desktop).unwrap(), link);
        assert_eq!(fs::read_to_string(desktop.join("bustermark-workspace/keep.md")).unwrap(), "keep");
        assert_eq!(fs::read_link(desktop.join("bustermark-workspace-1")).unwrap(), base.join("missing"));
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn desktop_falls_back_to_existing_home_desktop_only() {
        let (base, _root, desktop) = fixture();
        let configured = base.join("Configured");
        assert_eq!(desktop_folder(Some(configured.clone()), Some(base.clone())), Some(configured));
        assert_eq!(desktop_folder(None, Some(base.clone())), None);
        fs::create_dir_all(&desktop).unwrap();
        assert_eq!(desktop_folder(None, Some(base.clone())), Some(desktop));
        assert_eq!(desktop_folder(None, None), None);
        fs::remove_dir_all(base).unwrap();
    }
}
