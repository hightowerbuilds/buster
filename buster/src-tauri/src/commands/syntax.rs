use tauri::{command, State};

use crate::syntax::SyntaxService;
use buster_syntax::{EditRange, HighlightSpan as BusterSpan};

/// Highlight code with viewport scoping (new per-line format).
///
/// If the file was previously opened via `syntax_open`, uses the cached
/// DocumentTree for fast viewport-scoped highlighting. Otherwise falls
/// back to a stateless parse.
#[command]
pub fn highlight_code(
    state: State<'_, SyntaxService>,
    file_path: String,
    source: String,
    start_line: usize,
    end_line: usize,
) -> Result<Vec<BusterSpan>, String> {
    // Try the document-backed path first
    let spans = state.highlight_viewport(&file_path, start_line, end_line);
    if !spans.is_empty() {
        return Ok(spans);
    }

    // Stateless fallback: parse from scratch, return viewport slice
    let ext = SyntaxService::get_extension(&file_path);
    Ok(state.highlight_viewport_stateless(&source, &ext, start_line, end_line))
}

/// Open a document for incremental syntax highlighting.
#[command]
pub fn syntax_open(
    state: State<'_, SyntaxService>,
    file_path: String,
    content: String,
) -> Result<(), String> {
    state.open_document(&file_path, content);
    Ok(())
}

/// Close a document, freeing its parse tree.
#[command]
pub fn syntax_close(
    state: State<'_, SyntaxService>,
    file_path: String,
) -> Result<(), String> {
    state.close_document(&file_path);
    Ok(())
}

/// Apply an incremental edit to an open document.
#[command]
pub fn syntax_edit(
    state: State<'_, SyntaxService>,
    file_path: String,
    start_byte: usize,
    old_end_byte: usize,
    new_end_byte: usize,
    start_row: usize,
    start_col: usize,
    old_end_row: usize,
    old_end_col: usize,
    new_end_row: usize,
    new_end_col: usize,
    new_text: String,
) -> Result<(), String> {
    let edit = EditRange {
        start_byte,
        old_end_byte,
        new_end_byte,
        start_position: (start_row, start_col),
        old_end_position: (old_end_row, old_end_col),
        new_end_position: (new_end_row, new_end_col),
    };
    state.edit_document(&file_path, edit, &new_text);
    Ok(())
}

/// List all loaded syntax grammars (compiled + runtime).
#[command]
pub fn syntax_languages(state: State<'_, SyntaxService>) -> Result<Vec<String>, String> {
    Ok(state.loaded_languages())
}
