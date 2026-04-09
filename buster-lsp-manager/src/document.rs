use crate::types::{Position, Range};

/// A single text edit — a range replaced by new text.
///
/// This is the unit of incremental sync. Instead of sending the full document,
/// we send a list of TextEdits describing what changed.
#[derive(Debug, Clone)]
pub struct TextEdit {
    /// The range being replaced (in the document before this edit).
    pub range: Range,
    /// The new text that replaces the range. Empty string means deletion.
    pub new_text: String,
}

/// Tracks the state of an open document for LSP synchronization.
///
/// Maintains the current version number, content, and pending edits
/// that haven't been sent to the server yet.
pub struct DocumentState {
    /// The document URI.
    pub uri: String,
    /// The language ID (e.g., "rust", "typescript").
    pub language_id: String,
    /// Monotonically increasing version number, sent with each sync.
    pub version: i32,
    /// Current full content of the document.
    content: String,
    /// Precomputed line start byte offsets for fast line/column lookups.
    line_offsets: Vec<usize>,
    /// Pending incremental edits not yet sent to the server.
    pending_edits: Vec<TextEdit>,
}

impl DocumentState {
    /// Create a new document state from initial content.
    pub fn new(uri: String, language_id: String, content: String) -> Self {
        let line_offsets = compute_line_offsets(&content);
        Self {
            uri,
            language_id,
            version: 1,
            content,
            line_offsets,
            pending_edits: Vec::new(),
        }
    }

    /// Apply an edit to the document.
    ///
    /// Updates the internal content and records the edit for incremental sync.
    /// The caller provides the edit in terms of line/column positions.
    pub fn apply_edit(&mut self, range: Range, new_text: &str) {
        let start_offset = self.position_to_offset(range.start);
        let end_offset = self.position_to_offset(range.end);

        // Record the edit for incremental sync
        self.pending_edits.push(TextEdit {
            range,
            new_text: new_text.to_string(),
        });

        // Apply to content
        self.content
            .replace_range(start_offset..end_offset, new_text);
        self.line_offsets = compute_line_offsets(&self.content);
        self.version += 1;
    }

    /// Take pending edits for sending to the language server.
    /// Clears the pending list.
    pub fn take_pending_edits(&mut self) -> Vec<TextEdit> {
        std::mem::take(&mut self.pending_edits)
    }

    /// Check if there are unsent edits.
    pub fn has_pending_edits(&self) -> bool {
        !self.pending_edits.is_empty()
    }

    /// Get the current full content (for full-document sync fallback).
    pub fn content(&self) -> &str {
        &self.content
    }

    /// Convert a Position (line, column) to a byte offset.
    pub fn position_to_offset(&self, pos: Position) -> usize {
        let line = pos.line as usize;
        if line >= self.line_offsets.len() {
            return self.content.len();
        }
        let line_start = self.line_offsets[line];
        let col = pos.character_utf8 as usize;
        (line_start + col).min(self.content.len())
    }

    /// Convert a byte offset to a Position (line, column).
    pub fn offset_to_position(&self, offset: usize) -> Position {
        let offset = offset.min(self.content.len());

        // Binary search for the line containing this offset
        let line = match self.line_offsets.binary_search(&offset) {
            Ok(exact) => exact,
            Err(insert) => insert.saturating_sub(1),
        };

        let line_start = self.line_offsets[line];
        let character_utf8 = (offset - line_start) as u32;

        // Compute UTF-16 offset for the portion of the line up to this offset
        let line_slice = &self.content[line_start..offset];
        let character_utf16 = line_slice
            .chars()
            .map(|c| c.len_utf16() as u32)
            .sum();

        Position::with_utf16(line as u32, character_utf8, character_utf16)
    }

    /// Get the number of lines in the document.
    pub fn line_count(&self) -> usize {
        self.line_offsets.len()
    }
}

/// Compute byte offsets of each line start in the text.
fn compute_line_offsets(text: &str) -> Vec<usize> {
    let mut offsets = vec![0];
    for (i, byte) in text.bytes().enumerate() {
        if byte == b'\n' {
            offsets.push(i + 1);
        }
    }
    offsets
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_document() {
        let doc = DocumentState::new(
            "file:///test.ts".into(),
            "typescript".into(),
            "line one\nline two\nline three".into(),
        );
        assert_eq!(doc.version, 1);
        assert_eq!(doc.line_count(), 3);
    }

    #[test]
    fn test_apply_edit_records_pending() {
        let mut doc = DocumentState::new(
            "file:///test.ts".into(),
            "typescript".into(),
            "hello world".into(),
        );

        doc.apply_edit(
            Range::new(Position::new(0, 5), Position::new(0, 11)),
            " rust",
        );

        assert_eq!(doc.content(), "hello rust");
        assert_eq!(doc.version, 2);
        assert!(doc.has_pending_edits());

        let edits = doc.take_pending_edits();
        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].new_text, " rust");
        assert!(!doc.has_pending_edits());
    }

    #[test]
    fn test_multiline_edit() {
        let mut doc = DocumentState::new(
            "file:///test.ts".into(),
            "typescript".into(),
            "line one\nline two\nline three".into(),
        );

        // Replace "line two" with "replaced"
        doc.apply_edit(
            Range::new(Position::new(1, 0), Position::new(1, 8)),
            "replaced",
        );

        assert_eq!(doc.content(), "line one\nreplaced\nline three");
    }

    #[test]
    fn test_position_to_offset() {
        let doc = DocumentState::new(
            "file:///test.ts".into(),
            "typescript".into(),
            "abc\ndef\nghi".into(),
        );

        assert_eq!(doc.position_to_offset(Position::new(0, 0)), 0);
        assert_eq!(doc.position_to_offset(Position::new(0, 3)), 3);
        assert_eq!(doc.position_to_offset(Position::new(1, 0)), 4);
        assert_eq!(doc.position_to_offset(Position::new(2, 2)), 10);
    }

    #[test]
    fn test_offset_to_position() {
        let doc = DocumentState::new(
            "file:///test.ts".into(),
            "typescript".into(),
            "abc\ndef\nghi".into(),
        );

        let pos = doc.offset_to_position(4);
        assert_eq!(pos.line, 1);
        assert_eq!(pos.character_utf8, 0);

        let pos = doc.offset_to_position(10);
        assert_eq!(pos.line, 2);
        assert_eq!(pos.character_utf8, 2);
    }

    #[test]
    fn test_insertion_edit() {
        let mut doc = DocumentState::new(
            "file:///test.ts".into(),
            "typescript".into(),
            "helloworld".into(),
        );

        // Insert " " between "hello" and "world"
        doc.apply_edit(
            Range::new(Position::new(0, 5), Position::new(0, 5)),
            " ",
        );

        assert_eq!(doc.content(), "hello world");
    }

    #[test]
    fn test_deletion_edit() {
        let mut doc = DocumentState::new(
            "file:///test.ts".into(),
            "typescript".into(),
            "hello world".into(),
        );

        // Delete " world"
        doc.apply_edit(
            Range::new(Position::new(0, 5), Position::new(0, 11)),
            "",
        );

        assert_eq!(doc.content(), "hello");
    }
}
