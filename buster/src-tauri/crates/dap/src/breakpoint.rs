use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// A breakpoint set by the user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Breakpoint {
    /// Source file path.
    pub source: String,
    /// One-based line number.
    pub line: u32,
    /// Optional condition expression.
    pub condition: Option<String>,
    /// Optional hit count condition.
    pub hit_condition: Option<String>,
    /// Optional log message (logpoint).
    pub log_message: Option<String>,
    /// Whether this breakpoint is enabled.
    pub enabled: bool,
    /// Whether the debug adapter has verified this breakpoint.
    pub verified: bool,
}

/// Persistent breakpoint storage.
///
/// Tracks breakpoints across debug sessions and IDE restarts.
/// Grouped by file path for efficient lookup.
pub struct BreakpointStore {
    /// Breakpoints by source file path.
    by_file: HashMap<String, Vec<Breakpoint>>,
}

impl BreakpointStore {
    pub fn new() -> Self {
        Self {
            by_file: HashMap::new(),
        }
    }

    /// Toggle a breakpoint at the given file and line.
    /// Returns true if a breakpoint was added, false if removed.
    pub fn toggle(&mut self, source: &str, line: u32) -> bool {
        let breakpoints = self.by_file.entry(source.to_string()).or_default();

        if let Some(idx) = breakpoints.iter().position(|bp| bp.line == line) {
            breakpoints.remove(idx);
            false
        } else {
            breakpoints.push(Breakpoint {
                source: source.to_string(),
                line,
                condition: None,
                hit_condition: None,
                log_message: None,
                enabled: true,
                verified: false,
            });
            true
        }
    }

    /// Add a conditional breakpoint.
    pub fn add_conditional(&mut self, source: &str, line: u32, condition: String) {
        let breakpoints = self.by_file.entry(source.to_string()).or_default();
        breakpoints.push(Breakpoint {
            source: source.to_string(),
            line,
            condition: Some(condition),
            hit_condition: None,
            log_message: None,
            enabled: true,
            verified: false,
        });
    }

    /// Get all breakpoints for a file.
    pub fn get_for_file(&self, source: &str) -> &[Breakpoint] {
        self.by_file.get(source).map(|v| v.as_slice()).unwrap_or(&[])
    }

    /// Get all breakpoints across all files.
    pub fn all(&self) -> Vec<&Breakpoint> {
        self.by_file.values().flat_map(|v| v.iter()).collect()
    }

    /// Mark breakpoints as verified by the adapter.
    pub fn mark_verified(&mut self, source: &str, verified_lines: &[u32]) {
        if let Some(breakpoints) = self.by_file.get_mut(source) {
            for bp in breakpoints.iter_mut() {
                bp.verified = verified_lines.contains(&bp.line);
            }
        }
    }

    /// Remove all breakpoints for a file.
    pub fn clear_file(&mut self, source: &str) {
        self.by_file.remove(source);
    }

    /// Remove all breakpoints.
    pub fn clear_all(&mut self) {
        self.by_file.clear();
    }

    /// Serialize for persistence across IDE restarts.
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(&self.by_file)
    }

    /// Restore from persisted JSON.
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        let by_file: HashMap<String, Vec<Breakpoint>> = serde_json::from_str(json)?;
        Ok(Self { by_file })
    }
}

impl Default for BreakpointStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_toggle_add_remove() {
        let mut store = BreakpointStore::new();
        assert!(store.toggle("main.rs", 10)); // added
        assert_eq!(store.get_for_file("main.rs").len(), 1);
        assert!(!store.toggle("main.rs", 10)); // removed
        assert_eq!(store.get_for_file("main.rs").len(), 0);
    }

    #[test]
    fn test_conditional_breakpoint() {
        let mut store = BreakpointStore::new();
        store.add_conditional("main.rs", 20, "x > 5".into());
        let bps = store.get_for_file("main.rs");
        assert_eq!(bps.len(), 1);
        assert_eq!(bps[0].condition.as_deref(), Some("x > 5"));
    }

    #[test]
    fn test_persistence_roundtrip() {
        let mut store = BreakpointStore::new();
        store.toggle("main.rs", 10);
        store.toggle("lib.rs", 25);

        let json = store.to_json().unwrap();
        let restored = BreakpointStore::from_json(&json).unwrap();
        assert_eq!(restored.all().len(), 2);
    }

    #[test]
    fn test_mark_verified() {
        let mut store = BreakpointStore::new();
        store.toggle("main.rs", 10);
        store.toggle("main.rs", 20);
        store.mark_verified("main.rs", &[10]);

        let bps = store.get_for_file("main.rs");
        assert!(bps.iter().find(|bp| bp.line == 10).unwrap().verified);
        assert!(!bps.iter().find(|bp| bp.line == 20).unwrap().verified);
    }
}
