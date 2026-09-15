//! Async subprocess helpers for shelling out to the two Python "core" tools
//! (`manuscript_guide.py`, `compare.py`) exactly as
//! `shared/server/process_utils.py` does today - same `CREATE_NO_WINDOW`
//! flag, same "run to completion" vs. "spawn detached, drain pipes, poll
//! separately" split.

use std::process::Stdio;
use std::sync::Arc;

use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Mutex;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn command(program: &str, args: &[String]) -> Command {
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Runs a process to completion and captures stdout/stderr. Mirrors
/// `process_utils.py::run`.
pub async fn run(program: &str, args: &[String]) -> Result<(i32, String, String), String> {
    let output = command(program, args)
        .output()
        .await
        .map_err(|error| format!("Could not start {program}: {error}"))?;
    Ok((
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    ))
}

/// A detached, drained child process. Mirrors `process_utils.py`'s
/// `DetachedProcess`/`start_detached_silently` - stdout/stderr are drained
/// on background tasks to avoid pipe-buffer deadlock (the caller reads
/// progress/log through separate files, never through these pipes), and
/// `request_cancel` is intentionally absent here too: cancellation is done
/// by the caller writing a `.cancel` sentinel file the Python side polls
/// for, not by this handle.
pub struct DetachedProcess {
    exit_code: Arc<Mutex<Option<i32>>>,
}

impl DetachedProcess {
    pub async fn has_exited(&self) -> bool {
        self.exit_code.lock().await.is_some()
    }

    pub async fn exit_code(&self) -> Option<i32> {
        *self.exit_code.lock().await
    }
}

/// Spawns `program args...` detached, binds it to a Windows Job Object so
/// it cannot outlive this process (crash or clean exit alike - see
/// `crate::winjob`), and drains its stdout/stderr in the background.
pub fn start_detached(program: &str, args: &[String]) -> Result<DetachedProcess, String> {
    let mut command = command(program, args);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start {program}: {error}"))?;

    #[cfg(windows)]
    if let Some(handle) = child.raw_handle() {
        crate::winjob::bind_to_job_object(handle);
    }

    if let Some(mut stdout) = child.stdout.take() {
        tokio::spawn(async move {
            let mut sink = Vec::new();
            let _ = stdout.read_to_end(&mut sink).await;
        });
    }
    if let Some(mut stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut sink = Vec::new();
            let _ = stderr.read_to_end(&mut sink).await;
        });
    }

    let exit_code = Arc::new(Mutex::new(None));
    let exit_code_writer = exit_code.clone();
    tokio::spawn(async move {
        let status = child.wait().await;
        let code = status
            .map(|status| status.code().unwrap_or(-1))
            .unwrap_or(-1);
        *exit_code_writer.lock().await = Some(code);
    });

    Ok(DetachedProcess { exit_code })
}
