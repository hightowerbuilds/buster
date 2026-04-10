use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// Strategy for detecting file changes on the remote host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WatchStrategy {
    /// Poll by comparing file metadata at a fixed interval.
    Polling {
        /// Interval between polls in milliseconds.
        interval_ms: u64,
    },
    /// Use inotify (Linux) or similar kernel mechanism.
    /// Reserved for future use -- the consumer would set up the
    /// inotify watch over SSH and feed events back.
    Inotify,
}

impl Default for WatchStrategy {
    fn default() -> Self {
        WatchStrategy::Polling { interval_ms: 2000 }
    }
}

/// An event produced when a remote file changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WatchEvent {
    /// A new file was detected.
    Created(String),
    /// An existing file was modified (mtime or size changed).
    Modified(String),
    /// A previously tracked file is no longer present.
    Deleted(String),
}

/// Snapshot of a single file's metadata used for polling comparison.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileSnapshot {
    /// Remote file path.
    pub path: String,
    /// Last modification time (Unix epoch seconds or similar).
    pub mtime: u64,
    /// File size in bytes.
    pub size: u64,
}

/// Watches remote files for changes using a polling strategy.
///
/// The consumer is responsible for listing remote files (e.g. via `ls -lR`
/// or `find ... -printf`) and feeding the results into `poll()`. This struct
/// maintains the last-known snapshot and diffs against it.
pub struct RemoteWatcher {
    /// Paths being monitored (directories or file globs).
    pub watched_paths: Vec<String>,
    /// The watch strategy.
    pub strategy: WatchStrategy,
    /// Last known file state, keyed by path.
    pub last_snapshot: HashMap<String, FileSnapshot>,
}

impl RemoteWatcher {
    /// Create a new watcher with the given strategy.
    pub fn new(strategy: WatchStrategy) -> Self {
        Self {
            watched_paths: Vec::new(),
            strategy,
            last_snapshot: HashMap::new(),
        }
    }

    /// Add a path to watch.
    pub fn add_path(&mut self, path: &str) {
        if !self.watched_paths.contains(&path.to_string()) {
            self.watched_paths.push(path.to_string());
        }
    }

    /// Remove a path from watching.
    pub fn remove_path(&mut self, path: &str) -> bool {
        if let Some(pos) = self.watched_paths.iter().position(|p| p == path) {
            self.watched_paths.remove(pos);
            true
        } else {
            false
        }
    }

    /// Compare the current file listing against the last snapshot and return
    /// change events.
    ///
    /// `current_files` is a slice of `(path, mtime, size)` tuples representing
    /// the current state of files on the remote host (as reported by the
    /// consumer's SSH listing command).
    ///
    /// After computing the diff, the internal snapshot is updated to match
    /// `current_files`.
    pub fn poll(&mut self, current_files: &[(String, u64, u64)]) -> Vec<WatchEvent> {
        let mut events = Vec::new();

        // Build a set of current paths for quick lookup.
        let mut current_map: HashMap<&str, (u64, u64)> = HashMap::new();
        for (path, mtime, size) in current_files {
            current_map.insert(path.as_str(), (*mtime, *size));
        }

        // Detect created and modified files.
        for (path, mtime, size) in current_files {
            match self.last_snapshot.get(path.as_str()) {
                None => {
                    events.push(WatchEvent::Created(path.clone()));
                }
                Some(old) => {
                    if old.mtime != *mtime || old.size != *size {
                        events.push(WatchEvent::Modified(path.clone()));
                    }
                }
            }
        }

        // Detect deleted files.
        for old_path in self.last_snapshot.keys() {
            if !current_map.contains_key(old_path.as_str()) {
                events.push(WatchEvent::Deleted(old_path.clone()));
            }
        }

        // Update the snapshot.
        self.last_snapshot.clear();
        for (path, mtime, size) in current_files {
            self.last_snapshot.insert(
                path.clone(),
                FileSnapshot {
                    path: path.clone(),
                    mtime: *mtime,
                    size: *size,
                },
            );
        }

        events
    }

    /// Number of files currently tracked in the snapshot.
    pub fn tracked_count(&self) -> usize {
        self.last_snapshot.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_poll_detects_creates() {
        let mut watcher = RemoteWatcher::new(WatchStrategy::default());
        watcher.add_path("/project/src");

        let files = vec![
            ("src/main.rs".to_string(), 1000u64, 500u64),
            ("src/lib.rs".to_string(), 1000, 300),
        ];

        let events = watcher.poll(&files);
        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|e| matches!(e, WatchEvent::Created(_))));
        assert_eq!(watcher.tracked_count(), 2);
    }

    #[test]
    fn test_no_change_no_events() {
        let mut watcher = RemoteWatcher::new(WatchStrategy::default());

        let files = vec![("src/main.rs".to_string(), 1000u64, 500u64)];
        watcher.poll(&files);

        // Same files, same metadata.
        let events = watcher.poll(&files);
        assert!(events.is_empty());
    }

    #[test]
    fn test_modified_file_detected() {
        let mut watcher = RemoteWatcher::new(WatchStrategy::default());

        let files_v1 = vec![("src/main.rs".to_string(), 1000u64, 500u64)];
        watcher.poll(&files_v1);

        // mtime changed.
        let files_v2 = vec![("src/main.rs".to_string(), 2000u64, 500u64)];
        let events = watcher.poll(&files_v2);
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], WatchEvent::Modified(p) if p == "src/main.rs"));
    }

    #[test]
    fn test_size_change_detected() {
        let mut watcher = RemoteWatcher::new(WatchStrategy::default());

        let files_v1 = vec![("src/main.rs".to_string(), 1000u64, 500u64)];
        watcher.poll(&files_v1);

        // Same mtime, different size.
        let files_v2 = vec![("src/main.rs".to_string(), 1000u64, 600u64)];
        let events = watcher.poll(&files_v2);
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], WatchEvent::Modified(p) if p == "src/main.rs"));
    }

    #[test]
    fn test_deleted_file_detected() {
        let mut watcher = RemoteWatcher::new(WatchStrategy::default());

        let files_v1 = vec![
            ("src/main.rs".to_string(), 1000u64, 500u64),
            ("src/lib.rs".to_string(), 1000, 300),
        ];
        watcher.poll(&files_v1);

        // lib.rs disappeared.
        let files_v2 = vec![("src/main.rs".to_string(), 1000u64, 500u64)];
        let events = watcher.poll(&files_v2);
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], WatchEvent::Deleted(p) if p == "src/lib.rs"));
        assert_eq!(watcher.tracked_count(), 1);
    }

    #[test]
    fn test_combined_create_modify_delete() {
        let mut watcher = RemoteWatcher::new(WatchStrategy::default());

        let files_v1 = vec![
            ("a.rs".to_string(), 100u64, 10u64),
            ("b.rs".to_string(), 100, 20),
        ];
        watcher.poll(&files_v1);

        // a.rs modified, b.rs deleted, c.rs created.
        let files_v2 = vec![
            ("a.rs".to_string(), 200u64, 10u64),
            ("c.rs".to_string(), 150, 30),
        ];
        let events = watcher.poll(&files_v2);

        let has_modified = events.iter().any(|e| matches!(e, WatchEvent::Modified(p) if p == "a.rs"));
        let has_created = events.iter().any(|e| matches!(e, WatchEvent::Created(p) if p == "c.rs"));
        let has_deleted = events.iter().any(|e| matches!(e, WatchEvent::Deleted(p) if p == "b.rs"));

        assert!(has_modified, "expected Modified(a.rs)");
        assert!(has_created, "expected Created(c.rs)");
        assert!(has_deleted, "expected Deleted(b.rs)");
        assert_eq!(events.len(), 3);
    }

    #[test]
    fn test_add_remove_paths() {
        let mut watcher = RemoteWatcher::new(WatchStrategy::default());
        watcher.add_path("/project/src");
        watcher.add_path("/project/tests");
        assert_eq!(watcher.watched_paths.len(), 2);

        // Duplicate add is ignored.
        watcher.add_path("/project/src");
        assert_eq!(watcher.watched_paths.len(), 2);

        assert!(watcher.remove_path("/project/src"));
        assert_eq!(watcher.watched_paths.len(), 1);

        // Removing non-existent path returns false.
        assert!(!watcher.remove_path("/nonexistent"));
    }

    #[test]
    fn test_inotify_strategy() {
        // Just verify the enum variant exists and is constructible.
        let watcher = RemoteWatcher::new(WatchStrategy::Inotify);
        assert_eq!(watcher.strategy, WatchStrategy::Inotify);
    }
}
