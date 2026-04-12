//! Helper functions that build JSON-RPC params for LSP request methods.
//!
//! Each function returns a `serde_json::Value` ready to be passed as the
//! `params` argument to `ServerHandle::send_request`.

use serde_json::{json, Value};

use crate::types::{CallHierarchyItem, TypeHierarchyItem};

// ---------------------------------------------------------------------------
// workspace/symbol
// ---------------------------------------------------------------------------

/// Build params for `workspace/symbol`.
pub fn workspace_symbol_params(query: &str) -> Value {
    json!({
        "query": query
    })
}

// ---------------------------------------------------------------------------
// callHierarchy
// ---------------------------------------------------------------------------

/// Build params for `textDocument/prepareCallHierarchy`.
pub fn call_hierarchy_prepare_params(uri: &str, line: u32, character: u32) -> Value {
    json!({
        "textDocument": { "uri": uri },
        "position": { "line": line, "character": character }
    })
}

/// Build params for `callHierarchy/incomingCalls`.
pub fn call_hierarchy_incoming_params(item: &CallHierarchyItem) -> Value {
    json!({
        "item": item_to_value(item)
    })
}

/// Build params for `callHierarchy/outgoingCalls`.
pub fn call_hierarchy_outgoing_params(item: &CallHierarchyItem) -> Value {
    json!({
        "item": item_to_value(item)
    })
}

fn item_to_value(item: &CallHierarchyItem) -> Value {
    // Serialize via serde so all field renames (selectionRange, etc.) are honored.
    serde_json::to_value(item).unwrap_or(Value::Null)
}

// ---------------------------------------------------------------------------
// typeHierarchy
// ---------------------------------------------------------------------------

/// Build params for `textDocument/prepareTypeHierarchy`.
pub fn type_hierarchy_prepare_params(uri: &str, line: u32, character: u32) -> Value {
    json!({
        "textDocument": { "uri": uri },
        "position": { "line": line, "character": character }
    })
}

/// Build params for `typeHierarchy/supertypes`.
pub fn type_hierarchy_supertypes_params(item: &TypeHierarchyItem) -> Value {
    json!({
        "item": type_item_to_value(item)
    })
}

/// Build params for `typeHierarchy/subtypes`.
pub fn type_hierarchy_subtypes_params(item: &TypeHierarchyItem) -> Value {
    json!({
        "item": type_item_to_value(item)
    })
}

fn type_item_to_value(item: &TypeHierarchyItem) -> Value {
    serde_json::to_value(item).unwrap_or(Value::Null)
}

// ---------------------------------------------------------------------------
// semanticTokens
// ---------------------------------------------------------------------------

/// Build params for `textDocument/semanticTokens/full`.
pub fn semantic_tokens_full_params(uri: &str) -> Value {
    json!({
        "textDocument": { "uri": uri }
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{CallHierarchyItem, Position, Range, SymbolKind, TypeHierarchyItem};

    #[test]
    fn test_workspace_symbol_params() {
        let params = workspace_symbol_params("MyClass");
        assert_eq!(params["query"], "MyClass");
    }

    #[test]
    fn test_workspace_symbol_params_empty_query() {
        let params = workspace_symbol_params("");
        assert_eq!(params["query"], "");
    }

    #[test]
    fn test_call_hierarchy_prepare_params() {
        let params = call_hierarchy_prepare_params("file:///src/main.rs", 10, 5);
        assert_eq!(params["textDocument"]["uri"], "file:///src/main.rs");
        assert_eq!(params["position"]["line"], 10);
        assert_eq!(params["position"]["character"], 5);
    }

    #[test]
    fn test_call_hierarchy_incoming_params_roundtrip() {
        let item = make_call_item();
        let params = call_hierarchy_incoming_params(&item);
        let item_val = &params["item"];

        assert_eq!(item_val["name"], "foo");
        assert_eq!(item_val["uri"], "file:///test.rs");
        // selectionRange should be serialized as camelCase
        assert!(item_val.get("selectionRange").is_some());
    }

    #[test]
    fn test_call_hierarchy_outgoing_params_roundtrip() {
        let item = make_call_item();
        let params = call_hierarchy_outgoing_params(&item);
        assert_eq!(params["item"]["name"], "foo");
    }

    #[test]
    fn test_type_hierarchy_prepare_params() {
        let params = type_hierarchy_prepare_params("file:///src/lib.rs", 42, 0);
        assert_eq!(params["textDocument"]["uri"], "file:///src/lib.rs");
        assert_eq!(params["position"]["line"], 42);
        assert_eq!(params["position"]["character"], 0);
    }

    #[test]
    fn test_type_hierarchy_supertypes_params() {
        let item = make_type_item();
        let params = type_hierarchy_supertypes_params(&item);
        assert_eq!(params["item"]["name"], "Bar");
    }

    #[test]
    fn test_type_hierarchy_subtypes_params() {
        let item = make_type_item();
        let params = type_hierarchy_subtypes_params(&item);
        assert_eq!(params["item"]["name"], "Bar");
        assert!(params["item"].get("selectionRange").is_some());
    }

    #[test]
    fn test_semantic_tokens_full_params() {
        let params = semantic_tokens_full_params("file:///src/main.rs");
        assert_eq!(params["textDocument"]["uri"], "file:///src/main.rs");
    }

    #[test]
    fn test_semantic_tokens_full_params_roundtrip() {
        let params = semantic_tokens_full_params("file:///test.ts");
        // Should be deserializable as SemanticTokensParams
        let parsed: crate::types::SemanticTokensParams =
            serde_json::from_value(params).unwrap();
        assert_eq!(parsed.text_document.uri, "file:///test.ts");
    }

    // ---- helpers ----

    fn make_call_item() -> CallHierarchyItem {
        let range = Range::new(Position::new(1, 0), Position::new(1, 10));
        CallHierarchyItem {
            name: "foo".into(),
            kind: SymbolKind::Function,
            uri: "file:///test.rs".into(),
            range,
            selection_range: range,
        }
    }

    fn make_type_item() -> TypeHierarchyItem {
        let range = Range::new(Position::new(5, 0), Position::new(5, 8));
        TypeHierarchyItem {
            name: "Bar".into(),
            kind: SymbolKind::Class,
            uri: "file:///test.rs".into(),
            range,
            selection_range: range,
        }
    }
}
