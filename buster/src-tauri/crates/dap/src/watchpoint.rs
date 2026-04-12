use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use serde::{Deserialize, Serialize};

/// The type of access that triggers a watchpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WatchpointType {
    /// Triggered on write access.
    Write,
    /// Triggered on read access.
    Read,
    /// Triggered on either read or write access.
    ReadWrite,
}

impl WatchpointType {
    /// Convert to the DAP `accessType` string used in `DataBreakpoint` requests.
    fn as_dap_access_type(&self) -> &'static str {
        match self {
            WatchpointType::Write => "write",
            WatchpointType::Read => "read",
            WatchpointType::ReadWrite => "readWrite",
        }
    }
}

/// A watchpoint (data breakpoint) set by the user.
///
/// Watchpoints pause execution when a watched expression is accessed.
/// They map to DAP `setDataBreakpoints` requests.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Watchpoint {
    /// Unique identifier for this watchpoint.
    pub id: u64,
    /// The variable or expression to watch (the `dataId` in DAP terms).
    pub expression: String,
    /// What kind of access triggers the watchpoint.
    pub watch_type: WatchpointType,
    /// Optional condition expression that must be true for the watchpoint to trigger.
    pub condition: Option<String>,
    /// Optional hit count condition (e.g., "> 5").
    pub hit_condition: Option<String>,
    /// Whether this watchpoint is enabled.
    pub enabled: bool,
}

/// Global counter for generating unique watchpoint IDs.
static NEXT_WATCHPOINT_ID: AtomicU64 = AtomicU64::new(1);

/// Storage and management for watchpoints.
///
/// Tracks watchpoints independently from breakpoints since they map to
/// a different DAP request (`setDataBreakpoints` vs `setBreakpoints`).
pub struct WatchpointStore {
    watchpoints: HashMap<u64, Watchpoint>,
}

impl WatchpointStore {
    pub fn new() -> Self {
        Self {
            watchpoints: HashMap::new(),
        }
    }

    /// Add a new watchpoint. Returns the assigned ID.
    pub fn add(
        &mut self,
        expression: impl Into<String>,
        watch_type: WatchpointType,
        condition: Option<String>,
    ) -> u64 {
        let id = NEXT_WATCHPOINT_ID.fetch_add(1, Ordering::Relaxed);
        self.watchpoints.insert(
            id,
            Watchpoint {
                id,
                expression: expression.into(),
                watch_type,
                condition,
                hit_condition: None,
                enabled: true,
            },
        );
        id
    }

    /// Remove a watchpoint by ID. Returns `true` if it existed.
    pub fn remove(&mut self, id: u64) -> bool {
        self.watchpoints.remove(&id).is_some()
    }

    /// List all watchpoints, sorted by ID for deterministic output.
    pub fn list(&self) -> Vec<&Watchpoint> {
        let mut wps: Vec<&Watchpoint> = self.watchpoints.values().collect();
        wps.sort_by_key(|wp| wp.id);
        wps
    }

    /// Toggle a watchpoint's enabled state. Returns `true` if the watchpoint exists.
    pub fn toggle(&mut self, id: u64) -> bool {
        if let Some(wp) = self.watchpoints.get_mut(&id) {
            wp.enabled = !wp.enabled;
            true
        } else {
            false
        }
    }

    /// Remove all watchpoints.
    pub fn clear(&mut self) {
        self.watchpoints.clear();
    }

    /// Set the hit condition on an existing watchpoint.
    pub fn set_hit_condition(&mut self, id: u64, hit_condition: Option<String>) -> bool {
        if let Some(wp) = self.watchpoints.get_mut(&id) {
            wp.hit_condition = hit_condition;
            true
        } else {
            false
        }
    }

    /// Format all enabled watchpoints as a DAP `setDataBreakpoints` argument body.
    ///
    /// Returns a JSON array suitable for the `breakpoints` field of the
    /// `SetDataBreakpointsArguments` in the DAP specification.
    pub fn to_dap_request(&self) -> Vec<serde_json::Value> {
        let mut wps: Vec<&Watchpoint> = self
            .watchpoints
            .values()
            .filter(|wp| wp.enabled)
            .collect();
        wps.sort_by_key(|wp| wp.id);

        wps.iter()
            .map(|wp| {
                let mut obj = serde_json::json!({
                    "dataId": wp.expression,
                    "accessType": wp.watch_type.as_dap_access_type(),
                });
                if let Some(cond) = &wp.condition {
                    obj["condition"] = serde_json::Value::String(cond.clone());
                }
                if let Some(hit) = &wp.hit_condition {
                    obj["hitCondition"] = serde_json::Value::String(hit.clone());
                }
                obj
            })
            .collect()
    }
}

impl Default for WatchpointStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_and_list() {
        let mut store = WatchpointStore::new();
        let id1 = store.add("x", WatchpointType::Write, None);
        let id2 = store.add("y.field", WatchpointType::Read, Some("y.field > 10".into()));

        let list = store.list();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, id1);
        assert_eq!(list[0].expression, "x");
        assert_eq!(list[0].watch_type, WatchpointType::Write);
        assert!(list[0].condition.is_none());

        assert_eq!(list[1].id, id2);
        assert_eq!(list[1].expression, "y.field");
        assert_eq!(list[1].watch_type, WatchpointType::Read);
        assert_eq!(list[1].condition.as_deref(), Some("y.field > 10"));
    }

    #[test]
    fn test_remove() {
        let mut store = WatchpointStore::new();
        let id = store.add("ptr", WatchpointType::ReadWrite, None);
        assert!(store.remove(id));
        assert!(!store.remove(id)); // already removed
        assert_eq!(store.list().len(), 0);
    }

    #[test]
    fn test_toggle() {
        let mut store = WatchpointStore::new();
        let id = store.add("counter", WatchpointType::Write, None);

        assert!(store.list()[0].enabled);
        assert!(store.toggle(id));
        assert!(!store.list()[0].enabled);
        assert!(store.toggle(id));
        assert!(store.list()[0].enabled);

        // Toggle non-existent ID returns false
        assert!(!store.toggle(99999));
    }

    #[test]
    fn test_clear() {
        let mut store = WatchpointStore::new();
        store.add("a", WatchpointType::Write, None);
        store.add("b", WatchpointType::Read, None);
        assert_eq!(store.list().len(), 2);
        store.clear();
        assert_eq!(store.list().len(), 0);
    }

    #[test]
    fn test_set_hit_condition() {
        let mut store = WatchpointStore::new();
        let id = store.add("buf", WatchpointType::Write, None);
        assert!(store.set_hit_condition(id, Some("> 3".into())));
        assert_eq!(store.list()[0].hit_condition.as_deref(), Some("> 3"));

        assert!(!store.set_hit_condition(99999, Some("1".into())));
    }

    #[test]
    fn test_to_dap_request_basic() {
        let mut store = WatchpointStore::new();
        store.add("myVar", WatchpointType::Write, None);

        let dap = store.to_dap_request();
        assert_eq!(dap.len(), 1);
        assert_eq!(dap[0]["dataId"], "myVar");
        assert_eq!(dap[0]["accessType"], "write");
        assert!(dap[0].get("condition").is_none());
        assert!(dap[0].get("hitCondition").is_none());
    }

    #[test]
    fn test_to_dap_request_with_conditions() {
        let mut store = WatchpointStore::new();
        let id = store.add("arr[0]", WatchpointType::ReadWrite, Some("arr[0] != 0".into()));
        store.set_hit_condition(id, Some(">= 2".into()));

        let dap = store.to_dap_request();
        assert_eq!(dap.len(), 1);
        assert_eq!(dap[0]["dataId"], "arr[0]");
        assert_eq!(dap[0]["accessType"], "readWrite");
        assert_eq!(dap[0]["condition"], "arr[0] != 0");
        assert_eq!(dap[0]["hitCondition"], ">= 2");
    }

    #[test]
    fn test_to_dap_request_filters_disabled() {
        let mut store = WatchpointStore::new();
        let id1 = store.add("a", WatchpointType::Write, None);
        let _id2 = store.add("b", WatchpointType::Read, None);

        store.toggle(id1); // disable "a"

        let dap = store.to_dap_request();
        assert_eq!(dap.len(), 1);
        assert_eq!(dap[0]["dataId"], "b");
    }

    #[test]
    fn test_to_dap_request_empty() {
        let store = WatchpointStore::new();
        let dap = store.to_dap_request();
        assert!(dap.is_empty());
    }

    #[test]
    fn test_access_type_strings() {
        assert_eq!(WatchpointType::Write.as_dap_access_type(), "write");
        assert_eq!(WatchpointType::Read.as_dap_access_type(), "read");
        assert_eq!(WatchpointType::ReadWrite.as_dap_access_type(), "readWrite");
    }
}
