use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use crate::types::TerminalError;

/// Monitors PTY health and manages crash recovery.
///
/// Tracks whether the PTY reader has exited, counts restarts,
/// and provides a callback mechanism for the host to respawn.
pub struct PtyMonitor {
    /// Whether the PTY process is alive.
    alive: Arc<AtomicBool>,
    /// Number of times the PTY has been restarted.
    restart_count: AtomicU32,
    /// Maximum allowed restarts before giving up.
    max_restarts: u32,
}

impl PtyMonitor {
    pub fn new(max_restarts: u32) -> Self {
        Self {
            alive: Arc::new(AtomicBool::new(true)),
            restart_count: AtomicU32::new(0),
            max_restarts,
        }
    }

    /// Get an alive flag that the reader thread can set to false on exit.
    pub fn alive_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.alive)
    }

    /// Check if the PTY is still alive.
    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Relaxed)
    }

    /// Mark the PTY as crashed.
    pub fn mark_crashed(&self) {
        self.alive.store(false, Ordering::Relaxed);
    }

    /// Attempt recovery. Returns Ok if restart is allowed, Err if max restarts exceeded.
    pub fn try_restart(&self) -> Result<u32, TerminalError> {
        let count = self.restart_count.fetch_add(1, Ordering::Relaxed) + 1;
        if count > self.max_restarts {
            return Err(TerminalError::PtyCrashed {
                reason: format!(
                    "PTY crashed {} times, exceeding max restarts ({})",
                    count, self.max_restarts
                ),
            });
        }
        self.alive.store(true, Ordering::Relaxed);
        Ok(count)
    }

    /// Reset restart counter (called after a successful period of operation).
    pub fn reset_count(&self) {
        self.restart_count.store(0, Ordering::Relaxed);
    }

    /// Get current restart count.
    pub fn restart_count(&self) -> u32 {
        self.restart_count.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_state() {
        let mon = PtyMonitor::new(3);
        assert!(mon.is_alive());
        assert_eq!(mon.restart_count(), 0);
    }

    #[test]
    fn test_crash_and_restart() {
        let mon = PtyMonitor::new(3);
        mon.mark_crashed();
        assert!(!mon.is_alive());

        let count = mon.try_restart().unwrap();
        assert_eq!(count, 1);
        assert!(mon.is_alive());
    }

    #[test]
    fn test_max_restarts_exceeded() {
        let mon = PtyMonitor::new(2);
        mon.try_restart().unwrap(); // 1
        mon.try_restart().unwrap(); // 2
        assert!(mon.try_restart().is_err()); // 3 > max
    }

    #[test]
    fn test_alive_flag_shared() {
        let mon = PtyMonitor::new(3);
        let flag = mon.alive_flag();

        assert!(flag.load(Ordering::Relaxed));
        flag.store(false, Ordering::Relaxed); // reader thread sets this
        assert!(!mon.is_alive());
    }

    #[test]
    fn test_reset_count() {
        let mon = PtyMonitor::new(5);
        mon.try_restart().unwrap();
        mon.try_restart().unwrap();
        assert_eq!(mon.restart_count(), 2);
        mon.reset_count();
        assert_eq!(mon.restart_count(), 0);
    }
}
