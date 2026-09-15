//! Builds the in-process server and drives its whole lifecycle: bind the
//! fixed port, navigate the window there once bound, and stop accepting
//! requests when the window closes. Runs on Tauri's own tokio runtime via
//! `tauri::async_runtime::spawn` - never a second runtime - so it lives for
//! the app's entire lifetime alongside Tauri's event loop, replacing what
//! used to be a separate supervised Python process.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::cli::Args;
use crate::server::{self, AppState, ServerConfig};

pub fn start(app: AppHandle, args: Args) {
    let config = build_config(&app, &args);
    let (state, shutdown_rx) = match AppState::new(config) {
        Ok(pair) => pair,
        Err(err) => {
            show_startup_error(&app, &err);
            return;
        }
    };
    app.manage(state.clone());

    let port = args.port;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        serve(handle, state, shutdown_rx, port).await;
    });
}

fn build_config(app: &AppHandle, args: &Args) -> ServerConfig {
    ServerConfig {
        repo_root: PathBuf::from(&args.repo_root),
        session_dir: PathBuf::from(&args.session_dir),
        project_folder: non_empty(&args.project_folder).map(PathBuf::from),
        project_name: args.project_name.clone(),
        daw: args.daw.clone(),
        manuscript_python: args.manuscript_python.clone(),
        manuscript_backend: args.manuscript_backend.clone(),
        compare_python: args.compare_python.clone(),
        compare_backend: args.compare_backend.clone(),
        app_handle: Some(app.clone()),
    }
}

fn non_empty(value: &str) -> Option<&str> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

async fn serve(
    app: AppHandle,
    state: Arc<AppState>,
    mut shutdown_rx: tokio::sync::watch::Receiver<bool>,
    port: u16,
) {
    // Fail loudly rather than silently picking another port: REAPER's Lua
    // side and any bookmarked URLs assume this fixed port.
    let addr = format!("127.0.0.1:{port}");
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => listener,
        Err(err) => {
            show_startup_error(&app, &format!("Could not bind to {addr}: {err}"));
            return;
        }
    };

    server::transcript::spawn_bridge_loop(state.clone());
    navigate(&app, port);

    let result = axum::serve(listener, server::router(state))
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.changed().await;
        })
        .await;
    if let Err(err) = result {
        eprintln!("Narration Utils shell: server error: {err}");
    }
}

fn navigate(app: &AppHandle, port: u16) {
    let url = format!("http://127.0.0.1:{port}");
    if let Some(window) = app.get_webview_window("main") {
        match url.parse() {
            Ok(parsed) => {
                if let Err(err) = window.navigate(parsed) {
                    eprintln!("Narration Utils shell: could not navigate to backend: {err}");
                }
            }
            Err(err) => eprintln!("Narration Utils shell: invalid backend URL {url}: {err}"),
        }
    }
}

fn show_startup_error(app: &AppHandle, message: &str) {
    eprintln!("Narration Utils shell: startup error: {message}");
    if let Some(window) = app.get_webview_window("main") {
        let escaped = message.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', "\\n");
        let _ = window.eval(&format!(
            "document.body.innerText = 'Narration Utils could not start: {escaped}';"
        ));
    }
}

/// Fired when the window is closing: tells the in-process server to stop
/// accepting new requests and let in-flight ones finish. There's no
/// separate process to notify over a loopback POST anymore - this app
/// process exiting is the real backstop, same as it always was for the
/// guide/compare subprocesses via the Windows Job Object.
pub fn request_shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<Arc<AppState>>() {
        state.request_shutdown("via_window_close");
    }
}
