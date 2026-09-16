use std::path::PathBuf;
use std::time::Instant;

use serde_json::{json, Value};
use uuid::Uuid;

use super::process_utils::DetachedProcess;

pub struct WorkJob {
    pub id: String,
    pub kind: &'static str,
    pub phase: String,
    pub message: String,
    pub percent: u8,
    pub logs: Vec<String>,
    pub preview: Option<Value>,
    pub requires_reset: bool,
    pub result: Option<Value>,
    pub error: String,
    pub source: String,
    pub source_fingerprint: (u64, i128),
    pub draft: Option<Value>,
    pub started: Instant,
    pub process: Option<DetachedProcess>,
    pub progress_path: Option<PathBuf>,
    pub log_path: Option<PathBuf>,
    pub log_offset: u64,
    pub guide_path: Option<PathBuf>,
}

impl WorkJob {
    fn new(kind: &'static str, phase: &str, message: &str) -> Self {
        Self {
            id: Uuid::new_v4().simple().to_string(),
            kind,
            phase: phase.into(),
            message: message.into(),
            percent: 0,
            logs: Vec::new(),
            preview: None,
            requires_reset: false,
            result: None,
            error: String::new(),
            source: String::new(),
            source_fingerprint: (0, 0),
            draft: None,
            started: Instant::now(),
            process: None,
            progress_path: None,
            log_path: None,
            log_offset: 0,
            guide_path: None,
        }
    }

    pub fn import(source: String, source_fingerprint: (u64, i128), requires_reset: bool) -> Self {
        let mut job = Self::new(
            "manuscript_import",
            "preparing",
            "Preparing manuscript import…",
        );
        job.source = source;
        job.source_fingerprint = source_fingerprint;
        job.requires_reset = requires_reset;
        job
    }

    pub fn story_bible() -> Self {
        Self::new("story_bible", "preparing", "Preparing Story Bible rebuild…")
    }

    /// Mirrors `WorkJob.add_log`: splits on lines, drops empty ones, caps at
    /// the last 200 lines.
    pub fn add_log(&mut self, text: &str) {
        for line in text.lines() {
            if !line.is_empty() {
                self.logs.push(line.to_string());
            }
        }
        if self.logs.len() > 200 {
            let start = self.logs.len() - 200;
            self.logs.drain(0..start);
        }
    }

    pub fn snapshot(&self) -> Value {
        let start = self.logs.len().saturating_sub(200);
        json!({
            "id": self.id, "kind": self.kind, "phase": self.phase, "message": self.message, "percent": self.percent,
            "logs": self.logs[start..], "elapsed": self.started.elapsed().as_secs_f64(),
            "preview": self.preview, "requiresReset": self.requires_reset, "result": self.result, "error": self.error,
        })
    }
}
