use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// A file change detected on the remote.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub kind: ChangeKind,
    pub timestamp: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChangeKind {
    Created,
    Modified,
    Deleted,
}

/// State of workspace synchronization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SyncState {
    /// Not syncing.
    Idle,
    /// Initial sync in progress.
    Syncing { files_done: usize, files_total: usize },
    /// Fully synced, watching for changes.
    Watching,
    /// Sync error.
    Error(String),
}

/// Manages workspace file synchronization between local and remote.
///
/// Tracks file modification times to detect changes and sync incrementally.
pub struct WorkspaceSync {
    /// Remote directory being synced.
    remote_dir: String,
    /// Local cache directory.
    local_cache: String,
    /// Last known modification times (path → mtime).
    file_mtimes: HashMap<String, u64>,
    /// Current sync state.
    state: SyncState,
    /// Pending changes not yet applied locally.
    pending_changes: Vec<FileChange>,
}

impl WorkspaceSync {
    pub fn new(remote_dir: &str, local_cache: &str) -> Self {
        Self {
            remote_dir: remote_dir.to_string(),
            local_cache: local_cache.to_string(),
            file_mtimes: HashMap::new(),
            state: SyncState::Idle,
            pending_changes: Vec::new(),
        }
    }

    /// Record a file's modification time. Returns a FileChange if the file is new or modified.
    pub fn update_mtime(&mut self, path: &str, mtime: u64) -> Option<FileChange> {
        let old = self.file_mtimes.insert(path.to_string(), mtime);

        match old {
            None => Some(FileChange {
                path: path.to_string(),
                kind: ChangeKind::Created,
                timestamp: mtime,
            }),
            Some(old_mtime) if old_mtime < mtime => Some(FileChange {
                path: path.to_string(),
                kind: ChangeKind::Modified,
                timestamp: mtime,
            }),
            _ => None,
        }
    }

    /// Record a file deletion.
    pub fn record_deletion(&mut self, path: &str) -> FileChange {
        self.file_mtimes.remove(path);
        FileChange {
            path: path.to_string(),
            kind: ChangeKind::Deleted,
            timestamp: 0,
        }
    }

    /// Add a pending change.
    pub fn add_pending(&mut self, change: FileChange) {
        self.pending_changes.push(change);
    }

    /// Take all pending changes.
    pub fn take_pending(&mut self) -> Vec<FileChange> {
        std::mem::take(&mut self.pending_changes)
    }

    /// Get current sync state.
    pub fn state(&self) -> &SyncState {
        &self.state
    }

    /// Set sync state.
    pub fn set_state(&mut self, state: SyncState) {
        self.state = state;
    }

    /// Number of tracked files.
    pub fn tracked_count(&self) -> usize {
        self.file_mtimes.len()
    }

    pub fn remote_dir(&self) -> &str {
        &self.remote_dir
    }

    pub fn local_cache(&self) -> &str {
        &self.local_cache
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_file_detected() {
        let mut sync = WorkspaceSync::new("/remote/project", "/tmp/cache");
        let change = sync.update_mtime("src/main.rs", 1000);
        assert!(change.is_some());
        assert_eq!(change.unwrap().kind, ChangeKind::Created);
    }

    #[test]
    fn test_modified_file_detected() {
        let mut sync = WorkspaceSync::new("/remote/project", "/tmp/cache");
        sync.update_mtime("src/main.rs", 1000);
        let change = sync.update_mtime("src/main.rs", 2000);
        assert!(change.is_some());
        assert_eq!(change.unwrap().kind, ChangeKind::Modified);
    }

    #[test]
    fn test_unmodified_file_ignored() {
        let mut sync = WorkspaceSync::new("/remote/project", "/tmp/cache");
        sync.update_mtime("src/main.rs", 1000);
        let change = sync.update_mtime("src/main.rs", 1000);
        assert!(change.is_none());
    }

    #[test]
    fn test_deletion() {
        let mut sync = WorkspaceSync::new("/remote/project", "/tmp/cache");
        sync.update_mtime("src/main.rs", 1000);
        let change = sync.record_deletion("src/main.rs");
        assert_eq!(change.kind, ChangeKind::Deleted);
        assert_eq!(sync.tracked_count(), 0);
    }

    #[test]
    fn test_pending_changes() {
        let mut sync = WorkspaceSync::new("/remote/project", "/tmp/cache");
        sync.add_pending(FileChange {
            path: "a.rs".into(),
            kind: ChangeKind::Created,
            timestamp: 100,
        });
        sync.add_pending(FileChange {
            path: "b.rs".into(),
            kind: ChangeKind::Modified,
            timestamp: 200,
        });

        let pending = sync.take_pending();
        assert_eq!(pending.len(), 2);
        assert!(sync.take_pending().is_empty());
    }
}
