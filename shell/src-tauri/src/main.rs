#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod host;
mod server;
#[cfg(windows)]
mod winjob;

use cli::Args;
use tauri::Manager;

fn main() {
    let args = Args::parse_or_exit();

    tauri::Builder::default()
        // Must be registered before other plugins per tauri-plugin-single-instance's docs.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // A second REAPER launch forwards here instead of spawning a
            // second backend; just bring the existing window forward.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            host::start(app.handle().clone(), args.clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                host::request_shutdown(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Narration Utils shell");
}
