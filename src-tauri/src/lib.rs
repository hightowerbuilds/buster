mod commands;
mod storage;
#[cfg(target_os = "linux")]
mod credentials;
pub mod workspace;
pub mod watcher;

#[cfg(not(target_os = "linux"))]
use tauri::menu::{Menu, Submenu, MenuItem, PredefinedMenuItem};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(commands::session::CloseState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(workspace::WorkspaceState::new())
        .manage(watcher::FileWatcher::new())
        .manage(commands::ai_completion::AiCompletionState::new())
        .manage(commands::writing_ai::WritingAiState::default())
        .manage(commands::assistant::AssistantState::default())
        .manage(commands::local_model::LocalModelState::default())
        .setup(|app| {
            // Linux uses the in-app controls and shortcuts instead of a native menu bar.
            #[cfg(not(target_os = "linux"))]
            {
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
                let print = MenuItem::with_id(app, "print_document", "Print…", true, Some("CmdOrCtrl+P"))?;
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
                    &print,
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
                    &MenuItem::with_id(app, "quit_app", "Quit BusterMark", true, Some("CmdOrCtrl+Q"))?,
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
                        "print_document" => {
                            let _ = app_handle.emit("menu-print", ());
                        }
                        "quit_app" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.close();
                            }
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
            }

            // Set window icon (visible in dev mode dock/taskbar)
            {
                let icon_bytes = include_bytes!("../icons/icon.png");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.set_icon(icon);
                    }
                }
            }

            // Wait for the frontend's durable session backup before exiting. A window
            // whose frontend has not loaded must still be closable.
            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if handle.state::<commands::session::CloseState>().ready.load(std::sync::atomic::Ordering::SeqCst) {
                            api.prevent_close();
                            let _ = handle.emit("window-close-requested", ());
                        }
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
            commands::printing::print_printers,
            commands::printing::print_document,
            commands::file::read_file,
            commands::file::write_file,
            commands::file::list_directory,
            commands::file::move_entry,
            commands::file::create_file,
            commands::file::create_directory,
            commands::file::rename_entry,
            commands::file::delete_entry,
            commands::file::read_binary_file,
            commands::file::watch_file,
            commands::file::unwatch_file,
            // Search
            commands::search::list_workspace_files,
            commands::search::workspace_search,
            // Settings
            commands::settings::load_settings,
            commands::settings::load_saved_ai_key,
            commands::settings::save_settings,
            commands::settings::add_recent_folder,
            // Session
            commands::session::save_session,
            commands::session::load_session,
            commands::session::save_backup_buffer,
            commands::session::load_backup_buffer,
            commands::session::delete_backup_buffer,
            commands::session::clear_session,
            commands::session::confirm_app_close,
            commands::session::set_close_handler_ready,
            commands::session::set_running_flag,
            commands::session::clear_running_flag,
            // AI Completion
            commands::writing_ai::writing_ai_generate,
            commands::lookup::lookup_selection_text,
            commands::speech::speech_voices,
            commands::speech::speech_start,
            commands::speech::speech_control,
            commands::writing_ai::writing_ai_cancel,
            commands::assistant::assistant_status,
            commands::web_search::web_search,
            commands::web_search::web_search_configured,
            commands::web_search::web_search_save_key,
            commands::chat_history::chat_history_load,
            commands::chat_history::chat_history_save,
            commands::assistant::assistant_send,
            commands::assistant::assistant_interrupt,
            commands::assistant::assistant_reset,
            commands::assistant::assistant_tool_result,
            commands::backgrounds::background_compile,
            commands::backgrounds::backgrounds_load,
            commands::backgrounds::background_save,
            commands::backgrounds::background_delete,
            commands::backgrounds::backgrounds_configure,
            commands::local_model::local_models,
            commands::local_model::local_chat,
            commands::local_model::local_chat_cancel,
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
