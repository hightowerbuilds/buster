pub mod client;

use std::collections::HashMap;
use std::sync::{mpsc, Mutex, RwLock};

use client::{LspClient, LspDiagnostic};

// buster-lsp-manager integration — server registry, document state, URI encoding
// Namespaced to avoid collisions with existing types
pub mod lsp_pro {
    pub use buster_lsp_manager::{
        ServerRegistry, LanguageServerConfig, DocumentState, TextEdit,
        Position, Range,
        path_to_lsp_uri, lsp_uri_to_path,
    };
}

/// Maps file extensions to (language_id, command, args)
fn server_registry() -> HashMap<&'static str, (&'static str, &'static str, Vec<&'static str>)> {
    let mut m = HashMap::new();
    m.insert("rs", ("rust", "rust-analyzer", vec![]));
    m.insert("ts", ("typescript", "typescript-language-server", vec!["--stdio"]));
    m.insert("tsx", ("typescriptreact", "typescript-language-server", vec!["--stdio"]));
    m.insert("js", ("javascript", "typescript-language-server", vec!["--stdio"]));
    m.insert("jsx", ("javascriptreact", "typescript-language-server", vec!["--stdio"]));
    m.insert("py", ("python", "pyright-langserver", vec!["--stdio"]));
    m.insert("go", ("go", "gopls", vec!["serve"]));
    m.insert("c", ("c", "clangd", vec![]));
    m.insert("h", ("c", "clangd", vec![]));
    m.insert("cpp", ("cpp", "clangd", vec![]));
    m.insert("cc", ("cpp", "clangd", vec![]));
    m.insert("cxx", ("cpp", "clangd", vec![]));
    m.insert("hpp", ("cpp", "clangd", vec![]));
    m.insert("java", ("java", "jdtls", vec![]));
    m.insert("rb", ("ruby", "solargraph", vec!["stdio"]));
    m.insert("php", ("php", "intelephense", vec!["--stdio"]));
    m.insert("lua", ("lua", "lua-language-server", vec![]));
    m.insert("sh", ("shellscript", "bash-language-server", vec!["start"]));
    m.insert("bash", ("shellscript", "bash-language-server", vec!["start"]));
    m.insert("yaml", ("yaml", "yaml-language-server", vec!["--stdio"]));
    m.insert("yml", ("yaml", "yaml-language-server", vec!["--stdio"]));
    m.insert("toml", ("toml", "taplo", vec!["lsp", "stdio"]));
    m.insert("css", ("css", "vscode-css-language-server", vec!["--stdio"]));
    m.insert("scss", ("scss", "vscode-css-language-server", vec!["--stdio"]));
    m.insert("html", ("html", "vscode-html-language-server", vec!["--stdio"]));
    m.insert("htm", ("html", "vscode-html-language-server", vec!["--stdio"]));
    m
}

pub fn language_id_for_ext(ext: &str) -> Option<&'static str> {
    server_registry().get(ext).map(|(lang, _, _)| *lang)
}

#[allow(dead_code)]
pub struct LspManager {
    /// language_id -> active client
    clients: RwLock<HashMap<String, LspClient>>,
    /// Channel to receive diagnostics from all clients
    diag_rx: Mutex<Option<mpsc::Receiver<(String, Vec<LspDiagnostic>)>>>,
    diag_tx: mpsc::Sender<(String, Vec<LspDiagnostic>)>,
    /// Per-document state for incremental text sync.
    /// Keyed by file URI (e.g. "file:///path/to/file.ts").
    documents: Mutex<HashMap<String, lsp_pro::DocumentState>>,
}

#[allow(dead_code)]
impl LspManager {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        LspManager {
            clients: RwLock::new(HashMap::new()),
            diag_rx: Mutex::new(Some(rx)),
            diag_tx: tx,
            documents: Mutex::new(HashMap::new()),
        }
    }

    /// Take the diagnostic receiver (can only be called once).
    pub fn take_diag_rx(&self) -> Option<mpsc::Receiver<(String, Vec<LspDiagnostic>)>> {
        self.diag_rx.lock().ok()?.take()
    }

    /// Start (or get) a language server for the given file extension and workspace root.
    pub async fn ensure_server(&self, ext: &str, root_path: &str) -> Result<(), String> {
        let registry = server_registry();
        let (language_id, command, args) = registry.get(ext)
            .ok_or_else(|| format!("No language server configured for .{}", ext))?;

        // Scope the read lock so it's dropped before the await point
        {
            let clients = self.clients.read().map_err(|e| e.to_string())?;
            if clients.contains_key(*language_id) {
                return Ok(()); // Already running
            }
        }

        let args_ref: Vec<&str> = args.iter().map(|s| *s).collect();
        let client = LspClient::start(command, &args_ref, root_path, language_id, self.diag_tx.clone()).await?;

        let mut clients = self.clients.write().map_err(|e| e.to_string())?;
        clients.insert(language_id.to_string(), client);
        Ok(())
    }

    /// Get a reference to a client by language ID.
    pub fn get_client<F, R>(&self, language_id: &str, f: F) -> Result<R, String>
    where
        F: FnOnce(&LspClient) -> Result<R, String>,
    {
        let clients = self.clients.read().map_err(|e| e.to_string())?;
        let client = clients.get(language_id)
            .ok_or_else(|| format!("No LSP client for {}", language_id))?;
        if client.crashed.load(std::sync::atomic::Ordering::SeqCst) {
            drop(clients);
            let mut wclients = self.clients.write().map_err(|e| e.to_string())?;
            wclients.remove(language_id);
            return Err(format!("LSP {} has crashed", language_id));
        }
        f(client)
    }

    // --- Document state management for incremental sync ---

    /// Register a newly opened document. Creates a DocumentState to track
    /// content and pending edits for incremental sync.
    pub fn open_document(&self, uri: &str, language_id: &str, content: &str) -> Result<(), String> {
        let mut docs = self.documents.lock().map_err(|e| e.to_string())?;
        let doc_state = lsp_pro::DocumentState::new(
            uri.to_string(),
            language_id.to_string(),
            content.to_string(),
        );
        docs.insert(uri.to_string(), doc_state);
        Ok(())
    }

    /// Apply incremental edits to a tracked document, then return the
    /// pending TextEdits that should be sent to the language server.
    /// Also returns the new version number from the DocumentState.
    pub fn apply_incremental_edits(
        &self,
        uri: &str,
        edits: &[crate::commands::lsp::EditDelta],
    ) -> Result<(i32, Vec<lsp_pro::TextEdit>), String> {
        let mut docs = self.documents.lock().map_err(|e| e.to_string())?;
        let doc = docs.get_mut(uri).ok_or_else(|| {
            format!("No document state for {}. Was didOpen sent?", uri)
        })?;

        for edit in edits {
            let range = lsp_pro::Range::new(
                lsp_pro::Position::new(edit.start_line, edit.start_col),
                lsp_pro::Position::new(edit.end_line, edit.end_col),
            );
            doc.apply_edit(range, &edit.new_text);
        }

        let version = doc.version;
        let pending = doc.take_pending_edits();
        Ok((version, pending))
    }

    /// Replace the tracked document content (used on full-sync fallback).
    /// Clears any pending edits and bumps the version.
    pub fn reset_document_content(&self, uri: &str, new_content: &str) -> Result<(), String> {
        let mut docs = self.documents.lock().map_err(|e| e.to_string())?;
        if let Some(_old) = docs.remove(uri) {
            // Re-create with the same URI and language_id but new content.
            // We preserve the language_id from the old state.
            let language_id = _old.language_id.clone();
            let doc_state = lsp_pro::DocumentState::new(
                uri.to_string(),
                language_id,
                new_content.to_string(),
            );
            docs.insert(uri.to_string(), doc_state);
        }
        // If there was no tracked document, that's fine — full sync works
        // without local state.
        Ok(())
    }

    /// Remove a tracked document (called on didClose).
    pub fn close_document(&self, uri: &str) -> Result<(), String> {
        let mut docs = self.documents.lock().map_err(|e| e.to_string())?;
        docs.remove(uri);
        Ok(())
    }

    /// Stop a language server.
    pub fn stop_server(&self, language_id: &str) -> Result<(), String> {
        let mut clients = self.clients.write().map_err(|e| e.to_string())?;
        if let Some(client) = clients.remove(language_id) {
            let _ = client.shutdown();
        }
        Ok(())
    }

    /// Stop all servers.
    pub fn stop_all(&self) {
        if let Ok(mut clients) = self.clients.write() {
            for (_, client) in clients.drain() {
                let _ = client.shutdown();
            }
        }
    }

    /// List active language server IDs.
    pub fn active_languages(&self) -> Vec<String> {
        self.clients.read()
            .map(|c| c.keys().cloned().collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_id_maps_typescript() {
        assert_eq!(language_id_for_ext("ts"), Some("typescript"));
        assert_eq!(language_id_for_ext("tsx"), Some("typescriptreact"));
    }

    #[test]
    fn language_id_maps_javascript() {
        assert_eq!(language_id_for_ext("js"), Some("javascript"));
        assert_eq!(language_id_for_ext("jsx"), Some("javascriptreact"));
    }

    #[test]
    fn language_id_maps_rust() {
        assert_eq!(language_id_for_ext("rs"), Some("rust"));
    }

    #[test]
    fn language_id_maps_python() {
        assert_eq!(language_id_for_ext("py"), Some("python"));
    }

    #[test]
    fn language_id_maps_go() {
        assert_eq!(language_id_for_ext("go"), Some("go"));
    }

    #[test]
    fn language_id_maps_c_cpp() {
        assert_eq!(language_id_for_ext("c"), Some("c"));
        assert_eq!(language_id_for_ext("h"), Some("c"));
        assert_eq!(language_id_for_ext("cpp"), Some("cpp"));
        assert_eq!(language_id_for_ext("cc"), Some("cpp"));
    }

    #[test]
    fn language_id_maps_web_languages() {
        assert_eq!(language_id_for_ext("html"), Some("html"));
        assert_eq!(language_id_for_ext("css"), Some("css"));
        assert_eq!(language_id_for_ext("scss"), Some("scss"));
        assert_eq!(language_id_for_ext("yaml"), Some("yaml"));
        assert_eq!(language_id_for_ext("yml"), Some("yaml"));
    }

    #[test]
    fn language_id_returns_none_for_unknown() {
        assert_eq!(language_id_for_ext("xyz"), None);
        assert_eq!(language_id_for_ext(""), None);
    }

    #[test]
    fn lsp_manager_starts_empty() {
        let mgr = LspManager::new();
        assert!(mgr.active_languages().is_empty());
    }

    #[test]
    fn server_registry_has_all_languages() {
        let reg = server_registry();
        // Should have at least the core languages
        assert!(reg.contains_key("ts"));
        assert!(reg.contains_key("rs"));
        assert!(reg.contains_key("py"));
        assert!(reg.contains_key("go"));
        assert!(reg.contains_key("c"));
        assert!(reg.contains_key("cpp"));
        assert!(reg.contains_key("java"));
        assert!(reg.contains_key("html"));
        assert!(reg.contains_key("css"));
        assert!(reg.contains_key("sh"));
        assert!(reg.contains_key("rb"));
        assert!(reg.contains_key("php"));
        assert!(reg.contains_key("lua"));
    }
}
