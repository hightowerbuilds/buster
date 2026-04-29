use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{command, AppHandle, Manager};

fn default_true() -> bool { true }
fn default_zoom() -> u32 { 100 }
fn default_auto_save_delay_ms() -> u32 { 1500 }
fn default_font_family() -> String { "JetBrains Mono, Menlo, Monaco, Consolas, monospace".to_string() }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EditorLanguageSettings {
    #[serde(default)]
    pub tab_size: Option<u32>,
    #[serde(default)]
    pub use_spaces: Option<bool>,
    #[serde(default)]
    pub word_wrap: Option<bool>,
    #[serde(default)]
    pub format_on_save: Option<bool>,
    #[serde(default)]
    pub auto_save: Option<bool>,
    #[serde(default)]
    pub auto_save_delay_ms: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub word_wrap: bool,
    pub font_size: u32,
    #[serde(default = "default_font_family")]
    pub font_family: String,
    pub tab_size: u32,
    #[serde(default = "default_true")]
    pub use_spaces: bool,
    pub minimap: bool,
    pub line_numbers: bool,
    pub cursor_blink: bool,
    #[serde(default = "default_true")]
    pub autocomplete: bool,
    #[serde(default = "default_zoom")]
    pub ui_zoom: u32,
    #[serde(default)]
    pub recent_folders: Vec<String>,
    /// Theme mode: "dark", "light", or "custom"
    #[serde(default = "default_theme_mode")]
    pub theme_mode: String,
    /// Seed hue (0–360) for generated palette, or -1 for Catppuccin Mocha
    #[serde(default = "default_hue")]
    pub theme_hue: i32,
    #[serde(default)]
    pub effect_bg_glow: u32,
    #[serde(default)]
    pub effect_cursor_glow: u32,
    #[serde(default)]
    pub effect_vignette: u32,
    #[serde(default)]
    pub effect_grain: u32,
    // Agent rate limits
    #[serde(default = "default_agent_tool_calls")]
    pub agent_max_tool_calls: u32,
    #[serde(default = "default_agent_writes")]
    pub agent_max_writes: u32,
    #[serde(default = "default_agent_commands")]
    pub agent_max_commands: u32,
    #[serde(default = "default_agent_timeout")]
    pub agent_timeout_secs: u32,
    #[serde(default)]
    pub keybindings: HashMap<String, String>,
    #[serde(default)]
    pub syntax_colors: HashMap<String, String>,
    #[serde(default)]
    pub format_on_save: bool,
    #[serde(default)]
    pub auto_save: bool,
    #[serde(default = "default_auto_save_delay_ms")]
    pub auto_save_delay_ms: u32,
    #[serde(default)]
    pub language_settings: HashMap<String, EditorLanguageSettings>,
    #[serde(default)]
    pub vim_mode: bool,
    #[serde(default = "default_blog_theme")]
    pub blog_theme: String,
    #[serde(default = "default_true")]
    pub show_indent_guides: bool,
    #[serde(default)]
    pub show_whitespace: bool,
    // AI Completion
    #[serde(default)]
    pub ai_completion_enabled: bool,
    #[serde(default = "default_ai_provider")]
    pub ai_provider: String,
    #[serde(default)]
    pub ai_api_key: String,
    #[serde(default = "default_ai_model")]
    pub ai_model: String,
    #[serde(default = "default_ollama_model")]
    pub ai_local_model: String,
    #[serde(default = "default_ollama_url")]
    pub ai_ollama_url: String,
}

fn default_ai_provider() -> String { "ollama".to_string() }
fn default_ai_model() -> String { "claude-haiku-4-5-20250514".to_string() }
fn default_ollama_model() -> String { "gemma3:4b".to_string() }
fn default_ollama_url() -> String { "http://localhost:11434".to_string() }

fn default_theme_mode() -> String { "dark".to_string() }
fn default_hue() -> i32 { -1 }
fn default_agent_tool_calls() -> u32 { 50 }
fn default_agent_writes() -> u32 { 10 }
fn default_agent_commands() -> u32 { 5 }
fn default_agent_timeout() -> u32 { 300 }
fn default_blog_theme() -> String { "normal".to_string() }

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            word_wrap: true,
            font_size: 14,
            font_family: default_font_family(),
            tab_size: 4,
            use_spaces: true,
            minimap: false,
            line_numbers: true,
            cursor_blink: true,
            autocomplete: true,
            ui_zoom: 100,
            recent_folders: Vec::new(),
            theme_mode: "dark".to_string(),
            theme_hue: -1,
            effect_bg_glow: 0,
            effect_cursor_glow: 0,
            effect_vignette: 0,
            effect_grain: 0,
            agent_max_tool_calls: 50,
            agent_max_writes: 10,
            agent_max_commands: 5,
            agent_timeout_secs: 300,
            keybindings: HashMap::new(),
            syntax_colors: HashMap::new(),
            format_on_save: false,
            auto_save: false,
            auto_save_delay_ms: 1500,
            language_settings: HashMap::new(),
            vim_mode: false,
            blog_theme: "normal".to_string(),
            show_indent_guides: true,
            show_whitespace: false,
            ai_completion_enabled: false,
            ai_provider: "ollama".to_string(),
            ai_api_key: String::new(),
            ai_model: "claude-haiku-4-5-20250514".to_string(),
            ai_local_model: "gemma3:4b".to_string(),
            ai_ollama_url: "http://localhost:11434".to_string(),
        }
    }
}

const MAX_RECENT_FOLDERS: usize = 5;

fn settings_path(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."));
    dir.join("settings.json")
}

#[command]
pub fn load_settings(app: AppHandle) -> AppSettings {
    let path = settings_path(&app);
    if path.exists() {
        match fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => AppSettings::default(),
        }
    } else {
        AppSettings::default()
    }
}

#[command]
pub fn add_recent_folder(app: AppHandle, folder: String) -> Result<AppSettings, String> {
    let mut settings = load_settings(app.clone());
    // Remove if already present, then push to front
    settings.recent_folders.retain(|f| f != &folder);
    settings.recent_folders.insert(0, folder);
    settings.recent_folders.truncate(MAX_RECENT_FOLDERS);
    save_settings(app, settings.clone())?;
    Ok(settings)
}

#[command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::AppSettings;

    #[test]
    fn settings_keybindings_round_trip() {
        let mut settings = AppSettings::default();
        settings
            .keybindings
            .insert("editor.find".to_string(), "Mod+Shift+f".to_string());

        let json = serde_json::to_string(&settings).unwrap();
        let decoded: AppSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(
            decoded.keybindings.get("editor.find"),
            Some(&"Mod+Shift+f".to_string()),
        );
    }

    #[test]
    fn settings_missing_keybindings_defaults_empty() {
        let json = r#"{
            "word_wrap": true,
            "font_size": 14,
            "tab_size": 4,
            "minimap": false,
            "line_numbers": true,
            "cursor_blink": true
        }"#;

        let decoded: AppSettings = serde_json::from_str(json).unwrap();

        assert!(decoded.keybindings.is_empty());
    }

    #[test]
    fn settings_language_overrides_round_trip() {
        let mut settings = AppSettings::default();
        settings.format_on_save = true;
        settings.auto_save = true;
        settings.auto_save_delay_ms = 2000;
        settings.language_settings.insert(
            "rust".to_string(),
            super::EditorLanguageSettings {
                tab_size: Some(2),
                use_spaces: Some(false),
                word_wrap: None,
                format_on_save: Some(false),
                auto_save: None,
                auto_save_delay_ms: Some(1000),
            },
        );

        let json = serde_json::to_string(&settings).unwrap();
        let decoded: AppSettings = serde_json::from_str(&json).unwrap();
        let rust = decoded.language_settings.get("rust").unwrap();

        assert_eq!(decoded.format_on_save, true);
        assert_eq!(decoded.auto_save, true);
        assert_eq!(decoded.auto_save_delay_ms, 2000);
        assert_eq!(rust.tab_size, Some(2));
        assert_eq!(rust.use_spaces, Some(false));
        assert_eq!(rust.format_on_save, Some(false));
        assert_eq!(rust.auto_save_delay_ms, Some(1000));
    }

    #[test]
    fn settings_font_and_syntax_colors_round_trip() {
        let mut settings = AppSettings::default();
        settings.font_family = "Fira Code, monospace".to_string();
        settings.syntax_colors.insert("keyword".to_string(), "#ff00aa".to_string());

        let json = serde_json::to_string(&settings).unwrap();
        let decoded: AppSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded.font_family, "Fira Code, monospace");
        assert_eq!(decoded.syntax_colors.get("keyword"), Some(&"#ff00aa".to_string()));
    }

    #[test]
    fn settings_missing_format_and_auto_save_defaults() {
        let json = r#"{
            "word_wrap": true,
            "font_size": 14,
            "tab_size": 4,
            "minimap": false,
            "line_numbers": true,
            "cursor_blink": true
        }"#;

        let decoded: AppSettings = serde_json::from_str(json).unwrap();

        assert_eq!(decoded.format_on_save, false);
        assert_eq!(decoded.auto_save, false);
        assert_eq!(decoded.auto_save_delay_ms, 1500);
        assert!(decoded.language_settings.is_empty());
    }
}
