use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

const DEBOUNCE_MS: u64 = 500;

pub struct FileWatcher {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched_paths: Arc<Mutex<HashSet<String>>>,
    suppress_set: Arc<Mutex<HashSet<String>>>,
    debounce_map: Arc<Mutex<HashMap<String, Instant>>>,
    event_tx: mpsc::Sender<String>,
    event_rx: Mutex<Option<mpsc::Receiver<String>>>,
}

impl Default for FileWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl FileWatcher {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            watcher: Mutex::new(None),
            watched_paths: Arc::new(Mutex::new(HashSet::new())),
            suppress_set: Arc::new(Mutex::new(HashSet::new())),
            debounce_map: Arc::new(Mutex::new(HashMap::new())),
            event_tx: tx,
            event_rx: Mutex::new(Some(rx)),
        }
    }

    /// Take the event receiver (called once during app setup).
    pub fn take_event_rx(&self) -> Option<mpsc::Receiver<String>> {
        self.event_rx.lock().unwrap().take()
    }

    /// Start the internal notify watcher.
    pub fn start(&self) -> Result<(), String> {
        let suppress = self.suppress_set.clone();
        let debounce = self.debounce_map.clone();
        let tx = self.event_tx.clone();
        let watched = self.watched_paths.clone();

        let watcher = RecommendedWatcher::new(
            move |res: Result<notify::Event, notify::Error>| {
                let event = match res {
                    Ok(e) => e,
                    Err(_) => return,
                };

                // Only care about data modifications and creates (overwrite)
                match event.kind {
                    EventKind::Modify(_) => {}
                    EventKind::Create(_) => {}
                    _ => return,
                }

                for path in &event.paths {
                    let canonical = match std::fs::canonicalize(path) {
                        Ok(p) => p.to_string_lossy().to_string(),
                        Err(_) => path.to_string_lossy().to_string(),
                    };

                    if !watched.lock().unwrap().contains(&canonical) { continue; }

                    // Check self-save suppression
                    if let Ok(set) = suppress.lock() {
                        if set.contains(&canonical) {
                            continue;
                        }
                    }

                    // Per-path debounce
                    if let Ok(mut map) = debounce.lock() {
                        let now = Instant::now();
                        if let Some(last) = map.get(&canonical) {
                            if now.duration_since(*last) < Duration::from_millis(DEBOUNCE_MS) {
                                continue;
                            }
                        }
                        map.insert(canonical.clone(), now);
                    }

                    let _ = tx.send(canonical);
                }
            },
            Config::default(),
        )
        .map_err(|e| format!("Failed to create file watcher: {}", e))?;

        *self.watcher.lock().unwrap() = Some(watcher);
        Ok(())
    }

    /// Add a path to watch.
    pub fn watch(&self, path: &str) -> Result<(), String> {
        if path.trim().is_empty() {
            return Err("Cannot watch an empty path".into());
        }

        let canonical = std::fs::canonicalize(path)
            .map_err(|e| format!("Cannot watch {}: {}", path, e))?;
        let canonical_key = canonical.to_string_lossy().to_string();

        if self.watched_paths.lock().unwrap().contains(&canonical_key) {
            return Ok(());
        }

        if let Some(ref mut w) = *self.watcher.lock().unwrap() {
            w.watch(canonical.parent().ok_or("File has no parent")?, RecursiveMode::NonRecursive)
                .map_err(|e| format!("Watch failed: {}", e))?;
        }
        self.watched_paths.lock().unwrap().insert(canonical_key);
        Ok(())
    }

    /// Remove a path from watch.
    pub fn unwatch(&self, path: &str) -> Result<(), String> {
        if path.trim().is_empty() {
            return Ok(());
        }

        let canonical_key = match std::fs::canonicalize(path) {
            Ok(path) => path.to_string_lossy().to_string(),
            Err(_) if Path::new(path).is_absolute() => path.to_string(),
            Err(_) => return Ok(()),
        };

        let was_watched = self.watched_paths
            .lock()
            .unwrap()
            .remove(&canonical_key);

        if !was_watched {
            return Ok(());
        }

        if let Some(ref mut w) = *self.watcher.lock().unwrap() {
            let parent = Path::new(&canonical_key).parent();
            let shared = self.watched_paths.lock().unwrap().iter().any(|p| Path::new(p).parent() == parent);
            if !shared {
                if let Some(parent) = parent { let _ = w.unwatch(parent); }
            }
        }

        // Clean up debounce and suppression entries.
        if let Ok(mut map) = self.debounce_map.lock() {
            map.remove(&canonical_key);
        }
        if let Ok(mut set) = self.suppress_set.lock() {
            set.remove(&canonical_key);
        }
        Ok(())
    }

    /// Suppress watcher events for a path (self-save). Automatically clears after 200ms.
    pub fn suppress_then_clear(&self, path: &str) {
        let canonical = std::fs::canonicalize(path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.to_string());

        if let Ok(mut set) = self.suppress_set.lock() {
            set.insert(canonical.clone());
        }

        let suppress = self.suppress_set.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            if let Ok(mut set) = suppress.lock() {
                set.remove(&canonical);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parent_watch_survives_atomic_replacement_and_shared_unwatch() {
        let dir = tempfile::tempdir().unwrap();
        // macOS's temporary directory is reached through /var -> /private/var.
        // Watcher events deliberately return canonical paths on every platform.
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let first = root.join("first.md");
        let second = root.join("second.md");
        std::fs::write(&first, "old").unwrap();
        std::fs::write(&second, "old").unwrap();
        let watcher = FileWatcher::new();
        let events = watcher.take_event_rx().unwrap();
        watcher.start().unwrap();
        watcher.watch(first.to_str().unwrap()).unwrap();
        watcher.watch(second.to_str().unwrap()).unwrap();
        crate::storage::write(&first, b"replacement", true).unwrap();
        assert_eq!(events.recv_timeout(Duration::from_secs(3)).unwrap(), first.to_str().unwrap());
        watcher.unwatch(first.to_str().unwrap()).unwrap();
        crate::storage::write(&second, b"still watched", true).unwrap();
        assert_eq!(events.recv_timeout(Duration::from_secs(3)).unwrap(), second.to_str().unwrap());
        watcher.unwatch(second.to_str().unwrap()).unwrap();
    }
}
