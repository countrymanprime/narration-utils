#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod sidecar;
#[cfg(windows)]
mod winjob;

use cli::Args;
use tauri::Manager;

fn main() {
    let args = Args::parse_or_exit();
    let port = args.port;

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
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            let handle = app.handle().clone();
            let args = args.clone();
            std::thread::spawn(move || sidecar::spawn_and_watch(handle, args));
            Ok(())
        })
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                sidecar::request_shutdown(port);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Narration Utils shell");
}
