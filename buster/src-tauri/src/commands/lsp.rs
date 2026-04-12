use tauri::{command, State};
use tokio::time::{timeout, Duration};

use std::path::Path;

use crate::lsp::LspManager;
use crate::lsp::language_id_for_ext;
use buster_lsp_manager::{path_to_lsp_uri, lsp_uri_to_path};

const LSP_TIMEOUT_SECS: u64 = 10;

#[derive(Debug, Clone, serde::Serialize)]
pub struct LspCompletionItem {
    pub label: String,
    pub detail: Option<String>,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LspHoverResult {
    pub contents: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LspLocation {
    pub file_path: String,
    pub line: u32,
    pub col: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LspSignatureParam {
    pub label: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LspSignatureHelp {
    pub label: String,
    pub active_parameter: u32,
    pub parameters: Vec<LspSignatureParam>,
    pub documentation: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LspTextEdit {
    pub file_path: String,
    pub start_line: u32,
    pub start_col: u32,
    pub end_line: u32,
    pub end_col: u32,
    pub new_text: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LspCodeAction {
    pub title: String,
    pub kind: String,
    pub index: usize,
    pub edits: Vec<LspTextEdit>,
}

fn ext_from_path(path: &str) -> Option<String> {
    path.rsplit('.').next().map(|s| s.to_lowercase())
}

fn uri_from_path(path: &str) -> String {
    path_to_lsp_uri(Path::new(path))
        .unwrap_or_else(|_| format!("file://{}", path))
}

fn path_from_uri(uri: &str) -> String {
    lsp_uri_to_path(uri)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| uri.strip_prefix("file://").unwrap_or(uri).to_string())
}

/// Start the LSP server for a file and send didOpen.
#[command]
pub async fn lsp_start(
    lsp: State<'_, LspManager>,
    file_path: String,
    workspace_root: String,
) -> Result<bool, String> {
    let ext = ext_from_path(&file_path).ok_or("No extension")?;
    let lang_id = language_id_for_ext(&ext).ok_or("Unsupported language")?;

    // Try to start the server (may already be running)
    lsp.ensure_server(&ext, &workspace_root).await?;

    // Send didOpen — read the file from disk for initial content
    let uri = uri_from_path(&file_path);
    let text = std::fs::read_to_string(&file_path).unwrap_or_default();

    lsp.get_client(lang_id, |client| {
        client.did_open(&uri, lang_id, &text)
    })?;

    // Create document state for incremental sync tracking
    lsp.open_document(&uri, lang_id, &text)?;

    Ok(true)
}

/// Notify LSP of document change (full sync fallback).
/// Resets the tracked DocumentState so it stays in sync.
#[command]
pub fn lsp_did_change(
    lsp: State<'_, LspManager>,
    file_path: String,
    text: String,
    version: i32,
) -> Result<(), String> {
    let ext = ext_from_path(&file_path).ok_or("No extension")?;
    let lang_id = language_id_for_ext(&ext).ok_or("Unsupported language")?;
    let uri = uri_from_path(&file_path);

    lsp.get_client(lang_id, |client| {
        client.did_change(&uri, version, &text)
    })?;

    // Keep the tracked document state in sync with the full content
    lsp.reset_document_content(&uri, &text)?;

    Ok(())
}

/// A single incremental edit delta from the editor engine.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditDelta {
    pub start_line: u32,
    pub start_col: u32,
    pub end_line: u32,
    pub end_col: u32,
    pub new_text: String,
}

/// Notify LSP of incremental document change.
/// Applies each EditDelta to the tracked DocumentState, then sends the
/// pending edits as incremental content changes to the language server.
/// The `version` parameter from the frontend is accepted but ignored;
/// the DocumentState maintains the authoritative version number.
#[allow(unused_variables)]
#[command]
pub fn lsp_did_change_incremental(
    lsp: State<'_, LspManager>,
    file_path: String,
    edits: Vec<EditDelta>,
    version: i32,
) -> Result<(), String> {
    let ext = ext_from_path(&file_path).ok_or("No extension")?;
    let lang_id = language_id_for_ext(&ext).ok_or("Unsupported language")?;
    let uri = uri_from_path(&file_path);

    // Apply edits to the tracked document state and get the authoritative
    // version + pending TextEdits to send to the server.
    let (doc_version, pending_edits) = lsp.apply_incremental_edits(&uri, &edits)?;

    // Convert buster_lsp_manager::TextEdit into the EditDelta format that
    // LspClient::did_change_incremental expects.
    let deltas: Vec<EditDelta> = pending_edits
        .iter()
        .map(|te| EditDelta {
            start_line: te.range.start.line,
            start_col: te.range.start.character_utf8,
            end_line: te.range.end.line,
            end_col: te.range.end.character_utf8,
            new_text: te.new_text.clone(),
        })
        .collect();

    lsp.get_client(lang_id, |client| {
        client.did_change_incremental(&uri, doc_version, &deltas)
    })
}

/// Notify LSP of document save.
#[command]
pub fn lsp_did_save(
    lsp: State<'_, LspManager>,
    file_path: String,
) -> Result<(), String> {
    let ext = ext_from_path(&file_path).ok_or("No extension")?;
    let lang_id = language_id_for_ext(&ext).ok_or("Unsupported language")?;
    let uri = uri_from_path(&file_path);

    lsp.get_client(lang_id, |client| {
        client.did_save(&uri)
    })
}

/// Notify LSP that a document was closed. Removes the tracked DocumentState.
#[command]
pub fn lsp_did_close(
    lsp: State<'_, LspManager>,
    file_path: String,
) -> Result<(), String> {
    let ext = ext_from_path(&file_path).ok_or("No extension")?;
    let lang_id = language_id_for_ext(&ext).ok_or("Unsupported language")?;
    let uri = uri_from_path(&file_path);

    lsp.get_client(lang_id, |client| {
        client.did_close(&uri)
    })?;

    // Remove the tracked document state
    lsp.close_document(&uri)?;

    Ok(())
}

/// Request completions from LSP.
#[command]
pub async fn lsp_completion(
    lsp: State<'_, LspManager>,
    file_path: String,
    line: u32,
    col: u32,
) -> Result<Vec<LspCompletionItem>, String> {
    let ext = ext_from_path(&file_path).ok_or("No extension")?;
    let lang_id = language_id_for_ext(&ext).ok_or("Unsupported language")?;
    let uri = uri_from_path(&file_path);

    let rx = lsp.get_client(lang_id, |client| {
        client.completion(&uri, line, col)
    })?;

    let resp = timeout(Duration::from_secs(LSP_TIMEOUT_SECS), rx)
        .await
        .map_err(|_| "LSP completion request timed out".to_string())?
        .map_err(|_| "LSP completion request failed".to_string())?;

    // Parse completion response
    let mut items = Vec::new();
    let result = resp.get("result").unwrap_or(&serde_json::Value::Null);

    let completion_items = if let Some(arr) = result.as_array() {
        arr.clone()
    } else if let Some(list) = result.get("items").and_then(|v| v.as_array()) {
        list.clone()
    } else {
        Vec::new()
    };

    for item in &completion_items {
        items.push(LspCompletionItem {
            label: item.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            detail: item.get("detail").and_then(|v| v.as_str()).map(String::from),
            kind: item.get("kind").and_then(|v| v.as_u64()).map(|k| completion_kind_name(k)),
        });
    }

    items.truncate(50);
    Ok(items)
}

/// Request hover info from LSP.
#[command]
pub async fn lsp_hover(
    lsp: State<'_, LspManager>,
    file_path: String,
    line: u32,
    col: u32,
) -> Result<LspHoverResult, String> {
    let ext = ext_from_path(&file_path).ok_or("No extension")?;
    let lang_id = language_id_for_ext(&ext).ok_or("Unsupported language")?;
    let uri = uri_from_path(&file_path);

    let rx = lsp.get_client(lang_id, |client| {
        client.hover(&uri, line, col)
    })?;

    let resp = timeout(Duration::from_secs(LSP_TIMEOUT_SECS), rx)
        .await
        .map_err(|_| "LSP hover request timed out".to_string())?
        .map_err(|_| "LSP hover request failed".to_string())?;

    let result = resp.get("result").unwrap_or(&serde_json::Value::Null);
    if result.is_null() {
        return Ok(LspHoverResult { contents: String::new() });
    }

    let contents = if let Some(contents) = result.get("contents") {
        if let Some(s) = contents.as_str() {
            s.to_string()
        } else if let Some(obj) = contents.as_object() {
            obj.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string()
        } else if let Some(arr) = contents.as_array() {
            arr.iter()
                .filter_map(|v| {
                    if let Some(s) = v.as_str() { Some(s.to_string()) }
                    else if let Some(obj) = v.as_object() {
                        obj.get("value").and_then(|v| v.as_str()).map(String::from)
                    } else { None }
                })
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    Ok(LspHoverResult { contents })
}

/// Request go-to-definition from LSP.
#[command]
pub async fn lsp_definition(
    lsp: State<'_, LspManager>,
    file_path: String,
    line: u32,
    col: u32,
) -> Result<Vec<LspLocation>, String> {
    let ext = ext_from_path(&file_path).ok_or("No extension")?;
    let lang_id = language_id_for_ext(&ext).ok_or("Unsupported language")?;
    let uri = uri_from_path(&file_path);

    let rx = lsp.get_client(lang_id, |client| {
        client.definition(&uri, line, col)
    })?;

    let resp = timeout(Duration::from_secs(LSP_TIMEOUT_SECS), rx)
        .await
        .map_err(|_| "LSP definition request timed out".to_string())?
        .map_err(|_| "LSP definition request failed".to_string())?;

    let result = resp.get("result").unwrap_or(&serde_json::Value::Null);
    let mut locations = Vec::new();

    let parse_location = |loc: &serde_json::Value| -> Option<LspLocation> {
        let uri = loc.get("uri")?.as_str()?;
        let range = loc.get("range")?;
        let start = range.get("start")?;
        Some(LspLocation {
            file_path: path_from_uri(uri),
            line: start.get("line")?.as_u64()? as u32,
            col: start.get("character")?.as_u64()? as u32,
        })
    };

    if let Some(arr) = result.as_array() {
        for loc in arr {
            if let Some(l) = parse_location(loc) {
                locations.push(l);
            }
        }
    } else if result.is_object() {
        if let Some(l) = parse_location(result) {
            locations.push(l);
        }
    }

    Ok(locations)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LspInlayHint {
    pub line: u32,
    pub col: u32,
    pub label: String,
    pub kind: String,
}

/// Request inlay hints from LSP.
#[command]
pub async fn lsp_inlay_hints(
    lsp: State<'_, LspManager>,
    file_path: String,
    start_line: u32,
    end_line: u32,
) -> Result<Vec<LspInlayHint>, String> {
    let ext = ext_from_path(&file_path).ok_or("No extension")?;
    let lang_id = language_id_for_ext(&ext).ok_or("Unsupported language")?;
    let uri = uri_from_path(&file_path);

    let rx = lsp.get_client(lang_id, |client| {
        client.inlay_hint(&uri, start_line, 0, end_line, 0)
    })?;

    let resp = timeout(Duration::from_secs(LSP_TIMEOUT_SECS), rx)
        .await
        .map_err(|_| "LSP inlay hints timed out".to_string())?
        .map_err(|_| "LSP inlay hints failed".to_string())?;

    let result = resp.get("result").unwrap_or(&serde_json::Value::Null);
    let mut hints = Vec::new();

    if let Some(arr) = result.as_array() {
        for item in arr {
            let pos = item.get("position");
            let line = pos.and_then(|p| p.get("line")).and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let col = pos.and_then(|p| p.get("character")).and_then(|v| v.as_u64()).unwrap_or(0) as u32;

            let label = if let Some(l) = item.get("label") {
                if let Some(s) = l.as_str() {
                    s.to_string()
                } else if let Some(arr) = l.as_array() {
                    arr.iter()
                        .filter_map(|part| part.get("value").and_then(|v| v.as_str()))
                        .collect::<Vec<_>>()
                        .join("")
                } else {
                    continue;
                }
            } else {
                continue;
            };

            // kind: 1 = Type, 2 = Parameter
            let kind = match item.get("kind").and_then(|v| v.as_u64()) {
                Some(1) => "type",
                Some(2) => "parameter",
                _ => "other",
            }.to_string();

            hints.push(LspInlayHint { line, col, label, kind });
        }
    }

    hints.truncate(200);
    Ok(hints)
}

/// Request signature help from LSP.
#[command]
pub async fn lsp_signature_help(
    lsp: State<'_, LspManager>,
    file_path: String,
    line: u32,
    col: u32,
) -> Result<Option<LspSignatureHelp>, String> {
    let ext = ext_from_path(&file_path).ok_or("No extension")?;
    let lang_id = language_id_for_ext(&ext).ok_or("Unsupported language")?;
    let uri = uri_from_path(&file_path);

    let rx = lsp.get_client(lang_id, |client| {
        client.signature_help(&uri, line, col)
    })?;

    let resp = timeout(Duration::from_secs(LSP_TIMEOUT_SECS), rx)
        .await
        .map_err(|_| "LSP signature help timed out".to_string())?
        .map_err(|_| "LSP signature help failed".to_string())?;

    let result = resp.get("result").unwrap_or(&serde_json::Value::Null);
    if result.is_null() {
        return Ok(None);
    }

    let signatures = result.get("signatures").and_then(|v| v.as_array());
    let active_sig = result.get("activeSignature").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let active_param = result.get("activeParameter").and_then(|v| v.as_u64()).unwrap_or(0) as u32;

    if let Some(sigs) = signatures {
        if let Some(sig) = sigs.get(active_sig) {
            let label = sig.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let doc = sig.get("documentation")
                .and_then(|v| {
                    if let Some(s) = v.as_str() { Some(s.to_string()) }
                    else { v.get("value").and_then(|v| v.as_str()).map(String::from) }
                })
                .unwrap_or_default();

            let params = sig.get("parameters")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter().map(|p| {
                        let plabel = p.get("label")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        LspSignatureParam { label: plabel }
                    }).collect()
                })
                .unwrap_or_default();

            // Override active_parameter if the signature itself specifies it
            let sig_active = sig.get("activeParameter").and_then(|v| v.as_u64()).map(|v| v as u32);

            return Ok(Some(LspSignatureHelp {
                label,
                active_parameter: sig_active.unwrap_or(active_param),
                parameters: params,
                documentation: doc,
            }));
        }
    }

    Ok(None)
}

/// Request code actions from LSP.
#[command]
pub async fn lsp_code_action(
    lsp: State<'_, LspManager>,
    file_path: String,
    start_line: u32,
    start_col: u32,
    end_line: u32,
    end_col: u32,
) -> Result<Vec<LspCodeAction>, String> {
    let ext = ext_from_path(&file_path).ok_or("No extension")?;
    let lang_id = language_id_for_ext(&ext).ok_or("Unsupported language")?;
    let uri = uri_from_path(&file_path);

    let rx = lsp.get_client(lang_id, |client| {
        client.code_action(&uri, start_line, start_col, end_line, end_col, &[])
    })?;

    let resp = timeout(Duration::from_secs(LSP_TIMEOUT_SECS), rx)
        .await
        .map_err(|_| "LSP code action timed out".to_string())?
        .map_err(|_| "LSP code action failed".to_string())?;

    let result = resp.get("result").unwrap_or(&serde_json::Value::Null);
    let mut actions = Vec::new();

    if let Some(arr) = result.as_array() {
        for (i, item) in arr.iter().enumerate() {
            let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let kind = item.get("kind").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if title.is_empty() { continue; }

            // Extract edits from the WorkspaceEdit
            let mut edits = Vec::new();
            if let Some(edit) = item.get("edit") {
                if let Some(changes) = edit.get("changes").and_then(|v| v.as_object()) {
                    for (change_uri, text_edits) in changes {
                        let fpath = change_uri.strip_prefix("file://").unwrap_or(change_uri).to_string();
                        if let Some(arr) = text_edits.as_array() {
                            for te in arr {
                                if let (Some(range), Some(new_text)) = (te.get("range"), te.get("newText").and_then(|v| v.as_str())) {
                                    let start = range.get("start").unwrap_or(&serde_json::Value::Null);
                                    let end = range.get("end").unwrap_or(&serde_json::Value::Null);
                                    edits.push(LspTextEdit {
                                        file_path: fpath.clone(),
                                        start_line: start.get("line").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                                        start_col: start.get("character").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                                        end_line: end.get("line").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                                        end_col: end.get("character").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                                        new_text: new_text.to_string(),
                                    });
                                }
                            }
                        }
                    }
                }
            }

            actions.push(LspCodeAction { title, kind, index: i, edits });
        }
    }

    actions.truncate(20);
    Ok(actions)
}

/// Rename symbol via LSP.
#[command]
pub async fn lsp_rename(
    lsp: State<'_, LspManager>,
    file_path: String,
    line: u32,
    col: u32,
    new_name: String,
) -> Result<Vec<LspTextEdit>, String> {
    let ext = ext_from_path(&file_path).ok_or("No extension")?;
    let lang_id = language_id_for_ext(&ext).ok_or("Unsupported language")?;
    let uri = uri_from_path(&file_path);

    let rx = lsp.get_client(lang_id, |client| {
        client.rename(&uri, line, col, &new_name)
    })?;

    let resp = timeout(Duration::from_secs(LSP_TIMEOUT_SECS), rx)
        .await
        .map_err(|_| "LSP rename request timed out".to_string())?
        .map_err(|_| "LSP rename request failed".to_string())?;

    let result = resp.get("result").unwrap_or(&serde_json::Value::Null);
    let mut edits = Vec::new();

    // Parse WorkspaceEdit.changes
    if let Some(changes) = result.get("changes").and_then(|v| v.as_object()) {
        for (change_uri, text_edits) in changes {
            let fpath = change_uri.strip_prefix("file://").unwrap_or(change_uri).to_string();
            if let Some(arr) = text_edits.as_array() {
                for te in arr {
                    if let (Some(range), Some(new_text)) = (te.get("range"), te.get("newText").and_then(|v| v.as_str())) {
                        let start = range.get("start").unwrap_or(&serde_json::Value::Null);
                        let end = range.get("end").unwrap_or(&serde_json::Value::Null);
                        edits.push(LspTextEdit {
                            file_path: fpath.clone(),
                            start_line: start.get("line").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                            start_col: start.get("character").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                            end_line: end.get("line").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                            end_col: end.get("character").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                            new_text: new_text.to_string(),
                        });
                    }
                }
            }
        }
    }

    // Also parse documentChanges if present
    if let Some(doc_changes) = result.get("documentChanges").and_then(|v| v.as_array()) {
        for dc in doc_changes {
            let fpath = dc.get("textDocument").and_then(|td| td.get("uri")).and_then(|v| v.as_str())
                .map(|u| u.strip_prefix("file://").unwrap_or(u).to_string())
                .unwrap_or_default();
            if let Some(arr) = dc.get("edits").and_then(|v| v.as_array()) {
                for te in arr {
                    if let (Some(range), Some(new_text)) = (te.get("range"), te.get("newText").and_then(|v| v.as_str())) {
                        let start = range.get("start").unwrap_or(&serde_json::Value::Null);
                        let end = range.get("end").unwrap_or(&serde_json::Value::Null);
                        edits.push(LspTextEdit {
                            file_path: fpath.clone(),
                            start_line: start.get("line").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                            start_col: start.get("character").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                            end_line: end.get("line").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                            end_col: end.get("character").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                            new_text: new_text.to_string(),
                        });
                    }
                }
            }
        }
    }

    Ok(edits)
}

/// Find all references via LSP.
#[command]
pub async fn lsp_references(
    lsp: State<'_, LspManager>,
    file_path: String,
    line: u32,
    col: u32,
) -> Result<Vec<LspLocation>, String> {
    let ext = ext_from_path(&file_path).ok_or("No extension")?;
    let lang_id = language_id_for_ext(&ext).ok_or("Unsupported language")?;
    let uri = uri_from_path(&file_path);

    let rx = lsp.get_client(lang_id, |client| {
        client.references(&uri, line, col)
    })?;

    let resp = timeout(Duration::from_secs(LSP_TIMEOUT_SECS), rx)
        .await
        .map_err(|_| "LSP references request timed out".to_string())?
        .map_err(|_| "LSP references request failed".to_string())?;

    let result = resp.get("result").unwrap_or(&serde_json::Value::Null);
    let mut locations = Vec::new();

    if let Some(arr) = result.as_array() {
        for loc in arr {
            let uri = loc.get("uri").and_then(|v| v.as_str());
            let range = loc.get("range");
            let start = range.and_then(|r| r.get("start"));
            if let (Some(u), Some(s)) = (uri, start) {
                locations.push(LspLocation {
                    file_path: u.strip_prefix("file://").unwrap_or(u).to_string(),
                    line: s.get("line").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                    col: s.get("character").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                });
            }
        }
    }

    Ok(locations)
}

/// Stop an LSP server.
#[command]
pub fn lsp_stop(
    lsp: State<'_, LspManager>,
    language: String,
) -> Result<(), String> {
    lsp.stop_server(&language)
}

/// Return which language servers are currently active.
#[command]
pub fn lsp_status(
    lsp: State<'_, LspManager>,
) -> Result<Vec<String>, String> {
    Ok(lsp.active_languages())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LspDocumentSymbol {
    pub name: String,
    pub kind: String,
    pub line: usize,
    pub col: usize,
}

/// Request document symbols from LSP.
#[command]
pub async fn lsp_document_symbol(
    lsp: State<'_, LspManager>,
    file_path: String,
    workspace_root: String,
) -> Result<Vec<LspDocumentSymbol>, String> {
    let ext = ext_from_path(&file_path).ok_or("No extension")?;
    let lang_id = language_id_for_ext(&ext).ok_or("Unsupported language")?;
    let uri = uri_from_path(&file_path);

    let _ = lsp.ensure_server(&ext, &workspace_root).await;

    let rx = lsp.get_client(lang_id, |client| {
        client.document_symbol(&uri)
    })?;

    let resp = timeout(Duration::from_secs(LSP_TIMEOUT_SECS), rx)
        .await
        .map_err(|_| "LSP document symbol request timed out".to_string())?
        .map_err(|_| "LSP document symbol request failed".to_string())?;

    let result = resp.get("result").unwrap_or(&serde_json::Value::Null);
    let mut symbols = Vec::new();

    if let Some(arr) = result.as_array() {
        for item in arr {
            // Handle both DocumentSymbol and SymbolInformation formats
            if item.get("location").is_some() {
                // SymbolInformation format
                let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let kind_num = item.get("kind").and_then(|v| v.as_u64()).unwrap_or(0);
                let loc = item.get("location").unwrap();
                let range = loc.get("range").unwrap_or(&serde_json::Value::Null);
                let start = range.get("start").unwrap_or(&serde_json::Value::Null);
                let line = start.get("line").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                let col = start.get("character").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                symbols.push(LspDocumentSymbol {
                    name,
                    kind: symbol_kind_name(kind_num),
                    line,
                    col,
                });
            } else {
                // DocumentSymbol format (hierarchical)
                flatten_document_symbols(item, &mut symbols);
            }
        }
    }

    symbols.truncate(500);
    Ok(symbols)
}

fn flatten_document_symbols(item: &serde_json::Value, out: &mut Vec<LspDocumentSymbol>) {
    let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let kind_num = item.get("kind").and_then(|v| v.as_u64()).unwrap_or(0);
    let range = item.get("selectionRange")
        .or_else(|| item.get("range"))
        .unwrap_or(&serde_json::Value::Null);
    let start = range.get("start").unwrap_or(&serde_json::Value::Null);
    let line = start.get("line").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let col = start.get("character").and_then(|v| v.as_u64()).unwrap_or(0) as usize;

    if !name.is_empty() {
        out.push(LspDocumentSymbol {
            name,
            kind: symbol_kind_name(kind_num),
            line,
            col,
        });
    }

    if let Some(children) = item.get("children").and_then(|v| v.as_array()) {
        for child in children {
            flatten_document_symbols(child, out);
        }
    }
}

fn symbol_kind_name(kind: u64) -> String {
    match kind {
        1 => "File", 2 => "Module", 3 => "Namespace", 4 => "Package",
        5 => "Class", 6 => "Method", 7 => "Property", 8 => "Field",
        9 => "Constructor", 10 => "Enum", 11 => "Interface", 12 => "Function",
        13 => "Variable", 14 => "Constant", 15 => "String", 16 => "Number",
        17 => "Boolean", 18 => "Array", 19 => "Object", 20 => "Key",
        21 => "Null", 22 => "EnumMember", 23 => "Struct", 24 => "Event",
        25 => "Operator", 26 => "TypeParameter",
        _ => "Symbol",
    }.to_string()
}

fn completion_kind_name(kind: u64) -> String {
    match kind {
        1 => "text", 2 => "method", 3 => "function", 4 => "constructor",
        5 => "field", 6 => "variable", 7 => "class", 8 => "interface",
        9 => "module", 10 => "property", 11 => "unit", 12 => "value",
        13 => "enum", 14 => "keyword", 15 => "snippet", 16 => "color",
        17 => "file", 18 => "reference", 19 => "folder", 20 => "enum member",
        21 => "constant", 22 => "struct", 23 => "event", 24 => "operator",
        25 => "type parameter",
        _ => "unknown",
    }.to_string()
}
