mod docx;
mod markdown;
mod model;
mod pdf;

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;

/// Parses a source manuscript into the draft JSON shape
/// shared/python/narration_common/manuscript.py's prepare_import() used to
/// build in-process. Invoked as a subprocess from that same function -
/// commit_import(), _canonical(), and everything reading manuscript.json
/// afterward are unchanged.
#[derive(Parser)]
struct Args {
    #[arg(long)]
    source: PathBuf,

    /// Only meaningful for Markdown sources.
    #[arg(long = "markdown-heading-level", default_value_t = 1)]
    markdown_heading_level: u8,

    /// Write the draft JSON here instead of stdout - matches the --out file
    /// convention tools/manuscript-guide's CLI already uses. The caller
    /// (manuscript.py's _draft_via_rust) always passes this: a Python
    /// process itself launched with all three standard streams redirected
    /// to null (as the Tauri shell does) makes
    /// `subprocess.run(capture_output=True)` come back with stdout=None on
    /// Windows even though this process wrote to it and exited 0 - a file
    /// sidesteps that pipe-inheritance quirk entirely. Stdout stays
    /// supported for manual/CLI use.
    #[arg(long)]
    out: Option<PathBuf>,
}

fn main() -> ExitCode {
    let args = Args::parse();

    let extension = args
        .source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let result = match extension.as_str() {
        "docx" => docx::build_draft(&args.source),
        "md" | "markdown" => markdown::build_draft(&args.source, args.markdown_heading_level),
        "pdf" => pdf::build_draft(&args.source),
        _ => Err(model::ManuscriptError(
            "Choose a Word (.docx), Markdown (.md), or text-based PDF (.pdf) manuscript.".to_string(),
        )),
    };

    match result {
        Ok(draft) => match serde_json::to_string(&draft) {
            Ok(json) => match &args.out {
                Some(out_path) => match std::fs::write(out_path, &json) {
                    Ok(()) => ExitCode::SUCCESS,
                    Err(e) => {
                        eprintln!("Could not write {}: {e}", out_path.display());
                        ExitCode::FAILURE
                    }
                },
                None => {
                    println!("{json}");
                    ExitCode::SUCCESS
                }
            },
            Err(e) => {
                eprintln!("Could not serialize the parsed manuscript: {e}");
                ExitCode::FAILURE
            }
        },
        Err(model::ManuscriptError(message)) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}
