mod commands;
mod mcp;
mod terminal;
pub mod workspace;
pub mod watcher;
pub mod filebuffer;

use terminal::TerminalManager;
use tauri::menu::{Menu, Submenu, MenuItem, PredefinedMenuItem};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(commands::agent::AgentState::new())
        .manage(std::sync::Arc::new(mcp::McpState::new()))
        .manage(workspace::WorkspaceState::new())
        .manage(TerminalManager::new())
        .manage(watcher::FileWatcher::new())
        .manage(filebuffer::FileBufferManager::new())
        .manage(commands::ai_completion::AiCompletionState::new())
        .manage(commands::writing_ai::WritingAiState::default())
        .setup(|app| {
            // Build the native menu bar
            let change_dir = MenuItem::with_id(app, "change_directory", "Change Directory", true, None::<&str>)?;
            let close_dir = MenuItem::with_id(app, "close_directory", "Close Directory", true, None::<&str>)?;
            let view_settings = MenuItem::with_id(
                app,
                "view_settings",
                "Settings (Cmd+,)",
                true,
                None::<&str>,
            )?;
            let new_file = MenuItem::with_id(app, "new_file", "New File", true, Some("CmdOrCtrl+N"))?;
            let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
            let save_as = MenuItem::with_id(app, "save_as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?;
            let close_tab = MenuItem::with_id(
                app,
                "close_tab",
                "Close Tab",
                true,
                Some("CmdOrCtrl+W"),
            )?;
            let file_menu = Submenu::with_items(app, "File", true, &[
                &new_file,
                &PredefinedMenuItem::separator(app)?,
                &change_dir,
                &close_dir,
                &PredefinedMenuItem::separator(app)?,
                &save,
                &save_as,
                &PredefinedMenuItem::separator(app)?,
                &close_tab,
            ])?;

            // Keep native cut/copy/paste selectors for dictation and clipboard integration.
            // This is critical for compatibility with voice dictation tools (Wispr Flow, macOS Dictation)
            // which inject text via simulated Cmd+V through the macOS responder chain.
            // PredefinedMenuItems route through the native NSResponder paste: selector,
            // while custom MenuItems with accelerators only intercept the key combo from real keyboard events.
            let select_all = MenuItem::with_id(app, "select_all", "Select All", true, Some("CmdOrCtrl+A"))?;
            let undo = MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?;
            let redo = MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?;
            let edit_menu = Submenu::with_items(app, "Edit", true, &[
                &undo,
                &redo,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, Some("Cut"))?,
                &PredefinedMenuItem::copy(app, Some("Copy"))?,
                &PredefinedMenuItem::paste(app, Some("Paste"))?,
                &select_all,
            ])?;

            let view_menu = Submenu::with_items(
                app,
                "View",
                true,
                &[&view_settings],
            )?;

            // macOS reserves the first submenu for the application menu.
            let app_menu = Submenu::with_items(app, "BusterMark", true, &[
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
            ])?;
            let menu = Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu])?;
            app.set_menu(menu)?;

            // Handle menu events
            app.on_menu_event(move |app_handle, event| {
                match event.id().as_ref() {
                    "change_directory" => {
                        let _ = app_handle.emit("menu-change-directory", ());
                    }
                    "close_directory" => {
                        let _ = app_handle.emit("menu-close-directory", ());
                    }
                    "close_tab" => {
                        let _ = app_handle.emit("menu-close-tab", ());
                    }
                    "undo" => {
                        let _ = app_handle.emit("menu-undo", ());
                    }
                    "redo" => {
                        let _ = app_handle.emit("menu-redo", ());
                    }
                    "cut" => {
                        let _ = app_handle.emit("menu-cut", ());
                    }
                    "copy" => {
                        let _ = app_handle.emit("menu-copy", ());
                    }
                    "paste" => {
                        let _ = app_handle.emit("menu-paste", ());
                    }
                    "select_all" => {
                        let _ = app_handle.emit("menu-select-all", ());
                    }
                    "view_settings" => {
                        let _ = app_handle.emit("menu-open-settings", ());
                    }
                    "new_file" => {
                        let _ = app_handle.emit("menu-new-file", ());
                    }
                    "save" => {
                        let _ = app_handle.emit("menu-save", ());
                    }
                    "save_as" => {
                        let _ = app_handle.emit("menu-save-as", ());
                    }
                    _ => {}
                }
            });

            // Set window icon (visible in dev mode dock/taskbar)
            {
                let icon_bytes = include_bytes!("../icons/icon.png");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.set_icon(icon);
                    }
                }
            }

            // Block ALL window close attempts. Cmd+W closes tabs via the menu
            // accelerator; Cmd+Q terminates the process. This is diagnostic:
            // if the app still closes on Cmd+W, prevent_close() isn't working.
            let main_window = app.get_webview_window("main");
            if let Some(window) = main_window {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                    }
                });
            }

            // Start file watcher and spawn forwarding thread
            let file_watcher = app.state::<watcher::FileWatcher>();
            file_watcher.start().expect("Failed to start file watcher");
            if let Some(rx) = file_watcher.take_event_rx() {
                let watcher_handle = app.handle().clone();
                std::thread::spawn(move || {
                    while let Ok(file_path) = rx.recv() {
                        #[derive(serde::Serialize, Clone)]
                        struct FileChangedEvent {
                            path: String,
                        }
                        let _ = watcher_handle.emit(
                            "file-changed-externally",
                            FileChangedEvent { path: file_path },
                        );
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // File commands
            commands::file::set_workspace_root,
            commands::notes::initialize_notes_workspace,
            commands::file::read_file,
            commands::file::write_file,
            commands::file::list_directory,
            commands::file::move_entry,
            commands::file::create_file,
            commands::file::create_directory,
            commands::file::rename_entry,
            commands::file::delete_entry,
            commands::file::watch_file,
            commands::file::unwatch_file,
            // Terminal commands
            commands::terminal::terminal_spawn,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_kill,
            commands::terminal::terminal_resync,
            commands::terminal::set_terminal_theme,
            // Search
            commands::search::list_workspace_files,
            commands::search::workspace_search,
            // Settings
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::settings::add_recent_folder,
            // Extensions
            // Session
            commands::session::save_session,
            commands::session::load_session,
            commands::session::save_backup_buffer,
            commands::session::load_backup_buffer,
            commands::session::delete_backup_buffer,
            commands::session::clear_session,
            commands::session::confirm_app_close,
            commands::session::set_running_flag,
            commands::session::clear_running_flag,
            // Large file buffer
            commands::filebuffer::file_is_large,
            commands::filebuffer::large_file_open,
            commands::filebuffer::large_file_read_lines,
            commands::filebuffer::large_file_line_count,
            commands::filebuffer::large_file_close,
            // AI Completion
            // Headless assistants
            commands::agent::agent_detect,
            commands::agent::agent_send,
            commands::agent::agent_cancel,
            commands::agent::mcp_start,
            commands::agent::mcp_stop,
            commands::agent::mcp_set_tools,
            commands::agent::mcp_tool_result,
            commands::writing_ai::writing_ai_generate,
            commands::lookup::lookup_selection_text,
            commands::speech::speech_voices,
            commands::speech::speech_start,
            commands::speech::speech_control,
            commands::writing_ai::writing_ai_cancel,
            commands::ai_completion::ai_completion_request,
            commands::ai_completion::ai_completion_cancel,
            commands::ai_completion::ai_completion_ollama_models,
            commands::ai_completion::ai_completion_validate_provider,
            commands::ai_completion::ai_completion_usage,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                commands::speech::shutdown();
            }
        });
}
