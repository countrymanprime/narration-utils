use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::cli::Args;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Spawns the existing Python/FastAPI backend exactly as
/// `NarrationUtils_Launcher.lua` used to spawn it directly, then waits for
/// its startup.ready/startup.failure handshake (shared/server/main.py) and
/// points the window at it once it's up. Runs on a background thread so it
/// never blocks Tauri's own event loop.
pub fn spawn_and_watch(app: AppHandle, args: Args) {
    let repo_root = PathBuf::from(&args.repo_root);
    let python_exe = repo_root.join(".venv").join("Scripts").join("python.exe");

    let mut command = Command::new(&python_exe);
    command
        // Required for "-m shared.server.main" to resolve `shared` as a
        // package - see NarrationUtils_Launcher.lua's identical cwd choice.
        .current_dir(&repo_root)
        .arg("-m")
        .arg("shared.server.main")
        .arg("--session-dir")
        .arg(&args.session_dir)
        .arg("--project-folder")
        .arg(&args.project_folder)
        .arg("--project-name")
        .arg(&args.project_name)
        .arg("--daw")
        .arg(&args.daw)
        .arg("--manuscript-python")
        .arg(&args.manuscript_python)
        .arg("--manuscript-backend")
        .arg(&args.manuscript_backend)
        .arg("--compare-python")
        .arg(&args.compare_python)
        .arg("--compare-backend")
        .arg(&args.compare_backend)
        .arg("--port")
        .arg(args.port.to_string())
        // This shell already shows the UI in its own window; don't also
        // pop the OS default browser open on top of it.
        .arg("--no-open-browser")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = match command.spawn() {
        Ok(child) => child,
        Err(err) => {
            show_startup_error(
                &app,
                &format!("Could not start the Narration Utils backend ({}): {err}", python_exe.display()),
            );
            return;
        }
    };

    #[cfg(windows)]
    crate::winjob::bind_to_job_object(&child);

    wait_for_ready_and_navigate(&app, &args);
}

fn wait_for_ready_and_navigate(app: &AppHandle, args: &Args) {
    let session_dir = PathBuf::from(&args.session_dir);
    let ready_path = session_dir.join("startup.ready");
    let failure_path = session_dir.join("startup.failure");
    // Matches the deadline NarrationUtils_Launcher.lua used to poll for.
    let deadline = Instant::now() + Duration::from_secs(20);

    loop {
        if ready_path.exists() {
            break;
        }
        if failure_path.exists() {
            let message = std::fs::read_to_string(&failure_path)
                .unwrap_or_else(|_| "Narration Utils could not start.".to_string());
            show_startup_error(app, message.trim());
            return;
        }
        if Instant::now() >= deadline {
            show_startup_error(
                app,
                "Narration Utils is taking longer than expected to start.",
            );
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }

    let url = format!("http://127.0.0.1:{}", args.port);
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

/// Best-effort graceful stop, fired when the window is closing. The
/// Windows Job Object bound in `spawn_and_watch` is the real backstop: it
/// kills the backend once this process exits, whether that's this graceful
/// path completing (or timing out) or an outright crash. A short timeout
/// here means a hung backend can't delay the window from closing.
pub fn request_shutdown(port: u16) {
    let url = format!("http://127.0.0.1:{port}/api/shutdown");
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(2))
        .build();
    if let Err(err) = agent.post(&url).call() {
        eprintln!("Narration Utils shell: shutdown request failed (backend may already be down): {err}");
    }
}
