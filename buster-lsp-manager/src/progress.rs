//! Progress reporting support for LSP `$/progress` notifications.
//!
//! Language servers report long-running work (indexing, building, etc.) via
//! `$/progress` notifications. This module provides types for parsing those
//! notifications and a `ProgressTracker` for managing the set of active
//! progress items.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------------------
// ProgressToken
// ---------------------------------------------------------------------------

/// A token that identifies a progress reporting session.
///
/// The LSP spec allows either an integer or a string.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ProgressToken {
    Number(i32),
    String(String),
}

impl std::fmt::Display for ProgressToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProgressToken::Number(n) => write!(f, "{}", n),
            ProgressToken::String(s) => write!(f, "{}", s),
        }
    }
}

// ---------------------------------------------------------------------------
// WorkDoneProgress
// ---------------------------------------------------------------------------

/// The three stages of work-done progress as defined by the LSP spec.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum WorkDoneProgress {
    Begin {
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        percentage: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cancellable: Option<bool>,
    },
    Report {
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        percentage: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cancellable: Option<bool>,
    },
    End {
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
}

// ---------------------------------------------------------------------------
// ProgressTracker
// ---------------------------------------------------------------------------

/// Tracks active `$/progress` sessions reported by a language server.
///
/// Typical usage:
/// 1. When you receive a `$/progress` notification, call
///    `parse_progress_notification` to extract the token and progress value.
/// 2. Call `tracker.update(token, progress)`.
/// 3. When the progress kind is `End`, call `tracker.remove(&token)`.
#[derive(Debug, Default)]
pub struct ProgressTracker {
    active: HashMap<ProgressToken, WorkDoneProgress>,
}

impl ProgressTracker {
    /// Create a new empty tracker.
    pub fn new() -> Self {
        Self {
            active: HashMap::new(),
        }
    }

    /// Insert or update progress for a given token.
    pub fn update(&mut self, token: ProgressToken, progress: WorkDoneProgress) {
        self.active.insert(token, progress);
    }

    /// Remove a completed progress entry.
    pub fn remove(&mut self, token: &ProgressToken) {
        self.active.remove(token);
    }

    /// List all active progress entries.
    pub fn list(&self) -> Vec<(ProgressToken, &WorkDoneProgress)> {
        self.active.iter().map(|(k, v)| (k.clone(), v)).collect()
    }

    /// Returns `true` if there are no active progress items.
    pub fn is_empty(&self) -> bool {
        self.active.is_empty()
    }

    /// Returns the number of active progress items.
    pub fn len(&self) -> usize {
        self.active.len()
    }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/// Parse a `$/progress` notification's params into a token and progress value.
///
/// Returns `None` if the params are malformed or missing required fields.
///
/// Expected JSON shape:
/// ```json
/// {
///   "token": <number | string>,
///   "value": { "kind": "begin"|"report"|"end", ... }
/// }
/// ```
pub fn parse_progress_notification(params: &Value) -> Option<(ProgressToken, WorkDoneProgress)> {
    let obj = params.as_object()?;

    // Parse token
    let token_val = obj.get("token")?;
    let token = match token_val {
        Value::Number(n) => ProgressToken::Number(n.as_i64()? as i32),
        Value::String(s) => ProgressToken::String(s.clone()),
        _ => return None,
    };

    // Parse value
    let value = obj.get("value")?;
    let progress: WorkDoneProgress = serde_json::from_value(value.clone()).ok()?;

    Some((token, progress))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ---- ProgressToken ----

    #[test]
    fn test_progress_token_display_number() {
        let token = ProgressToken::Number(42);
        assert_eq!(token.to_string(), "42");
    }

    #[test]
    fn test_progress_token_display_string() {
        let token = ProgressToken::String("indexing-abc".into());
        assert_eq!(token.to_string(), "indexing-abc");
    }

    #[test]
    fn test_progress_token_equality() {
        assert_eq!(ProgressToken::Number(1), ProgressToken::Number(1));
        assert_ne!(ProgressToken::Number(1), ProgressToken::Number(2));
        assert_eq!(
            ProgressToken::String("a".into()),
            ProgressToken::String("a".into())
        );
        assert_ne!(ProgressToken::Number(1), ProgressToken::String("1".into()));
    }

    // ---- ProgressTracker lifecycle ----

    #[test]
    fn test_tracker_starts_empty() {
        let tracker = ProgressTracker::new();
        assert!(tracker.is_empty());
        assert_eq!(tracker.len(), 0);
        assert!(tracker.list().is_empty());
    }

    #[test]
    fn test_tracker_update_and_list() {
        let mut tracker = ProgressTracker::new();
        let token = ProgressToken::Number(1);

        tracker.update(
            token.clone(),
            WorkDoneProgress::Begin {
                title: "Indexing".into(),
                message: None,
                percentage: Some(0),
                cancellable: Some(false),
            },
        );

        assert_eq!(tracker.len(), 1);
        assert!(!tracker.is_empty());

        let items = tracker.list();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].0, token);
    }

    #[test]
    fn test_tracker_update_replaces_existing() {
        let mut tracker = ProgressTracker::new();
        let token = ProgressToken::String("idx".into());

        tracker.update(
            token.clone(),
            WorkDoneProgress::Begin {
                title: "Indexing".into(),
                message: None,
                percentage: Some(0),
                cancellable: None,
            },
        );

        tracker.update(
            token.clone(),
            WorkDoneProgress::Report {
                message: Some("50% done".into()),
                percentage: Some(50),
                cancellable: None,
            },
        );

        assert_eq!(tracker.len(), 1);
        let items = tracker.list();
        match &items[0].1 {
            WorkDoneProgress::Report { percentage, .. } => {
                assert_eq!(*percentage, Some(50));
            }
            _ => panic!("expected Report"),
        }
    }

    #[test]
    fn test_tracker_remove() {
        let mut tracker = ProgressTracker::new();
        let token = ProgressToken::Number(7);

        tracker.update(
            token.clone(),
            WorkDoneProgress::Begin {
                title: "Building".into(),
                message: None,
                percentage: None,
                cancellable: None,
            },
        );

        assert_eq!(tracker.len(), 1);
        tracker.remove(&token);
        assert!(tracker.is_empty());
    }

    #[test]
    fn test_tracker_remove_nonexistent_is_noop() {
        let mut tracker = ProgressTracker::new();
        tracker.remove(&ProgressToken::Number(999));
        assert!(tracker.is_empty());
    }

    #[test]
    fn test_tracker_full_lifecycle() {
        let mut tracker = ProgressTracker::new();
        let token = ProgressToken::String("build-1".into());

        // Begin
        tracker.update(
            token.clone(),
            WorkDoneProgress::Begin {
                title: "Compiling".into(),
                message: Some("Starting...".into()),
                percentage: Some(0),
                cancellable: Some(true),
            },
        );
        assert_eq!(tracker.len(), 1);

        // Report
        tracker.update(
            token.clone(),
            WorkDoneProgress::Report {
                message: Some("50%".into()),
                percentage: Some(50),
                cancellable: Some(true),
            },
        );
        assert_eq!(tracker.len(), 1);

        // End
        tracker.update(
            token.clone(),
            WorkDoneProgress::End {
                message: Some("Done".into()),
            },
        );
        // End is still tracked until explicitly removed
        assert_eq!(tracker.len(), 1);

        tracker.remove(&token);
        assert!(tracker.is_empty());
    }

    // ---- parse_progress_notification ----

    #[test]
    fn test_parse_begin_notification_number_token() {
        let params = json!({
            "token": 1,
            "value": {
                "kind": "begin",
                "title": "Indexing",
                "message": "src/",
                "percentage": 0,
                "cancellable": false
            }
        });

        let (token, progress) = parse_progress_notification(&params).unwrap();
        assert_eq!(token, ProgressToken::Number(1));
        match progress {
            WorkDoneProgress::Begin {
                title,
                message,
                percentage,
                cancellable,
            } => {
                assert_eq!(title, "Indexing");
                assert_eq!(message, Some("src/".into()));
                assert_eq!(percentage, Some(0));
                assert_eq!(cancellable, Some(false));
            }
            _ => panic!("expected Begin"),
        }
    }

    #[test]
    fn test_parse_report_notification_string_token() {
        let params = json!({
            "token": "abc-123",
            "value": {
                "kind": "report",
                "message": "halfway there",
                "percentage": 50
            }
        });

        let (token, progress) = parse_progress_notification(&params).unwrap();
        assert_eq!(token, ProgressToken::String("abc-123".into()));
        match progress {
            WorkDoneProgress::Report {
                message,
                percentage,
                ..
            } => {
                assert_eq!(message, Some("halfway there".into()));
                assert_eq!(percentage, Some(50));
            }
            _ => panic!("expected Report"),
        }
    }

    #[test]
    fn test_parse_end_notification() {
        let params = json!({
            "token": 99,
            "value": {
                "kind": "end",
                "message": "Indexing complete"
            }
        });

        let (token, progress) = parse_progress_notification(&params).unwrap();
        assert_eq!(token, ProgressToken::Number(99));
        match progress {
            WorkDoneProgress::End { message } => {
                assert_eq!(message, Some("Indexing complete".into()));
            }
            _ => panic!("expected End"),
        }
    }

    #[test]
    fn test_parse_returns_none_for_missing_token() {
        let params = json!({
            "value": { "kind": "begin", "title": "X" }
        });
        assert!(parse_progress_notification(&params).is_none());
    }

    #[test]
    fn test_parse_returns_none_for_missing_value() {
        let params = json!({
            "token": 1
        });
        assert!(parse_progress_notification(&params).is_none());
    }

    #[test]
    fn test_parse_returns_none_for_bad_kind() {
        let params = json!({
            "token": 1,
            "value": { "kind": "invalid" }
        });
        assert!(parse_progress_notification(&params).is_none());
    }

    #[test]
    fn test_parse_returns_none_for_non_object() {
        let params = json!("not an object");
        assert!(parse_progress_notification(&params).is_none());
    }
}
