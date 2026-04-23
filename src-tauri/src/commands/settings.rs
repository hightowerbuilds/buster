use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{command, AppHandle, Manager};

fn default_true() -> bool { true }
fn default_zoom() -> u32 { 100 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub word_wrap: bool,
    pub font_size: u32,
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
    pub vim_mode: bool,
    #[serde(default = "default_blog_theme")]
    pub blog_theme: String,
}

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
            vim_mode: false,
            blog_theme: "normal".to_string(),
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
