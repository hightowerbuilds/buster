//! Versioned chat history, replaced atomically. Invalid existing history is never overwritten.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, fs, path::{Path, PathBuf}, sync::Mutex};
use tauri::{AppHandle, Manager};

const MAX_BYTES: usize = 64 * 1024 * 1024;
static HISTORY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatHistory {
    version: u32,
    active_id: String,
    chats: Vec<Value>,
}

fn validate(history: &ChatHistory) -> Result<(), String> {
    if history.version != 1 { return Err("Unsupported chat history version; existing history was preserved.".into()); }
    let mut ids = HashSet::new();
    for chat in &history.chats {
        let id = chat["id"].as_str().ok_or("A saved chat has no ID")?;
        if id.is_empty() || id.len() > 128 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') || !ids.insert(id) {
            return Err("Invalid or duplicate chat ID; existing history was preserved.".into());
        }
        if !chat["title"].is_string() || !chat["entries"].is_array() || !chat["model"].is_string() {
            return Err("Invalid saved chat; existing history was preserved.".into());
        }
    }
    if !history.chats.is_empty() && !ids.contains(history.active_id.as_str()) {
        return Err("The active chat is missing; existing history was preserved.".into());
    }
    Ok(())
}

fn load(path: &Path) -> Result<Option<ChatHistory>, String> {
    match fs::metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
        Ok(meta) if meta.len() > MAX_BYTES as u64 => return Err("Chat history exceeds the 64 MiB limit; existing history was preserved.".into()),
        _ => {}
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let history = serde_json::from_slice(&bytes).map_err(|e| format!("Could not read chat history; existing history was preserved: {e}"))?;
    validate(&history)?;
    Ok(Some(history))
}

fn save(path: &Path, history: &ChatHistory) -> Result<(), String> {
    validate(history)?;
    // Do not overwrite damaged or future-version archives, even after a failed startup.
    load(path)?;
    let bytes = serde_json::to_vec(history).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES { return Err("Chat history is full (64 MiB). Delete an unneeded chat before saving more.".into()); }
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    crate::storage::write(path, &bytes, false).map_err(|e| format!("Could not save chat history: {e}"))
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("chats/history.json"))
}

#[tauri::command]
pub fn chat_history_load(app: AppHandle) -> Result<Option<ChatHistory>, String> {
    let _guard = HISTORY_LOCK.lock().map_err(|_| "Chat history is unavailable")?;
    load(&path(&app)?)
}

#[tauri::command]
pub fn chat_history_save(app: AppHandle, history: ChatHistory) -> Result<(), String> {
    let _guard = HISTORY_LOCK.lock().map_err(|_| "Chat history is unavailable")?;
    save(&path(&app)?, &history)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn example() -> ChatHistory {
        serde_json::from_value(serde_json::json!({"version":1,"activeId":"chat-1","chats":[{"id":"chat-1","title":"Déjà 📝","entries":[],"model":""}]})).unwrap()
    }
    #[test]
    fn roundtrip_and_atomic_replacement() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("chats/history.json");
        assert!(load(&path).unwrap().is_none());
        let mut history = example(); save(&path, &history).unwrap();
        history.chats[0]["title"] = Value::String("Revised".into()); save(&path, &history).unwrap();
        assert_eq!(load(&path).unwrap().unwrap().chats[0]["title"], "Revised");
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }
    #[test]
    fn refuses_corrupt_future_and_duplicate_history_without_replacing_it() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("history.json");
        for bytes in [b"broken".as_slice(), br#"{"version":99,"activeId":"","chats":[]}"#] {
            fs::write(&path, bytes).unwrap(); assert!(save(&path, &example()).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        let mut history = example(); history.chats.push(history.chats[0].clone());
        assert!(validate(&history).is_err());
    }
}
