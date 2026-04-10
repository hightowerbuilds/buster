use serde::{Deserialize, Serialize};

/// LSP errors with clear context for debugging.
#[derive(Debug, thiserror::Error)]
pub enum LspError {
    #[error("server not found for language: {language}")]
    ServerNotFound { language: String },

    #[error("server crashed: {name} (restarts: {restarts})")]
    ServerCrashed { name: String, restarts: u32 },

    #[error("server failed to start: {name}: {reason}")]
    ServerStartFailed { name: String, reason: String },

    #[error("request timed out: method={method}, id={id}")]
    RequestTimeout { method: String, id: String },

    #[error("transport error: {0}")]
    Transport(String),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// A position in a text document.
///
/// LSP uses zero-based line and character offsets.
/// Many servers expect UTF-16 character offsets, but editors work in UTF-8.
/// This type carries both to avoid conversion bugs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    /// Zero-based line number.
    pub line: u32,
    /// Zero-based character offset (UTF-8 byte offset within the line).
    pub character_utf8: u32,
    /// Zero-based character offset (UTF-16 code unit offset within the line).
    /// Computed from UTF-8 offset when needed. Differs from UTF-8 for characters
    /// outside the Basic Multilingual Plane (emoji, some CJK).
    pub character_utf16: u32,
}

impl Position {
    pub fn new(line: u32, character_utf8: u32) -> Self {
        Self {
            line,
            character_utf8,
            character_utf16: character_utf8, // caller should compute if needed
        }
    }

    /// Create a position with explicit UTF-16 offset.
    pub fn with_utf16(line: u32, character_utf8: u32, character_utf16: u32) -> Self {
        Self {
            line,
            character_utf8,
            character_utf16,
        }
    }
}

/// A range in a text document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

impl Range {
    pub fn new(start: Position, end: Position) -> Self {
        Self { start, end }
    }
}

/// A diagnostic (error, warning, etc.) reported by a language server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub range: Range,
    pub severity: DiagnosticSeverity,
    pub message: String,
    pub source: Option<String>,
    pub code: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiagnosticSeverity {
    Error = 1,
    Warning = 2,
    Information = 3,
    Hint = 4,
}

// ---------------------------------------------------------------------------
// workspace/symbol
// ---------------------------------------------------------------------------

/// Parameters for the `workspace/symbol` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSymbolParams {
    /// A query string to filter symbols by.
    pub query: String,
}

/// The kind of a symbol (matches LSP SymbolKind numeric values).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde_repr::Serialize_repr, serde_repr::Deserialize_repr)]
#[repr(u8)]
pub enum SymbolKind {
    File = 1,
    Module = 2,
    Namespace = 3,
    Package = 4,
    Class = 5,
    Method = 6,
    Property = 7,
    Field = 8,
    Constructor = 9,
    Enum = 10,
    Interface = 11,
    Function = 12,
    Variable = 13,
    Constant = 14,
    String = 15,
    Number = 16,
    Boolean = 17,
    Array = 18,
    Object = 19,
    Key = 20,
    Null = 21,
    EnumMember = 22,
    Struct = 23,
    Event = 24,
    Operator = 25,
    TypeParameter = 26,
}

/// A location in a text document (URI + range).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Location {
    pub uri: String,
    pub range: Range,
}

/// Information about a symbol found by `workspace/symbol`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolInformation {
    pub name: String,
    pub kind: SymbolKind,
    pub location: Location,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container_name: Option<String>,
}

/// An identifier for a text document (just the URI).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextDocumentIdentifier {
    pub uri: String,
}

// ---------------------------------------------------------------------------
// callHierarchy
// ---------------------------------------------------------------------------

/// An item in the call hierarchy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallHierarchyItem {
    pub name: String,
    pub kind: SymbolKind,
    pub uri: String,
    pub range: Range,
    #[serde(rename = "selectionRange")]
    pub selection_range: Range,
}

/// An incoming call — who calls the target item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallHierarchyIncomingCall {
    pub from: CallHierarchyItem,
    #[serde(rename = "fromRanges")]
    pub from_ranges: Vec<Range>,
}

/// An outgoing call — what the source item calls.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallHierarchyOutgoingCall {
    pub to: CallHierarchyItem,
    #[serde(rename = "fromRanges")]
    pub from_ranges: Vec<Range>,
}

// ---------------------------------------------------------------------------
// typeHierarchy
// ---------------------------------------------------------------------------

/// An item in the type hierarchy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeHierarchyItem {
    pub name: String,
    pub kind: SymbolKind,
    pub uri: String,
    pub range: Range,
    #[serde(rename = "selectionRange")]
    pub selection_range: Range,
}

// ---------------------------------------------------------------------------
// semanticTokens
// ---------------------------------------------------------------------------

/// Parameters for `textDocument/semanticTokens/full`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticTokensParams {
    #[serde(rename = "textDocument")]
    pub text_document: TextDocumentIdentifier,
}

/// The result of a semantic tokens request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticTokens {
    /// An optional result ID for delta requests.
    #[serde(rename = "resultId", skip_serializing_if = "Option::is_none")]
    pub result_id: Option<String>,
    /// The actual token data, encoded as groups of 5 integers:
    /// [deltaLine, deltaStartChar, length, tokenType, tokenModifiers]
    pub data: Vec<u32>,
}

/// Legend describing the token types and modifiers a server uses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticTokensLegend {
    #[serde(rename = "tokenTypes")]
    pub token_types: Vec<String>,
    #[serde(rename = "tokenModifiers")]
    pub token_modifiers: Vec<String>,
}

/// A single decoded semantic token (decoded from the delta-encoded `data` array).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedSemanticToken {
    /// Absolute zero-based line number.
    pub line: u32,
    /// Absolute zero-based start character on the line.
    pub start_char: u32,
    /// Length of the token in characters.
    pub length: u32,
    /// Index into `SemanticTokensLegend.token_types`.
    pub token_type: u32,
    /// Bitmask into `SemanticTokensLegend.token_modifiers`.
    pub token_modifiers: u32,
}

/// Decode the delta-encoded `data` array from a `SemanticTokens` response
/// into absolute-position tokens.
pub fn decode_semantic_tokens(data: &[u32]) -> Vec<DecodedSemanticToken> {
    let mut tokens = Vec::with_capacity(data.len() / 5);
    let mut current_line: u32 = 0;
    let mut current_start: u32 = 0;

    for chunk in data.chunks_exact(5) {
        let delta_line = chunk[0];
        let delta_start = chunk[1];
        let length = chunk[2];
        let token_type = chunk[3];
        let token_modifiers = chunk[4];

        if delta_line > 0 {
            current_line += delta_line;
            current_start = delta_start;
        } else {
            current_start += delta_start;
        }

        tokens.push(DecodedSemanticToken {
            line: current_line,
            start_char: current_start,
            length,
            token_type,
            token_modifiers,
        });
    }

    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- SymbolKind discriminant values ----

    #[test]
    fn test_symbol_kind_values() {
        assert_eq!(SymbolKind::File as u8, 1);
        assert_eq!(SymbolKind::Module as u8, 2);
        assert_eq!(SymbolKind::Namespace as u8, 3);
        assert_eq!(SymbolKind::Package as u8, 4);
        assert_eq!(SymbolKind::Class as u8, 5);
        assert_eq!(SymbolKind::Method as u8, 6);
        assert_eq!(SymbolKind::Property as u8, 7);
        assert_eq!(SymbolKind::Field as u8, 8);
        assert_eq!(SymbolKind::Constructor as u8, 9);
        assert_eq!(SymbolKind::Enum as u8, 10);
        assert_eq!(SymbolKind::Interface as u8, 11);
        assert_eq!(SymbolKind::Function as u8, 12);
        assert_eq!(SymbolKind::Variable as u8, 13);
        assert_eq!(SymbolKind::Constant as u8, 14);
        assert_eq!(SymbolKind::String as u8, 15);
        assert_eq!(SymbolKind::Number as u8, 16);
        assert_eq!(SymbolKind::Boolean as u8, 17);
        assert_eq!(SymbolKind::Array as u8, 18);
        assert_eq!(SymbolKind::Object as u8, 19);
        assert_eq!(SymbolKind::Key as u8, 20);
        assert_eq!(SymbolKind::Null as u8, 21);
        assert_eq!(SymbolKind::EnumMember as u8, 22);
        assert_eq!(SymbolKind::Struct as u8, 23);
        assert_eq!(SymbolKind::Event as u8, 24);
        assert_eq!(SymbolKind::Operator as u8, 25);
        assert_eq!(SymbolKind::TypeParameter as u8, 26);
    }

    #[test]
    fn test_symbol_kind_serialize_as_number() {
        let kind = SymbolKind::Function;
        let json = serde_json::to_value(kind).unwrap();
        assert_eq!(json, serde_json::json!(12));
    }

    #[test]
    fn test_symbol_kind_deserialize_from_number() {
        let kind: SymbolKind = serde_json::from_value(serde_json::json!(5)).unwrap();
        assert_eq!(kind, SymbolKind::Class);
    }

    // ---- SymbolInformation roundtrip ----

    #[test]
    fn test_symbol_information_roundtrip() {
        let sym = SymbolInformation {
            name: "MyClass".into(),
            kind: SymbolKind::Class,
            location: Location {
                uri: "file:///src/lib.rs".into(),
                range: Range::new(Position::new(10, 0), Position::new(10, 7)),
            },
            container_name: Some("my_module".into()),
        };

        let json = serde_json::to_value(&sym).unwrap();
        let back: SymbolInformation = serde_json::from_value(json).unwrap();
        assert_eq!(back.name, "MyClass");
        assert_eq!(back.kind, SymbolKind::Class);
        assert_eq!(back.container_name, Some("my_module".into()));
    }

    #[test]
    fn test_symbol_information_no_container() {
        let sym = SymbolInformation {
            name: "main".into(),
            kind: SymbolKind::Function,
            location: Location {
                uri: "file:///main.rs".into(),
                range: Range::new(Position::new(0, 0), Position::new(0, 4)),
            },
            container_name: None,
        };

        let json = serde_json::to_value(&sym).unwrap();
        // container_name should be omitted
        assert!(json.get("container_name").is_none());
    }

    // ---- Semantic tokens decoding ----

    #[test]
    fn test_decode_semantic_tokens_empty() {
        let tokens = decode_semantic_tokens(&[]);
        assert!(tokens.is_empty());
    }

    #[test]
    fn test_decode_semantic_tokens_single() {
        // One token: line 0, char 5, length 3, type 0, modifiers 0
        let data = vec![0, 5, 3, 0, 0];
        let tokens = decode_semantic_tokens(&data);

        assert_eq!(tokens.len(), 1);
        assert_eq!(
            tokens[0],
            DecodedSemanticToken {
                line: 0,
                start_char: 5,
                length: 3,
                token_type: 0,
                token_modifiers: 0,
            }
        );
    }

    #[test]
    fn test_decode_semantic_tokens_same_line() {
        // Two tokens on line 0:
        // Token 1: deltaLine=0, deltaStart=0, len=3, type=1, mod=0
        // Token 2: deltaLine=0, deltaStart=5, len=4, type=2, mod=1
        let data = vec![0, 0, 3, 1, 0, 0, 5, 4, 2, 1];
        let tokens = decode_semantic_tokens(&data);

        assert_eq!(tokens.len(), 2);
        assert_eq!(tokens[0].line, 0);
        assert_eq!(tokens[0].start_char, 0);
        assert_eq!(tokens[0].length, 3);
        assert_eq!(tokens[0].token_type, 1);

        assert_eq!(tokens[1].line, 0);
        assert_eq!(tokens[1].start_char, 5);
        assert_eq!(tokens[1].length, 4);
        assert_eq!(tokens[1].token_type, 2);
        assert_eq!(tokens[1].token_modifiers, 1);
    }

    #[test]
    fn test_decode_semantic_tokens_multi_line() {
        // Token 1: line 0, char 0, len 2, type 0, mod 0
        // Token 2: line 2, char 4, len 5, type 3, mod 0  (deltaLine=2)
        // Token 3: line 2, char 10, len 1, type 1, mod 2 (deltaLine=0, deltaStart=6)
        let data = vec![0, 0, 2, 0, 0, 2, 4, 5, 3, 0, 0, 6, 1, 1, 2];
        let tokens = decode_semantic_tokens(&data);

        assert_eq!(tokens.len(), 3);

        assert_eq!(tokens[0].line, 0);
        assert_eq!(tokens[0].start_char, 0);

        assert_eq!(tokens[1].line, 2);
        assert_eq!(tokens[1].start_char, 4);
        assert_eq!(tokens[1].token_type, 3);

        assert_eq!(tokens[2].line, 2);
        assert_eq!(tokens[2].start_char, 10);
        assert_eq!(tokens[2].token_type, 1);
        assert_eq!(tokens[2].token_modifiers, 2);
    }

    #[test]
    fn test_decode_semantic_tokens_ignores_trailing_incomplete() {
        // 7 values: first 5 form a token, last 2 are ignored by chunks_exact
        let data = vec![0, 0, 3, 0, 0, 1, 2];
        let tokens = decode_semantic_tokens(&data);
        assert_eq!(tokens.len(), 1);
    }

    // ---- SemanticTokens serde roundtrip ----

    #[test]
    fn test_semantic_tokens_roundtrip() {
        let tokens = SemanticTokens {
            result_id: Some("v1".into()),
            data: vec![0, 5, 3, 0, 0, 1, 0, 4, 2, 1],
        };
        let json = serde_json::to_value(&tokens).unwrap();
        assert_eq!(json["resultId"], "v1");

        let back: SemanticTokens = serde_json::from_value(json).unwrap();
        assert_eq!(back.result_id, Some("v1".into()));
        assert_eq!(back.data.len(), 10);
    }

    #[test]
    fn test_semantic_tokens_no_result_id() {
        let tokens = SemanticTokens {
            result_id: None,
            data: vec![0, 0, 1, 0, 0],
        };
        let json = serde_json::to_value(&tokens).unwrap();
        // resultId should be omitted entirely
        assert!(json.get("resultId").is_none());
    }

    // ---- SemanticTokensLegend ----

    #[test]
    fn test_semantic_tokens_legend_roundtrip() {
        let legend = SemanticTokensLegend {
            token_types: vec!["keyword".into(), "variable".into(), "function".into()],
            token_modifiers: vec!["declaration".into(), "readonly".into()],
        };
        let json = serde_json::to_value(&legend).unwrap();
        assert_eq!(json["tokenTypes"][0], "keyword");
        assert_eq!(json["tokenModifiers"][1], "readonly");

        let back: SemanticTokensLegend = serde_json::from_value(json).unwrap();
        assert_eq!(back.token_types.len(), 3);
        assert_eq!(back.token_modifiers.len(), 2);
    }

    // ---- CallHierarchyItem serde ----

    #[test]
    fn test_call_hierarchy_item_roundtrip() {
        let item = CallHierarchyItem {
            name: "process".into(),
            kind: SymbolKind::Method,
            uri: "file:///app.rs".into(),
            range: Range::new(Position::new(5, 0), Position::new(10, 1)),
            selection_range: Range::new(Position::new(5, 7), Position::new(5, 14)),
        };

        let json = serde_json::to_value(&item).unwrap();
        // Check camelCase serialization
        assert!(json.get("selectionRange").is_some());
        assert!(json.get("selection_range").is_none());

        let back: CallHierarchyItem = serde_json::from_value(json).unwrap();
        assert_eq!(back.name, "process");
        assert_eq!(back.kind, SymbolKind::Method);
    }

    // ---- TypeHierarchyItem serde ----

    #[test]
    fn test_type_hierarchy_item_roundtrip() {
        let item = TypeHierarchyItem {
            name: "Animal".into(),
            kind: SymbolKind::Interface,
            uri: "file:///types.ts".into(),
            range: Range::new(Position::new(0, 0), Position::new(5, 1)),
            selection_range: Range::new(Position::new(0, 10), Position::new(0, 16)),
        };

        let json = serde_json::to_value(&item).unwrap();
        assert!(json.get("selectionRange").is_some());

        let back: TypeHierarchyItem = serde_json::from_value(json).unwrap();
        assert_eq!(back.name, "Animal");
        assert_eq!(back.kind, SymbolKind::Interface);
    }
}
