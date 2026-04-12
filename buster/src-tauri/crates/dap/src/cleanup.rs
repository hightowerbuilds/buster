use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Metadata for a tracked debug adapter process.
#[derive(Debug)]
pub struct TrackedProcess {
    /// OS process ID.
    pub pid: u32,
    /// The debug adapter that spawned this process (e.g., "codelldb").
    pub adapter_id: String,
    /// When the process was registered.
    pub started_at: Instant,
}

/// Tracks spawned debug adapter processes so they can be cleaned up
/// on IDE exit (preventing zombie/orphan adapter processes).
///
/// This is thread-safe via interior `Mutex`, matching the pattern used
/// by `EventChannel` in this crate.
pub struct ProcessTracker {
    tracked: Mutex<HashMap<u32, TrackedProcess>>,
}

impl ProcessTracker {
    pub fn new() -> Self {
        Self {
            tracked: Mutex::new(HashMap::new()),
        }
    }

    /// Register a spawned adapter process for tracking.
    pub fn register(&self, pid: u32, adapter_id: &str) {
        if let Ok(mut map) = self.tracked.lock() {
            map.insert(
                pid,
                TrackedProcess {
                    pid,
                    adapter_id: adapter_id.to_string(),
                    started_at: Instant::now(),
                },
            );
        }
    }

    /// Unregister a process that exited normally.
    pub fn unregister(&self, pid: u32) {
        if let Ok(mut map) = self.tracked.lock() {
            map.remove(&pid);
        }
    }

    /// Kill all tracked processes. Called on IDE exit to prevent zombies.
    ///
    /// Returns the list of PIDs that were sent a kill signal.
    pub fn kill_all(&self) -> Vec<u32> {
        let pids: Vec<u32> = if let Ok(mut map) = self.tracked.lock() {
            let pids: Vec<u32> = map.keys().copied().collect();
            map.clear();
            pids
        } else {
            return Vec::new();
        };

        let mut killed = Vec::new();
        for pid in pids {
            if kill_process(pid) {
                killed.push(pid);
            }
        }
        killed
    }

    /// Kill processes that have been running longer than `max_age`.
    ///
    /// Useful for cleaning up adapters from crashed sessions that never
    /// called `unregister`.
    pub fn cleanup_stale(&self, max_age: Duration) -> Vec<u32> {
        let now = Instant::now();
        let stale_pids: Vec<u32> = if let Ok(map) = self.tracked.lock() {
            map.values()
                .filter(|p| now.duration_since(p.started_at) > max_age)
                .map(|p| p.pid)
                .collect()
        } else {
            return Vec::new();
        };

        let mut killed = Vec::new();
        for pid in &stale_pids {
            if kill_process(*pid) {
                killed.push(*pid);
            }
        }

        // Remove killed processes from tracking
        if let Ok(mut map) = self.tracked.lock() {
            for pid in &killed {
                map.remove(pid);
            }
        }

        killed
    }

    /// Get the number of currently tracked processes.
    pub fn count(&self) -> usize {
        self.tracked.lock().map(|m| m.len()).unwrap_or(0)
    }

    /// List all tracked PIDs and their adapter IDs.
    pub fn list(&self) -> Vec<(u32, String)> {
        self.tracked
            .lock()
            .map(|m| {
                m.values()
                    .map(|p| (p.pid, p.adapter_id.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }
}

impl Default for ProcessTracker {
    fn default() -> Self {
        Self::new()
    }
}

/// Platform-specific process kill.
///
/// On Unix, sends SIGTERM. On Windows, uses `taskkill`.
/// Returns `true` if the kill command was dispatched (does not guarantee
/// the process actually terminated).
fn kill_process(pid: u32) -> bool {
    #[cfg(unix)]
    {
        use std::process::Command;
        Command::new("kill")
            .arg(pid.to_string())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    #[cfg(windows)]
    {
        use std::process::Command;
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    #[cfg(not(any(unix, windows)))]
    {
        log::warn!("kill_process not implemented for this platform, pid={pid}");
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_and_count() {
        let tracker = ProcessTracker::new();
        assert_eq!(tracker.count(), 0);

        tracker.register(1001, "codelldb");
        tracker.register(1002, "debugpy");
        assert_eq!(tracker.count(), 2);
    }

    #[test]
    fn test_unregister() {
        let tracker = ProcessTracker::new();
        tracker.register(1001, "codelldb");
        tracker.register(1002, "debugpy");

        tracker.unregister(1001);
        assert_eq!(tracker.count(), 1);

        // Unregistering non-existent PID is a no-op
        tracker.unregister(9999);
        assert_eq!(tracker.count(), 1);
    }

    #[test]
    fn test_list() {
        let tracker = ProcessTracker::new();
        tracker.register(100, "codelldb");
        tracker.register(200, "debugpy");

        let list = tracker.list();
        assert_eq!(list.len(), 2);
        assert!(list.iter().any(|(pid, id)| *pid == 100 && id == "codelldb"));
        assert!(list.iter().any(|(pid, id)| *pid == 200 && id == "debugpy"));
    }

    #[test]
    fn test_kill_all_clears_tracked() {
        let tracker = ProcessTracker::new();
        // Use PIDs that almost certainly don't exist so the kill calls are harmless
        tracker.register(999_999_1, "adapter_a");
        tracker.register(999_999_2, "adapter_b");

        let _killed = tracker.kill_all();
        // Regardless of whether kill succeeded, the tracker should be empty
        assert_eq!(tracker.count(), 0);
    }

    #[test]
    fn test_cleanup_stale_respects_age() {
        let tracker = ProcessTracker::new();
        // Register a process, then immediately ask for stale cleanup with a long max_age.
        // Nothing should be killed because the process was just registered.
        tracker.register(999_999_3, "fresh_adapter");

        let killed = tracker.cleanup_stale(Duration::from_secs(3600));
        assert!(killed.is_empty());
        assert_eq!(tracker.count(), 1);
    }

    #[test]
    fn test_thread_safe_register() {
        use std::sync::Arc;

        let tracker = Arc::new(ProcessTracker::new());
        let mut handles = Vec::new();

        for i in 0..10 {
            let t = Arc::clone(&tracker);
            handles.push(std::thread::spawn(move || {
                t.register(5000 + i, "thread_adapter");
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        assert_eq!(tracker.count(), 10);
    }

    #[test]
    fn test_register_replaces_duplicate_pid() {
        let tracker = ProcessTracker::new();
        tracker.register(42, "first");
        tracker.register(42, "second");

        // Same PID, should be replaced not duplicated
        assert_eq!(tracker.count(), 1);

        let list = tracker.list();
        assert_eq!(list[0].1, "second");
    }
}
