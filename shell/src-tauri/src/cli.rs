use clap::Parser;

/// Mirrors the CLI contract `shared/server/main.py` already accepts, plus
/// `--repo-root`: the REAPER launcher already computes this path, so we take
/// it explicitly instead of guessing it relative to this exe's own location
/// (which would differ between a dev build under `target/debug` and any
/// future installed location).
#[derive(Parser, Clone, Debug)]
#[command(name = "narration-utils-shell")]
pub struct Args {
    #[arg(long = "repo-root")]
    pub repo_root: String,

    #[arg(long = "session-dir")]
    pub session_dir: String,

    #[arg(long = "project-folder", default_value = "")]
    pub project_folder: String,

    #[arg(long = "project-name", default_value = "")]
    pub project_name: String,

    #[arg(long = "daw", default_value = "")]
    pub daw: String,

    #[arg(long = "manuscript-python", default_value = "")]
    pub manuscript_python: String,

    #[arg(long = "manuscript-backend", default_value = "")]
    pub manuscript_backend: String,

    #[arg(long = "compare-python", default_value = "")]
    pub compare_python: String,

    #[arg(long = "compare-backend", default_value = "")]
    pub compare_backend: String,

    #[arg(long = "port", default_value_t = 48767)]
    pub port: u16,
}

impl Args {
    /// clap prints a usage message and exits the process on a parse error,
    /// which is fine here: this exe is only ever invoked by the REAPER
    /// launcher with a fixed, always-correct argument list.
    pub fn parse_or_exit() -> Self {
        Args::parse()
    }
}
