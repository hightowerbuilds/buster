//! buster-syntax — Incremental syntax highlighting service for the Buster IDE.
//!
//! Replaces `syntax/mod.rs` which reparses the entire document from scratch on
//! every keystroke. This crate maintains persistent Tree-sitter trees per document,
//! accepts incremental edits, and returns highlight spans for the visible viewport only.
//!
//! # Design
//!
//! - One `DocumentTree` per open file, holding a persistent `tree_sitter::Tree`
//! - Edits are applied via `tree.edit()` + incremental reparse (only changed ranges)
//! - Highlight queries return spans scoped to a viewport (start_line..end_line)
//! - `HighlightConfiguration` objects are held in `Arc`, not leaked via `Box::leak`
//! - Thread-safe: parse on background thread, query highlights on main thread
//!
//! Note: This crate defines the architecture and types. The actual tree-sitter
//! dependency is configured when integrating into Buster, since it requires
//! native grammar libraries (.so/.dylib) for each language.

mod document;
mod grammar;
mod highlight;
mod parser;
mod types;

pub use document::DocumentTree;
pub use grammar::{GrammarConfig, GrammarRegistry};
pub use highlight::{HighlightSpan, HighlightTheme, TokenKind};
pub use parser::{FallbackParser, ParseProvider};
pub use types::{EditRange, SyntaxError, ViewportRange};
