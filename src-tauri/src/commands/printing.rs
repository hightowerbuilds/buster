//! Native printing of a captured draft, after the app's confirmation dialog.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrintOptions {
    destination: String,
    printer_id: String,
    copies: u32,
    paper: String,
    orientation: String,
    pages: String,
    first_page: u32,
    last_page: u32,
    duplex: String,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrintRequest {
    job_id: String,
    title: String,
    html: String,
    options: PrintOptions,
    pdf_path: Option<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Printer {
    id: String,
    name: String,
    is_default: bool,
}
#[derive(Debug, Serialize)]
pub struct PrintResult {
    status: &'static str,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    printer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

fn validate(request: &PrintRequest) -> Result<(), String> {
    let options = &request.options;
    if request.job_id.is_empty()
        || request.job_id.len() > 128
        || !request
            .job_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err("Invalid print job ID.".into());
    }
    if request.title.is_empty()
        || request.title.len() > 1024
        || request.title.chars().any(char::is_control)
    {
        return Err("Invalid print document title.".into());
    }
    if request.html.len() > 8 * 1024 * 1024 || request.html.contains('\0') {
        return Err("The print document is too large or contains binary content.".into());
    }
    if !["printer", "pdf"].contains(&options.destination.as_str())
        || !(1..=99).contains(&options.copies)
        || !["letter", "a4", "legal"].contains(&options.paper.as_str())
        || !["portrait", "landscape"].contains(&options.orientation.as_str())
        || !["all", "range"].contains(&options.pages.as_str())
        || !["one-sided", "two-sided-long-edge", "two-sided-short-edge"]
            .contains(&options.duplex.as_str())
    {
        return Err("Invalid print options.".into());
    }
    if options.pages == "range"
        && (options.first_page == 0
            || options.last_page < options.first_page
            || options.last_page > 10000)
    {
        return Err("Enter a valid page range between 1 and 10000.".into());
    }
    if options.destination == "printer" {
        if options.printer_id.is_empty()
            || options.printer_id.len() > 512
            || options.printer_id.chars().any(char::is_control)
        {
            return Err("Choose an installed printer.".into());
        }
        if request.pdf_path.is_some() {
            return Err("A printer job cannot have a PDF destination path.".into());
        }
    } else {
        let path = request
            .pdf_path
            .as_deref()
            .ok_or("Choose where to save the PDF.")?;
        if !std::path::Path::new(path).is_absolute()
            || !path.to_lowercase().ends_with(".pdf")
            || path.chars().any(char::is_control)
        {
            return Err("Choose an absolute PDF file path.".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn print_printers(app: tauri::AppHandle) -> Result<Vec<Printer>, String> {
    platform::printers(app).await
}
#[tauri::command]
pub async fn print_document(
    app: tauri::AppHandle,
    mut request: PrintRequest,
) -> Result<PrintResult, String> {
    validate(&request)?;
    let output = request.pdf_path.take();
    let temporary = if output.is_some() {
        Some(tempfile::tempdir().map_err(|e| format!("Could not prepare PDF storage: {e}"))?)
    } else {
        None
    };
    if let Some(dir) = &temporary {
        request.pdf_path = Some(dir.path().join("print.pdf").to_string_lossy().into_owned());
    }
    let title = request.title.clone();
    let printer = if request.options.destination == "printer" {
        Some(request.options.printer_id.clone())
    } else {
        None
    };
    platform::print(app, request).await?;
    if let (Some(dir), Some(path)) = (temporary, &output) {
        let path = path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let bytes = std::fs::read(dir.path().join("print.pdf"))
                .map_err(|e| format!("Could not read the prepared PDF: {e}"))?;
            if !bytes.starts_with(b"%PDF-") {
                return Err("macOS did not produce a valid PDF.".into());
            }
            crate::storage::write(std::path::Path::new(&path), &bytes, false)
                .map_err(|e| format!("Could not save the PDF: {e}"))
        })
        .await
        .map_err(|e| format!("PDF saving stopped: {e}"))??;
    }
    Ok(PrintResult {
        status: if output.is_some() {
            "saved"
        } else {
            "submitted"
        },
        title,
        printer,
        path: output,
    })
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;
    pub async fn printers(_: tauri::AppHandle) -> Result<Vec<Printer>, String> {
        Err("Native printing is currently available on macOS.".into())
    }
    pub async fn print(_: tauri::AppHandle, _: PrintRequest) -> Result<(), String> {
        Err("Native printing is currently available on macOS.".into())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::{
        collections::HashMap,
        ffi::{c_char, CStr, CString},
        sync::{Mutex, OnceLock},
    };
    type Reply = tokio::sync::oneshot::Sender<Result<(), String>>;
    static PENDING: OnceLock<Mutex<HashMap<String, Reply>>> = OnceLock::new();
    extern "C" {
        fn bm_print_printers() -> *mut c_char;
        fn bm_print_start(
            request: *const c_char,
            callback: extern "C" fn(*const c_char),
        ) -> *mut c_char;
        fn bm_print_free(value: *mut c_char);
    }
    unsafe fn response(raw: *mut c_char) -> Result<serde_json::Value, String> {
        if raw.is_null() {
            return Err("macOS printing returned no response.".into());
        }
        let parsed = serde_json::from_slice(CStr::from_ptr(raw).to_bytes());
        bm_print_free(raw);
        let value: serde_json::Value =
            parsed.map_err(|_| "macOS printing returned an invalid response.")?;
        if let Some(error) = value.get("error").and_then(|v| v.as_str()) {
            return Err(error.into());
        }
        Ok(value)
    }
    extern "C" fn completed(raw: *const c_char) {
        if raw.is_null() {
            return;
        }
        let Ok(value) =
            serde_json::from_slice::<serde_json::Value>(unsafe { CStr::from_ptr(raw) }.to_bytes())
        else {
            return;
        };
        let Some(id) = value.get("jobId").and_then(|v| v.as_str()) else {
            return;
        };
        if let Ok(mut pending) = PENDING.get_or_init(Mutex::default).lock() {
            if let Some(reply) = pending.remove(id) {
                let result = if value.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                    Ok(())
                } else {
                    Err(value
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Printing failed.")
                        .into())
                };
                let _ = reply.send(result);
            }
        }
    }
    pub async fn printers(app: tauri::AppHandle) -> Result<Vec<Printer>, String> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            let result = unsafe { response(bm_print_printers()) }.and_then(|v| {
                serde_json::from_value(v).map_err(|_| "macOS returned invalid printers.".into())
            });
            let _ = tx.send(result);
        })
        .map_err(|_| "Printing is unavailable.")?;
        rx.await.map_err(|_| "Printer discovery stopped.")?
    }
    pub async fn print(app: tauri::AppHandle, request: PrintRequest) -> Result<(), String> {
        let id = request.job_id.clone();
        let json = CString::new(serde_json::to_string(&request).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            let mut pending = PENDING
                .get_or_init(Mutex::default)
                .lock()
                .map_err(|_| "Printing is unavailable.")?;
            if !pending.is_empty() {
                return Err("Another print job is still being prepared.".into());
            }
            pending.insert(id.clone(), tx);
        }
        let started = app.run_on_main_thread(move || {
            if let Err(error) = unsafe { response(bm_print_start(json.as_ptr(), completed)) } {
                if let Ok(mut pending) = PENDING.get_or_init(Mutex::default).lock() {
                    if let Some(reply) = pending.remove(&id) {
                        let _ = reply.send(Err(error));
                    }
                }
            }
        });
        if started.is_err() {
            PENDING
                .get_or_init(Mutex::default)
                .lock()
                .map_err(|_| "Printing is unavailable.")?
                .clear();
            return Err("Printing is unavailable.".into());
        }
        rx.await
            .map_err(|_| "The print service stopped before responding.".to_owned())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> PrintRequest {
        serde_json::from_value(serde_json::json!({"jobId":"test-1", "title":"Draft.md", "html":"<p>Draft</p>",
            "options":{"destination":"pdf","printerId":"","copies":1,"paper":"letter","orientation":"portrait","pages":"all","firstPage":1,"lastPage":1,"duplex":"one-sided"},
            "pdfPath":"/tmp/draft.pdf"})).unwrap()
    }
    #[test]
    fn validates_destinations_and_print_settings() {
        let mut job = request();
        assert!(validate(&job).is_ok());
        job.options.copies = 0;
        assert!(validate(&job).is_err());
        job.options.copies = 1;
        job.options.pages = "range".into();
        job.options.first_page = 2;
        assert!(validate(&job).is_err());
        job.options.last_page = 4;
        assert!(validate(&job).is_ok());
        job.pdf_path = Some("relative.pdf".into());
        assert!(validate(&job).is_err());
        job.options.destination = "printer".into();
        job.options.printer_id = "Printer".into();
        job.pdf_path = None;
        assert!(validate(&job).is_ok());
        job.options.orientation = "anything".into();
        assert!(validate(&job).is_err());
    }
    #[test]
    fn rejects_binary_and_oversized_documents_and_unknown_arguments() {
        let mut job = request();
        job.html.push('\0');
        assert!(validate(&job).is_err());
        job.html = "a".repeat(8 * 1024 * 1024 + 1);
        assert!(validate(&job).is_err());
        assert!(
            serde_json::from_value::<PrintRequest>(serde_json::json!({"confirmed":true})).is_err()
        );
    }
}
